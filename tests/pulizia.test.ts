import { it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
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

async function sessioneGit() {
  const root = mkdtempSync(join(tmpdir(), "continuity-pulizia-"));
  const data = mkdtempSync(join(tmpdir(), "continuity-dati-"));
  dirs.push(root, data);
  git(["init", "-q"], root);
  writeFileSync(join(root, "app.mjs"), "export const a = 1;\n");
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

it("chiudendo la sessione il repository dell'utente resta pulito", async () => {
  const { engine, db, run, root } = await sessioneGit();
  try {
    // Durante la sessione il worktree e il ramo esistono.
    expect(git(["worktree", "list"], root)).toContain("continuity/" + run.id);
    expect(git(["branch", "--list", "continuity/*"], root).trim()).not.toBe("");

    await engine.closeSession(run.id);

    // Chiusa la sessione, nel repository dell'utente non resta traccia.
    expect(git(["worktree", "list"], root)).not.toContain(run.id);
    expect(git(["branch", "--list", "continuity/*"], root).trim()).toBe("");
    // Ma il lavoro non è stato cancellato: resta nella cartella della run.
    expect(existsSync(join(engine.run(run.id).dir))).toBe(true);
  } finally {
    await engine.shutdown();
    db.close();
  }
}, 40000);

it("la pulizia rimuove solo le run terminate e vecchie", async () => {
  const { engine, db, run } = await sessioneGit();
  try {
    // Invecchia la run nel registro, come se fosse di cento giorni fa.
    const invecchia = (corpo: any) => {
      corpo.createdAt = new Date(Date.now() - 100 * 86400000).toISOString();
      db.save(corpo, "test.invecchiata", "run invecchiata per la prova");
    };
    const r = engine.run(run.id);
    invecchia(r);
    // Una run ancora viva non si tocca, nemmeno se la data è lontana.
    expect(engine.pulisci(14)).toBe(0);
    expect(existsSync(r.dir)).toBe(true);

    await engine.closeSession(run.id);
    const chiusa = engine.run(run.id);
    invecchia(chiusa);
    expect(engine.pulisci(14)).toBe(1);
    expect(existsSync(chiusa.dir)).toBe(false);
  } finally {
    await engine.shutdown();
    db.close();
  }
}, 40000);

it("una run terminata da poco non viene cancellata", async () => {
  const { engine, db, run } = await sessioneGit();
  try {
    await engine.closeSession(run.id);
    expect(engine.pulisci(14)).toBe(0);
    expect(existsSync(engine.run(run.id).dir)).toBe(true);
  } finally {
    await engine.shutdown();
    db.close();
  }
}, 40000);
