import { it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { cartellaAdatta } from "../src/core/detect.js";
const dirs: string[] = [];
afterEach(() =>
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })),
);
it("rifiuta la cartella personale e accetta un progetto normale", () => {
  expect(cartellaAdatta(homedir()).adatta).toBe(false);
  expect(cartellaAdatta(homedir()).motivo).toContain("personale");
  // La radice del disco ha il suo motivo, su ogni sistema (31 ottobre).
  const radice = process.platform === "win32" ? "C:\\" : "/";
  expect(cartellaAdatta(radice).motivo).toBe("è la radice del disco, non un progetto");
  const progetto = mkdtempSync(join(tmpdir(), "continuity-adatta-"));
  dirs.push(progetto);
  writeFileSync(join(progetto, "app.mjs"), "export const a = 1;\n");
  expect(cartellaAdatta(progetto).adatta).toBe(true);
});
it("rifiuta una cartella con troppi file, ignorando node_modules", () => {
  const grande = mkdtempSync(join(tmpdir(), "continuity-grande-"));
  dirs.push(grande);
  mkdirSync(join(grande, "src"), { recursive: true });
  for (let i = 0; i < 5100; i++)
    writeFileSync(join(grande, "src", `f${i}.txt`), "x");
  expect(cartellaAdatta(grande).adatta).toBe(false);
  const conModuli = mkdtempSync(join(tmpdir(), "continuity-moduli-"));
  dirs.push(conModuli);
  mkdirSync(join(conModuli, "node_modules", "pacco"), { recursive: true });
  for (let i = 0; i < 5100; i++)
    writeFileSync(join(conModuli, "node_modules", "pacco", `f${i}.js`), "x");
  writeFileSync(join(conModuli, "app.mjs"), "export const a = 1;\n");
  expect(cartellaAdatta(conModuli).adatta).toBe(true);
});
