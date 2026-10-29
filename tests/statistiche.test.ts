import { it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Engine } from "../src/core/engine.js";

// Il blocco «Modifiche» della nuova interfaccia: righe aggiunte e tolte per
// file, anche per i file nuovi.
it("righe aggiunte e tolte per file, file nuovi compresi", () => {
  const work = mkdtempSync(join(tmpdir(), "continuity-stat-"));
  const git = (...a: string[]) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: work });
  git("init", "-q");
  writeFileSync(join(work, "a.txt"), "uno\ndue\ntre\n");
  git("add", ".");
  git("commit", "-qm", "base");
  writeFileSync(join(work, "a.txt"), "uno\nDUE\ntre\nquattro\n");
  writeFileSync(join(work, "nuovo.txt"), "x\ny\n");
  const motore = Object.create(Engine.prototype) as any;
  const stat = motore.statisticheModifiche({ work });
  expect(stat["a.txt"]).toEqual({ piu: 2, meno: 1 });
  expect(stat["nuovo.txt"]).toEqual({ piu: 2, meno: 0 });
});
