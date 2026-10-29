import { it, expect, afterEach } from "vitest";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  unlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { Engine } from "../src/core/engine.js";
import { Store } from "../src/persistence/store.js";
import { openProject } from "../src/core/project.js";

const dirs: string[] = [];
afterEach(() =>
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })),
);
const git = (args: string[], cwd: string) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
    },
  });

async function progettoGit() {
  const root = mkdtempSync(join(tmpdir(), "continuity-undo-"));
  const data = mkdtempSync(join(tmpdir(), "continuity-dati-"));
  dirs.push(root, data);
  git(["init", "-q"], root);
  writeFileSync(join(root, "tenere.txt"), "contenuto da tenere\n");
  writeFileSync(join(root, "vecchio.txt"), "testo prezioso dell'utente\n");
  git(["add", "-A"], root);
  git(
    ["-c", "user.name=T", "-c", "user.email=t@l", "commit", "-qm", "base"],
    root,
  );
  const aperto = openProject(root);
  const db = new Store(data);
  const engine = new Engine(db);
  const run = await engine.create(
    "Obiettivo",
    "simulation",
    "claude",
    {
      root: aperto.root,
      head: aperto.head,
      branch: aperto.branch,
      verify: aperto.config.verify,
      commandsDigest: aperto.commandsDigest,
    },
    { providers: ["codex", "claude"] },
  );
  await engine.shutdown();
  return { engine, db, run, root };
}

it("annulla rimette anche i file che l'AI ha cancellato", async () => {
  const { engine, db, run, root } = await progettoGit();
  try {
    const r = engine.run(run.id);
    // L'AI cancella un file dell'utente e ne modifica un altro.
    unlinkSync(join(r.work, "vecchio.txt"));
    writeFileSync(join(r.work, "tenere.txt"), "modificato dall'AI\n");
    git(["add", "-A"], r.work);

    engine.applyToProject(run.id);
    expect(existsSync(join(root, "vecchio.txt"))).toBe(false);
    expect(readFileSync(join(root, "tenere.txt"), "utf8")).toContain(
      "modificato",
    );

    engine.annullaUltimo(run.id);
    // Il file cancellato deve tornare: era lavoro dell'utente, non dell'AI.
    expect(existsSync(join(root, "vecchio.txt"))).toBe(true);
    expect(readFileSync(join(root, "vecchio.txt"), "utf8")).toBe(
      "testo prezioso dell'utente\n",
    );
    expect(readFileSync(join(root, "tenere.txt"), "utf8")).toBe(
      "contenuto da tenere\n",
    );
  } finally {
    await engine.shutdown();
    db.close();
  }
}, 40000);

it("una modifica che non si applica lascia la cartella intatta e dice la verità", async () => {
  const { engine, db, run, root } = await progettoGit();
  try {
    const r = engine.run(run.id);
    writeFileSync(join(r.work, "tenere.txt"), "versione dell'AI\n");
    // Nel frattempo l'utente cambia la stessa riga e committa.
    writeFileSync(join(root, "tenere.txt"), "versione dell'utente\n");
    git(["add", "-A"], root);
    git(
      ["-c", "user.name=T", "-c", "user.email=t@l", "commit", "-qm", "mia"],
      root,
    );

    expect(() => engine.applyToProject(run.id)).toThrow(/non si applicano/);
    // Niente marcatori di conflitto, niente stage: la cartella è come l'utente
    // l'ha lasciata.
    expect(readFileSync(join(root, "tenere.txt"), "utf8")).toBe(
      "versione dell'utente\n",
    );
    expect(git(["status", "--porcelain"], root).trim()).toBe("");
  } finally {
    await engine.shutdown();
    db.close();
  }
}, 40000);

it("due consegne nello stesso turno non sovrascrivono il punto di ripristino", async () => {
  const { engine, db, run, root } = await progettoGit();
  try {
    const r = engine.run(run.id);
    writeFileSync(join(r.work, "tenere.txt"), "primo passaggio\n");
    git(["add", "-A"], r.work);
    engine.applyToProject(run.id);
    writeFileSync(join(r.work, "tenere.txt"), "secondo passaggio\n");
    git(["add", "-A"], r.work);
    engine.applyToProject(run.id);

    engine.annullaUltimo(run.id);
    // Si torna al passaggio precedente, non a una copia di sé stesso.
    expect(readFileSync(join(root, "tenere.txt"), "utf8")).toBe(
      "primo passaggio\n",
    );
  } finally {
    await engine.shutdown();
    db.close();
  }
}, 40000);

// Osservato in un collaudo reale: dopo /annulla la cartella dell'utente era
// tornata indietro ma la copia di lavoro no. L'AI del turno successivo leggeva
// ancora il lavoro rifiutato, lo descriveva all'utente come presente e
// l'avrebbe riconsegnato.
it("annulla riporta indietro anche la copia di lavoro", async () => {
  const { engine, db, run, root } = await progettoGit();
  try {
    const r = engine.run(run.id);
    writeFileSync(join(r.work, "tenere.txt"), "aggiunta dell'AI\n");
    writeFileSync(join(r.work, "nuovo.txt"), "file nuovo dell'AI\n");
    git(["add", "-A"], r.work);
    engine.applyToProject(run.id);
    expect(existsSync(join(root, "nuovo.txt"))).toBe(true);

    engine.annullaUltimo(run.id);
    const dopo = engine.run(run.id);
    for (const radice of [root, dopo.work]) {
      expect(readFileSync(join(radice, "tenere.txt"), "utf8")).toBe(
        "contenuto da tenere\n",
      );
      expect(existsSync(join(radice, "nuovo.txt"))).toBe(false);
    }
    // E l'elenco mostrato da /file non deve più contarli come consegnati.
    expect(dopo.consegnati ?? []).not.toContain("nuovo.txt");
  } finally {
    await engine.shutdown();
    db.close();
  }
}, 40000);
