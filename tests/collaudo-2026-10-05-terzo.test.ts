// Regressioni dal terzo collaudo ufficiale (5 ottobre 2026, baseline
// 9bf0895): CT-021…CT-024. Ogni prova fallisce sulla baseline e passa dopo
// la correzione.
import { it, expect, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  symlinkSync,
  chmodSync,
  statSync,
  unlinkSync,
  renameSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { Engine } from "../src/core/engine.js";
import { Store } from "../src/persistence/store.js";
import { openProject } from "../src/core/project.js";

const dirs: string[] = [];
const aperti: { engine: Engine; db: Store }[] = [];
afterEach(async () => {
  // Prima tutti i motori, poi i database (vedi tests/collaudo-2026-10-03.test.ts).
  const tutti = aperti.splice(0);
  for (const { engine } of tutti) await engine.shutdown().catch(() => {});
  for (const db of new Set(tutti.map((x) => x.db))) {
    try {
      db.close();
    } catch {}
  }
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
});
const git = (cwd: string, args: string[]) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      PATH: process.env.PATH,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
    },
  });
const leggi = (p: string) => readFileSync(p, "utf8");
const esegue = (p: string) => (statSync(p).mode & 0o111) !== 0;

async function sessione(file: Record<string, string>, conGit: boolean) {
  const base = mkdtempSync(join(tmpdir(), "continuity-c05-"));
  dirs.push(base);
  const project = join(base, "progetto");
  mkdirSync(project);
  for (const [nome, contenuto] of Object.entries(file)) {
    mkdirSync(join(project, nome, ".."), { recursive: true });
    writeFileSync(join(project, nome), contenuto);
  }
  if (conGit) {
    git(project, ["init", "-q"]);
    git(project, ["add", "-A"]);
    git(project, [
      "-c",
      "user.name=T",
      "-c",
      "user.email=t@l",
      "commit",
      "-qm",
      "base",
    ]);
  }
  const p = openProject(project);
  const db = new Store(join(base, "dati"));
  const engine = new Engine(db);
  aperti.push({ engine, db });
  const run = await engine.create(
    "Collaudo 5 ottobre",
    "simulation",
    "claude",
    {
      root: p.root,
      head: p.head,
      branch: p.branch,
      verify: p.config.verify,
      commandsDigest: p.commandsDigest,
      modificati: p.modificati,
      senzaGit: p.senzaGit,
    } as any,
    { providers: ["codex", "claude"] },
  );
  return { base, project, engine, id: run.id, work: engine.run(run.id).work };
}

for (const conGit of [false, true]) {
  const dove = conGit ? "con Git" : "senza Git";

  it(`CT-021 · il ripristino dopo una consegna fallita non segue un collegamento comparso nel frattempo (${dove})`, async () => {
    const s = await sessione({ "d/a": "BASE\n" }, conGit);
    writeFileSync(join(s.work, "d", "a"), "AI\n");
    const fuori = join(s.base, "fuori");
    mkdirSync(fuori);
    writeFileSync(join(fuori, "a"), "EXTERNAL\n");
    // Fra il punto di ripristino e la scrittura la cartella diventa un
    // collegamento: la scrittura fallisce, e il ripristino non deve seguirlo.
    const evento = s.engine.event.bind(s.engine);
    (s.engine as any).event = (run: any, tipo: string, ...resto: any[]) => {
      const esito = (evento as any)(run, tipo, ...resto);
      if (tipo === "undo.ready") {
        rmSync(join(s.project, "d"), { recursive: true });
        symlinkSync(fuori, join(s.project, "d"));
      }
      return esito;
    };
    let errore = "";
    try {
      s.engine.applyToProject(s.id);
    } catch (e) {
      errore = String(e);
    }
    expect(leggi(join(fuori, "a"))).toBe("EXTERNAL\n");
    // Non deve dichiarare di aver rimesso a posto la cartella.
    expect(errore).not.toMatch(/rimessa com'era/);
    expect(errore).toMatch(/collegament/);
  });

  it(`CT-023 · una cartella vuota creata dalla persona non viene presa per opera della consegna (${dove})`, async () => {
    const s = await sessione({ "a.txt": "BASE\n" }, conGit);
    unlinkSync(join(s.work, "a.txt"));
    s.engine.applyToProject(s.id);
    mkdirSync(join(s.project, "a.txt", "new-empty"), { recursive: true });
    expect(() => s.engine.annullaUltimo(s.id)).toThrow(/modificat/);
    expect(statSync(join(s.project, "a.txt", "new-empty")).isDirectory()).toBe(
      true,
    );
  });

  // Permessi Unix (bit di esecuzione): su Windows non esistono.
  it.skipIf(process.platform === "win32")(`CT-024 · con contenuto già uguale, il permesso della persona arriva anche nella copia (${dove})`, async () => {
    const s = await sessione({ "a.txt": "BASE\n" }, conGit);
    writeFileSync(join(s.work, "a.txt"), "SAME NEW\n");
    writeFileSync(join(s.project, "a.txt"), "SAME NEW\n");
    chmodSync(join(s.project, "a.txt"), 0o755);
    s.engine.applyToProject(s.id);
    expect(esegue(join(s.project, "a.txt"))).toBe(true);
    expect(esegue(join(s.work, "a.txt"))).toBe(true);
  });
}

it("CT-022 · la cartella del progetto sostituita da un collegamento non riceve scritture", async () => {
  const s = await sessione({ "a.txt": "BASE\n" }, false);
  writeFileSync(join(s.work, "a.txt"), "AI\n");
  const fuori = join(s.base, "fuori");
  mkdirSync(fuori);
  writeFileSync(join(fuori, "a.txt"), "BASE\n");
  renameSync(s.project, s.project + "-salvato");
  symlinkSync(fuori, s.project);
  expect(() => s.engine.applyToProject(s.id)).toThrow(/collegament/);
  expect(leggi(join(fuori, "a.txt"))).toBe("BASE\n");
  expect(() => s.engine.annullaUltimo(s.id, { forza: true })).toThrow();
  expect(leggi(join(fuori, "a.txt"))).toBe("BASE\n");
});
