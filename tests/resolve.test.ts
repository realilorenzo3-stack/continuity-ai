import { it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  pickProvider,
  providerCandidates,
  rememberProvider,
  PROVIDER_CONTRACT,
} from "../src/adapters/resolve.js";

const dirs: string[] = [];
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), "continuity-resolve-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  delete process.env.CONTINUITY_CODEX_BIN;
  delete process.env.CONTINUITY_CLAUDE_BIN;
  dirs
    .splice(0)
    .forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});

function fakeCli(dir: string, name: string, version: string) {
  const path = join(dir, name);
  writeFileSync(path, `#!/bin/sh\necho '${version}'\n`, { mode: 0o755 });
  return path;
}

it("sceglie la versione più recente installata, non quella del collaudo né la prima trovata", () => {
  const bin = temp();
  const vecchia = fakeCli(bin, "claude-old", "2.1.162 (Claude Code)");
  const collaudata = fakeCli(bin, "claude-collaudo", PROVIDER_CONTRACT.claude);
  const recente = fakeCli(bin, "claude-new", "2.1.300 (Claude Code)");
  expect(pickProvider("claude", [vecchia, collaudata, recente]).path).toBe(
    recente,
  );
  // A parità di numeri vale la stabile, non l'anteprima.
  const alpha = fakeCli(bin, "codex-alpha", "codex-cli 0.162.0-alpha.2");
  const stabile = fakeCli(bin, "codex-stabile", "codex-cli 0.162.0");
  expect(pickProvider("codex", [alpha, stabile]).path).toBe(stabile);
});

it("riporta una versione non collaudata invece di scartarla in silenzio", () => {
  const bin = temp();
  const vecchia = fakeCli(bin, "claude-old", "2.1.162 (Claude Code)");
  const scelto = pickProvider("claude", [vecchia]);
  expect(scelto.path).toBe(vecchia);
  expect(scelto.version).toBe("2.1.162 (Claude Code)");
});

it("spiega come indicare il percorso quando nessun candidato esiste", () => {
  const bin = temp();
  expect(() => pickProvider("codex", [join(bin, "assente")])).toThrow(
    /CONTINUITY_CODEX_BIN/,
  );
});

it("ricorda il percorso scelto e lo antepone alla ricerca successiva", () => {
  const root = temp(),
    bin = temp();
  const path = fakeCli(bin, "codex", PROVIDER_CONTRACT.codex);
  rememberProvider(root, "codex", path);
  expect(providerCandidates("codex", root)[0]).toBe(path);
  const saved = JSON.parse(readFileSync(join(root, "providers.json"), "utf8"));
  expect(saved.codex.path).toBe(path);
  expect(saved.codex.rememberedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
});

it("un percorso indicato con CONTINUITY_CLAUDE_BIN vale anche se è più vecchio", async () => {
  const { resolveProvider } = await import("../src/adapters/resolve.js");
  const root = temp(),
    bin = temp();
  rememberProvider(
    root,
    "claude",
    fakeCli(bin, "ricordato", "9.9.9 (Claude Code)"),
  );
  const indicato = fakeCli(bin, "indicato", "2.1.1 (Claude Code)");
  process.env.CONTINUITY_CLAUDE_BIN = indicato;
  expect(resolveProvider("claude", root).path).toBe(indicato);
});
