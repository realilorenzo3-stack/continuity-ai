import { it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openProject } from "../src/core/project.js";
import { Store } from "../src/persistence/store.js";
import { Engine } from "../src/core/engine.js";

const dirs: string[] = [];
afterEach(() =>
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })),
);

function git(args: string[], cwd: string) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
    },
  });
}

function progettoSporco() {
  const root = mkdtempSync(join(tmpdir(), "continuity-applica-"));
  dirs.push(root);
  writeFileSync(join(root, "app.mjs"), "export const uno = 1;\n");
  git(["init", "-q"], root);
  git(["add", "-A"], root);
  git(
    ["-c", "user.name=T", "-c", "user.email=t@l", "commit", "-qm", "base"],
    root,
  );
  // Lavoro non salvato: è lo stato che la persona ha davanti.
  writeFileSync(
    join(root, "app.mjs"),
    "export const uno = 1;\nexport const due = 2;\n",
  );
  return root;
}

it("porta nel progetto solo il lavoro dell'agente, anche partendo da un albero sporco", async () => {
  const root = progettoSporco();
  const data = mkdtempSync(join(tmpdir(), "continuity-dati-"));
  dirs.push(data);
  const aperto = openProject(root);
  expect(aperto.modificati).toEqual(["app.mjs"]);
  const db = new Store(data),
    engine = new Engine(db);
  try {
    const run = await engine.create("Obiettivo", "simulation", "claude", {
      root: aperto.root,
      head: aperto.head,
      branch: aperto.branch,
      verify: aperto.config.verify,
      commandsDigest: aperto.commandsDigest,
      modificati: aperto.modificati,
    });
    const r = engine.run(run.id);
    // Il worktree parte dallo stato reale dell'utente, non dal commit.
    expect(readFileSync(join(r.work, "app.mjs"), "utf8")).toContain("due = 2");
    await engine.shutdown();
    writeFileSync(
      join(r.work, "app.mjs"),
      "export const uno = 1;\nexport const due = 2;\nexport const tre = 3;\n",
    );
    const esito = engine.applyToProject(run.id);
    expect(esito.applicati).toContain("app.mjs");
    const finale = readFileSync(join(root, "app.mjs"), "utf8");
    expect(finale).toContain("tre = 3");
    expect(finale).toContain("due = 2");
    // Applicate, non committate: la decisione resta dell'utente.
    expect(git(["status", "--porcelain=v1"], root).trim()).toContain("app.mjs");
  } finally {
    await engine.shutdown();
    db.close();
  }
}, 30000);

it("non applica nulla se non ci sono modifiche e lo dice", async () => {
  const root = progettoSporco();
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
      modificati: aperto.modificati,
    });
    await engine.shutdown();
    expect(engine.applyToProject(run.id).applicati).toEqual([]);
  } finally {
    await engine.shutdown();
    db.close();
  }
}, 30000);
