import { it, expect, afterEach } from "vitest";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  existsSync,
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

async function sessione() {
  const root = mkdtempSync(join(tmpdir(), "continuity-annulla-"));
  dirs.push(root);
  writeFileSync(join(root, "esistente.txt"), "originale\n");
  const data = mkdtempSync(join(tmpdir(), "continuity-dati-"));
  dirs.push(data);
  const aperto = openProject(root);
  const db = new Store(data),
    engine = new Engine(db);
  const run = await engine.create("Obiettivo", "simulation", "claude", {
    root: aperto.root,
    head: aperto.head,
    branch: aperto.branch,
    verify: aperto.config.verify,
    commandsDigest: aperto.commandsDigest,
    senzaGit: true,
  });
  await engine.shutdown();
  return { engine, db, run, root };
}

it("applica da sé e sa rimettere i file come stavano", async () => {
  const { engine, db, run, root } = await sessione();
  try {
    const r = engine.run(run.id);
    writeFileSync(join(r.work, "esistente.txt"), "cambiato dall'AI\n");
    writeFileSync(join(r.work, "nuovo.txt"), "creato dall'AI\n");
    engine.applyToProject(run.id);
    expect(readFileSync(join(root, "esistente.txt"), "utf8")).toContain(
      "cambiato",
    );
    expect(existsSync(join(root, "nuovo.txt"))).toBe(true);

    engine.annullaUltimo(run.id);
    // Il file che c'era torna com'era, quello creato sparisce.
    expect(readFileSync(join(root, "esistente.txt"), "utf8")).toBe(
      "originale\n",
    );
    expect(existsSync(join(root, "nuovo.txt"))).toBe(false);
  } finally {
    await engine.shutdown();
    db.close();
  }
}, 30000);

it("senza modifiche applicate non c'è nulla da annullare", async () => {
  const { engine, db, run } = await sessione();
  try {
    expect(() => engine.annullaUltimo(run.id)).toThrow(/niente da annullare/);
  } finally {
    await engine.shutdown();
    db.close();
  }
}, 30000);
