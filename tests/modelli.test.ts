import { it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  catalogoCodex,
  MODELLI_CLAUDE,
  MODELLI_NOTI,
} from "../src/adapters/live.js";
import { Engine } from "../src/core/engine.js";

const dirs: string[] = [];
afterEach(() =>
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })),
);

function codexFinto(catalogo: unknown) {
  const d = mkdtempSync(join(tmpdir(), "codex-finto-"));
  dirs.push(d);
  const f = join(d, "codex");
  writeFileSync(
    f,
    `#!/bin/sh\nif [ "$1" = debug ] && [ "$2" = models ]; then cat <<'J'\n${JSON.stringify(catalogo)}\nJ\nfi\n`,
  );
  chmodSync(f, 0o755);
  return f;
}

// Il Codex finto è uno script sh: su Windows non parte (CLI solo .exe).
it.skipIf(process.platform === "win32")("il catalogo di Codex dà i modelli visibili, nell'ordine di Codex, con i livelli", () => {
  const f = codexFinto({
    models: [
      {
        slug: "vecchio",
        visibility: "list",
        priority: 9,
        description: "Older",
        supported_reasoning_levels: [{ effort: "high" }],
      },
      { slug: "nascosto", visibility: "hide", priority: 1 },
      {
        slug: "nuovo",
        visibility: "list",
        priority: 1,
        description: "Latest",
        supported_reasoning_levels: [{ effort: "high" }, { effort: "max" }],
      },
    ],
  });
  expect(catalogoCodex(f)).toEqual([
    { nome: "nuovo", descrizione: "Latest", livelli: ["high", "max"] },
    { nome: "vecchio", descrizione: "Older", livelli: ["high"] },
  ]);
  expect(catalogoCodex(join(tmpdir(), "non-esiste-codex"))).toBeUndefined();
});

it("per Claude gli alias dell'ultima versione vengono prima, e i modelli superati sono segnati", () => {
  expect(MODELLI_CLAUDE[0].nome).toBe("opus");
  expect(MODELLI_NOTI.claude).toContain("claude-opus-5-5");
  expect(
    MODELLI_CLAUDE.find((m) => m.nome === "claude-opus-5")?.descrizione,
  ).toMatch(/precedente/);
  expect(MODELLI_NOTI.codex).toContain("gpt-6.1-sol");
});

it("«massimo» per Codex è max dove il modello lo supporta, altrimenti xhigh", () => {
  const m = Object.create(Engine.prototype) as any;
  m.modelliDisponibili = () => ({
    codex: [
      { nome: "nuovo", livelli: ["high", "xhigh", "max"] },
      { nome: "vecchio", livelli: ["high", "xhigh"] },
    ],
  });
  const r = (modello?: string) => ({
    agent: "codex",
    ragionamento: { codex: "massimo" },
    modelli: modello ? { codex: modello } : {},
  });
  expect(m.sforzoCodex(r("nuovo"))).toBe("max");
  expect(m.sforzoCodex(r("vecchio"))).toBe("xhigh");
  // Senza modello scelto: max solo se tutti i modelli in elenco lo hanno.
  expect(m.sforzoCodex(r())).toBe("xhigh");
  expect(
    m.sforzoCodex({ agent: "codex", ragionamento: { codex: "alto" } }),
  ).toBeUndefined();
});
