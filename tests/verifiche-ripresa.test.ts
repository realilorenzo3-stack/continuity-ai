import { it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Engine } from "../src/core/engine.js";
import { Store } from "../src/persistence/store.js";
import { openProject, commandsDigest } from "../src/core/project.js";

const dirs: string[] = [];
afterEach(() =>
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })),
);

// Il 1° ottobre l'AI ha creato package.json con uno script di test in una
// sessione nata quando i test non c'erano: Continuity non li ha mai eseguiti.
// Alla ripresa la sessione deve adottare le verifiche che la cartella dichiara.
it("una sessione adotta i test comparsi dopo la sua nascita", async () => {
  const root = mkdtempSync(join(tmpdir(), "continuity-verifiche-"));
  const data = mkdtempSync(join(tmpdir(), "continuity-dati-"));
  dirs.push(root, data);
  writeFileSync(join(root, "index.html"), "<h1>x</h1>\n");
  const prima = openProject(root);
  expect(prima.config.verify).toEqual([]);
  const db = new Store(data);
  const engine = new Engine(db);
  try {
    const run = await engine.create(
      "Obiettivo",
      "simulation",
      "claude",
      {
        root: prima.root,
        head: prima.head,
        branch: prima.branch,
        verify: prima.config.verify,
        commandsDigest: prima.commandsDigest,
        senzaGit: prima.senzaGit,
        modificati: prima.modificati,
      } as any,
      { providers: ["codex", "claude"] },
    );
    // L'AI crea i test durante un turno.
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ scripts: { test: "node --test" } }),
    );
    const dopo = openProject(root);
    expect(dopo.config.verify.length).toBeGreaterThan(0);
    const r = engine.aggiornaVerifiche(
      run.id,
      dopo.config.verify,
      dopo.commandsDigest,
    );
    expect(r.project.verify.map((v: any) => v.id)).toContain("test");
    expect(r.criteria.map((c: any) => c.id)).toContain("test");
    // L'impronta resta coerente con i comandi: la verifica successiva non deve
    // rifiutarli come «diversi da quelli approvati».
    expect(commandsDigest({ verify: r.project.verify } as any)).toBe(
      r.project.commandsDigest,
    );
    const tipi = db.eventiRecenti(run.id, 5).map((e: any) => e.type);
    expect(tipi).toContain("verification.updated");
  } finally {
    await engine.shutdown();
    db.close();
  }
}, 40000);
