import { it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectProject, commandsDigest } from "../src/core/project.js";
import { Store } from "../src/persistence/store.js";
import { Engine } from "../src/core/engine.js";

const dirs: string[] = [];
afterEach(() =>
  dirs
    .splice(0)
    .forEach((dir) => rmSync(dir, { recursive: true, force: true })),
);

const CONFIG = {
  goal: "Implementare somma(numeri)",
  verify: [
    { id: "test", label: "Test", command: ["node", "test.mjs"] },
    {
      id: "sintassi",
      label: "Sintassi",
      command: ["node", "--check", "somma.mjs"],
    },
  ],
};

function git(args: string[], cwd: string) {
  execFileSync("git", args, {
    cwd,
    env: {
      PATH: process.env.PATH,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
    },
    stdio: "ignore",
  });
}

function project(config: unknown = CONFIG, solved = false) {
  // null significa: non scrivere affatto la configurazione.
  const root = mkdtempSync(join(tmpdir(), "continuity-progetto-"));
  dirs.push(root);
  writeFileSync(
    join(root, "somma.mjs"),
    solved
      ? "export function somma(n) { return n.reduce((a, b) => a + b, 0); }\n"
      : "export function somma() { return 0; }\n",
  );
  writeFileSync(
    join(root, "test.mjs"),
    'import { somma } from "./somma.mjs";\nimport assert from "node:assert";\nassert.strictEqual(somma([1, 2, 3]), 6);\n',
  );
  if (config !== null)
    writeFileSync(join(root, "continuity.json"), JSON.stringify(config));
  git(["init", "-q"], root);
  git(["add", "-A"], root);
  git(
    [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@localhost",
      "commit",
      "-qm",
      "base",
    ],
    root,
  );
  return root;
}

it("accetta un repository pulito e legge i comandi dichiarati", () => {
  const root = project();
  const inspected = inspectProject(root);
  expect(inspected.head).toMatch(/^[a-f0-9]{40}$/);
  expect(inspected.config.verify.map((v) => v.id)).toEqual([
    "test",
    "sintassi",
  ]);
  expect(inspected.commandsDigest).toBe(commandsDigest(inspected.config));
});

it("rifiuta albero sporco, configurazione assente o non valida, e cartella senza Git", () => {
  const sporco = project();
  writeFileSync(join(sporco, "somma.mjs"), "// modificato\n");
  expect(() => inspectProject(sporco)).toThrow(/modifiche non salvate/);

  const senzaConfig = project(null);
  expect(() => inspectProject(senzaConfig)).toThrow(/continuity\.json/);

  const invalido = project({ verify: [{ id: "X", label: "", command: [] }] });
  expect(() => inspectProject(invalido)).toThrow(/non valido/);

  const senzaGit = mkdtempSync(join(tmpdir(), "continuity-nogit-"));
  dirs.push(senzaGit);
  mkdirSync(join(senzaGit, "vuota"));
  expect(() => inspectProject(senzaGit)).toThrow(/repository Git/);
});

it("esegue i comandi del progetto e lascia intatto il repository dell'utente", async () => {
  const root = project(CONFIG, true);
  const data = mkdtempSync(join(tmpdir(), "continuity-dati-"));
  dirs.push(data);
  const inspected = inspectProject(root);
  const db = new Store(data),
    engine = new Engine(db);
  try {
    const created = await engine.create(
      "Obiettivo di prova",
      "simulation",
      "claude",
      {
        root: inspected.root,
        head: inspected.head,
        branch: inspected.branch,
        verify: inspected.config.verify,
        commandsDigest: inspected.commandsDigest,
      },
    );
    const run = engine.run(created.id);
    expect(run.repo).toBe(inspected.root);
    expect(run.work.startsWith(data)).toBe(true);
    expect(run.criteria.map((c: any) => c.id)).toEqual(["test", "sintassi"]);
    // Percorso reale: arresto del writer, checkpoint, verifica.
    await engine.complete(created.id);
    const concluso = engine.run(created.id);
    expect(concluso.state).toBe("SUCCEEDED");
    expect(concluso.checks.every((c: any) => c.passed)).toBe(true);
    expect(concluso.evidence.producer).toBe("continuity");
    // Il repository dell'utente non viene toccato dalla run.
    expect(
      execFileSync("git", ["status", "--porcelain=v1"], {
        cwd: root,
        encoding: "utf8",
        env: {
          PATH: process.env.PATH,
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: "/dev/null",
        },
      }).trim(),
    ).toBe("");
  } finally {
    await engine.shutdown();
    db.close();
  }
}, 30000);

it("rifiuta di verificare con comandi diversi da quelli approvati", async () => {
  const root = project();
  const data = mkdtempSync(join(tmpdir(), "continuity-dati-"));
  dirs.push(data);
  const inspected = inspectProject(root);
  const db = new Store(data),
    engine = new Engine(db);
  try {
    const created = await engine.create("Obiettivo", "simulation", "claude", {
      root: inspected.root,
      head: inspected.head,
      branch: inspected.branch,
      verify: [
        {
          id: "altro",
          label: "Comando sostituito",
          command: ["node", "-e", "0"],
        },
      ],
      commandsDigest: inspected.commandsDigest,
    });
    await expect(engine.complete(created.id)).rejects.toThrow(
      /diversi da quelli approvati/,
    );
    expect(engine.run(created.id).error).toMatch(/diversi da quelli approvati/);
  } finally {
    await engine.shutdown();
    db.close();
  }
}, 30000);
