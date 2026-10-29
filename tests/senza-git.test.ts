import { it, expect, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  lstatSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openProject } from "../src/core/project.js";
import { Store } from "../src/persistence/store.js";
import { Engine } from "../src/core/engine.js";

const dirs: string[] = [];
afterEach(() =>
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })),
);

function cartella() {
  const root = mkdtempSync(join(tmpdir(), "continuity-senzagit-"));
  dirs.push(root);
  writeFileSync(join(root, "note.txt"), "appunti\n");
  mkdirSync(join(root, "node_modules", "pacchetto"), { recursive: true });
  writeFileSync(
    join(root, "node_modules", "pacchetto", "grosso.js"),
    "x".repeat(5000),
  );
  return root;
}

it("apre una cartella qualsiasi, senza Git e senza commit", () => {
  const aperto = openProject(cartella());
  expect(aperto.senzaGit).toBe(true);
  expect(aperto.branch).toBe("senza Git");
  expect(aperto.modificati).toEqual([]);
  expect(aperto.config.verify).toEqual([]);
});

it("lavora su una copia e riporta i file senza toccare l'originale prima", async () => {
  const root = cartella();
  const data = mkdtempSync(join(tmpdir(), "continuity-dati-"));
  dirs.push(data);
  const aperto = openProject(root);
  const db = new Store(data),
    engine = new Engine(db);
  try {
    const run = await engine.create("Obiettivo", "simulation", "claude", {
      root: aperto.root,
      head: aperto.head,
      branch: aperto.branch,
      verify: aperto.config.verify,
      commandsDigest: aperto.commandsDigest,
      senzaGit: true,
    });
    const r = engine.run(run.id);
    await engine.shutdown();
    // La copia contiene il lavoro e le dipendenze, clonate (APFS) e non
    // collegate: le AI possono installarvi pacchetti senza toccare quelle
    // della persona, e i comandi del progetto le trovano.
    expect(readFileSync(join(r.work, "note.txt"), "utf8")).toContain("appunti");
    expect(lstatSync(join(r.work, "node_modules")).isSymbolicLink()).toBe(false);
    expect(
      readFileSync(
        join(r.work, "node_modules", "pacchetto", "grosso.js"),
        "utf8",
      ),
    ).toHaveLength(5000);
    // Finché non si chiede, la cartella dell'utente resta com'era.
    writeFileSync(join(r.work, "nuovo.mjs"), "export const a = 1;\n");
    expect(existsSync(join(root, "nuovo.mjs"))).toBe(false);
    const esito = engine.applyToProject(run.id);
    expect(esito.applicati).toContain("nuovo.mjs");
    expect(readFileSync(join(root, "nuovo.mjs"), "utf8")).toContain("a = 1");
  } finally {
    await engine.shutdown();
    db.close();
  }
}, 30000);
