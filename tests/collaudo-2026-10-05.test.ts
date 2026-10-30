// Regressioni dal secondo collaudo ufficiale (5 ottobre 2026, baseline
// f9d5ec6): CT-015 completato e CT-016…CT-020. Ogni prova fallisce sulla
// baseline e passa dopo la correzione.
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

  it(`CT-016 · la consegna non scrive fuori dal progetto attraverso un collegamento (${dove})`, async () => {
    const s = await sessione({ "d/a": "BASE\n" }, conGit);
    const fuori = join(s.base, "fuori");
    mkdirSync(fuori);
    writeFileSync(join(fuori, "a"), "BASE\n");
    rmSync(join(s.project, "d"), { recursive: true });
    symlinkSync(fuori, join(s.project, "d"));
    writeFileSync(join(s.work, "d", "a"), "AI ESCAPE\n");
    expect(() => s.engine.applyToProject(s.id)).toThrow(/collegament/);
    expect(() => s.engine.applyToProject(s.id, { forza: true })).toThrow(
      /collegament/,
    );
    expect(leggi(join(fuori, "a"))).toBe("BASE\n");
  });

  it(`CT-016 · /annulla non scrive fuori dal progetto attraverso un collegamento (${dove})`, async () => {
    const s = await sessione({ "d/a": "BASE\n" }, conGit);
    writeFileSync(join(s.work, "d", "a"), "AI\n");
    s.engine.applyToProject(s.id);
    const fuori = join(s.base, "fuori");
    mkdirSync(fuori);
    writeFileSync(join(fuori, "a"), "AI\n");
    rmSync(join(s.project, "d"), { recursive: true });
    symlinkSync(fuori, join(s.project, "d"));
    expect(() => s.engine.annullaUltimo(s.id, { forza: true })).toThrow(
      /collegament/,
    );
    expect(leggi(join(fuori, "a"))).toBe("AI\n");
  });

  it(`CT-017 · /annulla non fa sparire lavoro non consegnato sullo stesso file (${dove})`, async () => {
    const s = await sessione({ "a.txt": "BASE\n" }, conGit);
    writeFileSync(join(s.work, "a.txt"), "FIRST\n");
    s.engine.applyToProject(s.id);
    writeFileSync(join(s.work, "a.txt"), "SECOND NOT DELIVERED\n");
    expect(() => s.engine.annullaUltimo(s.id)).toThrow(/non è ancora consegnat/);
    expect(leggi(join(s.work, "a.txt"))).toBe("SECOND NOT DELIVERED\n");
    // Con la scelta esplicita si annulla, e il lavoro scartato resta recuperabile.
    const esito: any = s.engine.annullaUltimo(s.id, { forza: true });
    expect(leggi(join(s.project, "a.txt"))).toBe("BASE\n");
    expect(leggi(join(esito.conservati, "copia", "a.txt"))).toBe(
      "SECOND NOT DELIVERED\n",
    );
  });

  it(`CT-018 · un permesso di esecuzione messo dalla persona sopravvive alla consegna (${dove})`, async () => {
    const s = await sessione({ "a.txt": "BASE\n" }, conGit);
    chmodSync(join(s.project, "a.txt"), 0o755);
    writeFileSync(join(s.work, "a.txt"), "AI CONTENT\n");
    s.engine.applyToProject(s.id);
    expect(leggi(join(s.project, "a.txt"))).toBe("AI CONTENT\n");
    expect(esegue(join(s.project, "a.txt"))).toBe(true);
    expect(esegue(join(s.work, "a.txt"))).toBe(true);
  });

  it(`CT-018 · /annulla non toglie un permesso messo dopo la consegna (${dove})`, async () => {
    const s = await sessione({ "a.txt": "BASE\n" }, conGit);
    writeFileSync(join(s.work, "a.txt"), "AI\n");
    s.engine.applyToProject(s.id);
    chmodSync(join(s.project, "a.txt"), 0o755);
    expect(() => s.engine.annullaUltimo(s.id)).toThrow(/modificat/);
    expect(esegue(join(s.project, "a.txt"))).toBe(true);
  });

  it(`CT-019 · «/applica forza» risolve cartella→file con un file nuovo della persona, e /annulla lo ridà (${dove})`, async () => {
    const s = await sessione({ "d/base": "BASE\n" }, conGit);
    rmSync(join(s.work, "d"), { recursive: true });
    writeFileSync(join(s.work, "d"), "FILE\n");
    writeFileSync(join(s.project, "d", "user-new"), "USER NEW\n");
    expect(() => s.engine.applyToProject(s.id)).toThrow(/non si applicano/);
    s.engine.applyToProject(s.id, { forza: true });
    expect(leggi(join(s.project, "d"))).toBe("FILE\n");
    s.engine.annullaUltimo(s.id);
    expect(leggi(join(s.project, "d", "user-new"))).toBe("USER NEW\n");
    expect(leggi(join(s.project, "d", "base"))).toBe("BASE\n");
  });

  it(`CT-020 · /annulla di una cancellazione non elimina una cartella nuova della persona (${dove})`, async () => {
    const s = await sessione({ "a.txt": "BASE\n" }, conGit);
    unlinkSync(join(s.work, "a.txt"));
    s.engine.applyToProject(s.id);
    mkdirSync(join(s.project, "a.txt"));
    writeFileSync(join(s.project, "a.txt", "user-new"), "USER NEW\n");
    expect(() => s.engine.annullaUltimo(s.id)).toThrow(/modificat/);
    expect(leggi(join(s.project, "a.txt", "user-new"))).toBe("USER NEW\n");
    // Forzando, la cartella della persona non va persa: viene conservata.
    const esito: any = s.engine.annullaUltimo(s.id, { forza: true });
    expect(leggi(join(s.project, "a.txt"))).toBe("BASE\n");
    expect(leggi(join(esito.conservati, "tua", "a.txt", "user-new"))).toBe(
      "USER NEW\n",
    );
  });
}

// CT-015: il disinstallatore, senza indicazioni, trova da solo dove
// l'installatore ha messo il comando. Tutto in cartelle temporanee: il comando
// reale non viene mai toccato.
it("CT-015 · il disinstallatore senza override usa la cartella registrata dall'installatore", () => {
  const base = mkdtempSync(join(tmpdir(), "continuity-disinstalla-"));
  dirs.push(base);
  const dati = join(base, "dati");
  const bin = join(base, "bin");
  mkdirSync(join(dati, "app"), { recursive: true });
  mkdirSync(bin);
  writeFileSync(join(dati, "launcher-dir"), bin + "\n");
  writeFileSync(
    join(bin, "continuity"),
    '#!/bin/sh\ncontinuity_app="$x/app"\nexec node --import tsx src/cli/main.ts "$@"\n',
  );
  execFileSync("sh", ["scripts/uninstall.sh"], {
    env: { PATH: "/usr/bin:/bin", HOME: base, CONTINUITY_DATA_DIR: dati },
    stdio: ["ignore", "pipe", "pipe"],
  });
  expect(existsSync(join(bin, "continuity"))).toBe(false);
  expect(existsSync(join(dati, "app"))).toBe(false);
  expect(existsSync(join(dati, "launcher-dir"))).toBe(false);
});
