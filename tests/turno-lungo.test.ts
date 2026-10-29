import { it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
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

async function sessione() {
  const root = mkdtempSync(join(tmpdir(), "continuity-lungo-"));
  const data = mkdtempSync(join(tmpdir(), "continuity-dati-"));
  dirs.push(root, data);
  git(["init", "-q"], root);
  writeFileSync(join(root, "a.txt"), "a\n");
  git(["add", "-A"], root);
  git(
    ["-c", "user.name=T", "-c", "user.email=t@l", "commit", "-qm", "base"],
    root,
  );
  const p = openProject(root);
  const db = new Store(data);
  const engine = new Engine(db);
  const run = await engine.create(
    "Obiettivo",
    "simulation",
    "claude",
    {
      root: p.root,
      head: p.head,
      branch: p.branch,
      verify: p.config.verify,
      commandsDigest: p.commandsDigest,
    },
    { providers: ["claude", "codex"] },
  );
  await engine.shutdown();
  return { engine, db, run };
}

// Un evento che il motore non riesce a elaborare spariva in silenzio, anche se
// conteneva la dichiarazione del limite: la rotazione non partiva e nessuno lo
// sapeva. Ora resta scritto, e il limite viene riconosciuto comunque.
it("un evento non elaborato resta scritto e il limite al suo interno non si perde", async () => {
  const { engine, db, run } = await sessione();
  try {
    const r = engine.run(run.id);
    engine.eventoNonElaborato(r, Error("guasto nel gestore"), {
      type: "result",
      is_error: true,
      result: "You've hit your session limit · resets 1:30pm",
    });
    expect(engine.run(run.id).quotaDetected).toBe(true);
    const tipi = db.eventiRecenti(run.id, 10).map((e: any) => e.type);
    expect(tipi).toContain("engine.warning");
  } finally {
    await engine.shutdown();
    db.close();
  }
}, 40000);

// Il contenuto di un file letto dall'AI può contenere qualunque frase: non è il
// provider che dichiara il limite.
it("una frase sul limite dentro un file letto non è un limite", async () => {
  const { engine, db, run } = await sessione();
  try {
    const r = engine.run(run.id);
    engine.eventoNonElaborato(r, Error("guasto"), {
      type: "user",
      message: {
        content: [
          { type: "tool_result", content: "You've hit your session limit" },
        ],
      },
    });
    expect(engine.run(run.id).quotaDetected).toBeFalsy();
  } finally {
    await engine.shutdown();
    db.close();
  }
}, 40000);

// Il lavoro di una sessione non si interrompe per tempo: interromperlo dopo
// quindici minuti rendeva inutile tutto ciò che era stato fatto prima.
it("in una sessione nessun timer chiude il turno", () => {
  const codice = readFileSync("src/core/engine.ts", "utf8");
  expect(codice).not.toMatch(/minuti senza conclusione/);
  expect(codice).not.toMatch(/900000/);
  const guardiano = codice.slice(
    codice.indexOf('if (r.mode === "live" && r.session) {'),
    codice.indexOf('} else if (r.mode === "live") {'),
  );
  // Il guardiano della sessione avvisa soltanto.
  expect(guardiano).toContain('"turn.silent"');
  expect(guardiano).not.toMatch(/endTurn|failLive|action\(|stop\(|kill/);
});
