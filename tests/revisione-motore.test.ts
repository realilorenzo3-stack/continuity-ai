import { it, expect, vi, afterEach } from "vitest";
import { execFileSync, spawn } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
  readdirSync,
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
  const root = mkdtempSync(join(tmpdir(), "continuity-rev-"));
  const data = mkdtempSync(join(tmpdir(), "continuity-dati-"));
  dirs.push(root, data);
  writeFileSync(join(root, "a.txt"), "a\n");
  const git = (...a: string[]) =>
    execFileSync("git", ["-c", "user.name=T", "-c", "user.email=t@l", ...a], {
      cwd: root,
      stdio: "ignore",
    });
  git("init", "-q");
  git("add", "-A");
  git("commit", "-qm", "base");
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
      modificati: p.modificati,
      senzaGit: p.senzaGit,
    },
    { providers: ["codex", "claude"] },
  );
  return { root, db, engine, id: run.id };
}

it("ciò che lo stream salva durante l'arresto non viene cancellato dalla pausa", async () => {
  const { db, engine, id } = await sessione();
  try {
    // Node invece di sleep: c'è su ogni sistema, anche su Windows.
    const figlio = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { detached: true, stdio: "ignore" });
    const r = engine.run(id);
    r.state = "STARTING";
    db.save(r, "prova", "avvio");
    r.state = "RUNNING";
    r.pid = figlio.pid;
    db.save(r, "prova", "in corso");
    engine.children.set(id, figlio as any);
    setTimeout(() => {
      const c = engine.run(id);
      engine.remember(c, "ai", "MESSAGGIO FINALE", "codex");
      c.sessioniNative = { codex: { id: "thread-12345678" } };
      engine.event(c, "agent.message", "finale");
    }, 5);
    await engine.action(id, "pause");
    const dopo = engine.run(id);
    expect(dopo.state).toBe("PAUSED");
    expect(dopo.transcript.map((t: any) => t.text)).toContain(
      "MESSAGGIO FINALE",
    );
    expect(dopo.sessioniNative.codex.id).toBe("thread-12345678");
  } finally {
    await engine.shutdown();
    db.close();
  }
}, 30000);

it("/chiudi non cancella i file non consegnati; con forza li conserva a parte", async () => {
  const { db, engine, id } = await sessione();
  try {
    const r = engine.run(id);
    writeFileSync(join(r.work, "nuovo.txt"), "LAVORO NON CONSEGNATO\n");
    await expect(engine.closeSession(id)).rejects.toThrow(
      /non ancora consegnati/,
    );
    expect(engine.run(id).state).not.toBe("CANCELLED");
    await engine.closeSession(id, { forza: true });
    const chiusa = engine.run(id);
    expect(chiusa.state).toBe("CANCELLED");
    const conservati = readdirSync(chiusa.dir).find((d) =>
      d.startsWith("non-consegnati-"),
    )!;
    expect(
      readFileSync(join(chiusa.dir, conservati, "nuovo.txt"), "utf8"),
    ).toBe("LAVORO NON CONSEGNATO\n");
  } finally {
    await engine.shutdown();
    db.close();
  }
}, 30000);

it("due avvii insieme: uno solo parte; un turno manuale cancella la richiesta in attesa", async () => {
  const { db, engine, id } = await sessione();
  try {
    const r = engine.run(id);
    r.inAttesa = { testo: "vecchia", dalle: new Date().toISOString() };
    db.save(r, "prova", "in attesa");
    const esiti = await Promise.allSettled([
      engine.turn(id, "prima"),
      engine.turn(id, "seconda"),
    ]);
    const rifiutati = esiti.filter((e) => e.status === "rejected");
    expect(rifiutati.length).toBe(1);
    expect(String((rifiutati[0] as any).reason)).toMatch(/già in avvio/);
    expect(engine.run(id).inAttesa).toBeUndefined();
    expect(engine.run(id).request).toMatch(/^(prima|seconda)$/);
  } finally {
    await engine.shutdown();
    db.close();
  }
}, 40000);

for (const conGit of [false, true])
  // La prova usa cp e uno script sh come «programma» di Git.
  it.skipIf(process.platform === "win32")(`una configurazione Git scritta dall'AI nella copia non viene eseguita da Continuity (${conGit ? "repository" : "senza Git"})`, async () => {
    const root = mkdtempSync(join(tmpdir(), "continuity-fsmon-"));
    const data = mkdtempSync(join(tmpdir(), "continuity-dati-"));
    const fuori = mkdtempSync(join(tmpdir(), "continuity-fuori-"));
    dirs.push(root, data, fuori);
    writeFileSync(join(root, "a.txt"), "a\n");
    if (conGit) {
      const git = (...a: string[]) =>
        execFileSync(
          "git",
          ["-c", "user.name=T", "-c", "user.email=t@l", ...a],
          { cwd: root, stdio: "ignore" },
        );
      git("init", "-q");
      git("add", "-A");
      git("commit", "-qm", "base");
    }
    const p = openProject(root);
    const db = new Store(data);
    const engine = new Engine(db);
    try {
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
          modificati: p.modificati,
          senzaGit: p.senzaGit,
        },
        { providers: ["codex", "claude"] },
      );
      const r = engine.run(run.id);
      const segno = join(fuori, "eseguito");
      const comando = join(fuori, "attacco.sh");
      writeFileSync(comando, `#!/bin/sh\ntouch ${segno}\n`, { mode: 0o755 });
      const configMalevola = `[core]\n\tfsmonitor = ${comando}\n`;
      if (conGit) {
        // L'AI ridirige il .git della copia verso un repository suo.
        const finto = join(fuori, "finto.git");
        execFileSync("git", ["init", "-q", "--bare", finto]);
        execFileSync("cp", [
          "-R",
          join(root, ".git", "objects") + "/.",
          join(finto, "objects"),
        ]);
        writeFileSync(
          join(finto, "HEAD"),
          readFileSync(join(root, ".git", "HEAD"), "utf8"),
        );
        mkdirSync(join(finto, "refs", "heads"), { recursive: true });
        execFileSync("cp", [
          "-R",
          join(root, ".git", "refs") + "/.",
          join(finto, "refs"),
        ]);
        writeFileSync(
          join(finto, "config"),
          configMalevola + "\tbare = false\n",
        );
        writeFileSync(join(r.work, ".git"), `gitdir: ${finto}\n`);
      } else writeFileSync(join(r.work, ".git", "config"), configMalevola);
      engine.proteggiGitCopia(r);
      engine.changedFiles(r);
      execFileSync("git", ["status", "--porcelain"], { cwd: r.work });
      expect(() => readFileSync(segno)).toThrow();
    } finally {
      await engine.shutdown();
      db.close();
    }
  }, 30000);

it("un collegamento o un file grande creati dall'AI non bloccano la fotografia né la consegna", async () => {
  const { symlinkSync } = await import("node:fs");
  const { root, db, engine, id } = await sessione();
  try {
    const r = engine.run(id);
    mkdirSync(join(r.work, "env", "bin"), { recursive: true });
    symlinkSync("/usr/bin/python3", join(r.work, "env", "bin", "python"));
    writeFileSync(join(r.work, "dati.bin"), Buffer.alloc(11 * 1024 * 1024, 1));
    writeFileSync(join(r.work, "codice.py"), "print('ciao')\n");
    expect(() => engine.checkpoint(r)).not.toThrow();
    const esclusi = r.snapshots.at(-1).excludedPaths;
    expect(esclusi).toContain("env/bin/python");
    expect(esclusi).toContain("dati.bin");
    engine.applyToProject(id);
    expect(readFileSync(join(root, "codice.py"), "utf8")).toBe(
      "print('ciao')\n",
    );
  } finally {
    await engine.shutdown();
    db.close();
  }
}, 30000);

it("due aperture insieme nella stessa cartella ricevono la stessa sessione", async () => {
  const { root, db, engine, id } = await sessione();
  try {
    const p = openProject(root);
    const seconda = await engine.create(
      "Obiettivo",
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
      },
      { providers: ["codex", "claude"] },
    );
    expect(seconda.id).toBe(id);
  } finally {
    await engine.shutdown();
    db.close();
  }
}, 30000);

it("node_modules nella copia è una copia vera: installare lì non tocca quello della persona", async () => {
  const { lstatSync } = await import("node:fs");
  const root = mkdtempSync(join(tmpdir(), "continuity-nm-"));
  const data = mkdtempSync(join(tmpdir(), "continuity-dati-"));
  dirs.push(root, data);
  mkdirSync(join(root, "node_modules", "pacchetto"), { recursive: true });
  writeFileSync(join(root, "node_modules", "pacchetto", "index.js"), "v1\n");
  writeFileSync(join(root, "a.txt"), "a\n");
  const p = openProject(root);
  const db = new Store(data);
  const engine = new Engine(db);
  try {
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
        modificati: p.modificati,
        senzaGit: p.senzaGit,
      },
      { providers: ["codex", "claude"] },
    );
    const work = engine.run(run.id).work;
    const nm = join(work, "node_modules");
    expect(lstatSync(nm).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(nm, "pacchetto", "index.js"), "utf8")).toBe(
      "v1\n",
    );
    writeFileSync(join(nm, "pacchetto", "index.js"), "v2 dall'AI\n");
    mkdirSync(join(nm, "nuovo"));
    expect(
      readFileSync(join(root, "node_modules", "pacchetto", "index.js"), "utf8"),
    ).toBe("v1\n");
    expect(() => lstatSync(join(root, "node_modules", "nuovo"))).toThrow();
    expect(engine.changedFiles(engine.run(run.id))).not.toContain(
      "node_modules/pacchetto/index.js",
    );
  } finally {
    await engine.shutdown();
    db.close();
  }
}, 30000);

it("le cache create nel progetto non vengono consegnate, a nessuna profondità", async () => {
  const { root, db, engine, id } = await sessione();
  try {
    const r = engine.run(id);
    for (const f of [
      ".npm-cache/_logs/debug.log",
      "src/__pycache__/m.cpython-312.pyc",
      ".pytest_cache/v/cache/lastfailed",
    ]) {
      mkdirSync(join(r.work, f, ".."), { recursive: true });
      writeFileSync(join(r.work, f), "cache\n");
    }
    mkdirSync(join(r.work, "src"), { recursive: true });
    writeFileSync(join(r.work, "src", "m.py"), "x = 1\n");
    expect(engine.changedFiles(engine.run(id))).toEqual(["src/m.py"]);
    engine.applyToProject(id);
    expect(readFileSync(join(root, "src", "m.py"), "utf8")).toBe("x = 1\n");
    expect(() =>
      readFileSync(join(root, ".npm-cache", "_logs", "debug.log")),
    ).toThrow();
  } finally {
    await engine.shutdown();
    db.close();
  }
}, 30000);

it("ogni richiesta resta nel registro, prima di ciò che il turno provoca", async () => {
  const { db, engine, id } = await sessione();
  try {
    await engine.turn(id, "Crea il sito password: Segreta123");
    const eventi = db.events(id);
    const tipi = eventi.map((e: any) => e.type);
    const richiesta = eventi.find((e: any) => e.type === "user.request");
    expect(richiesta.payload.message).toContain("Crea il sito");
    // Oscurata come il resto del registro.
    expect(richiesta.payload.message).not.toContain("Segreta123");
    expect(tipi.indexOf("user.request")).toBeLessThan(
      tipi.indexOf("turn.started"),
    );
  } finally {
    await engine.shutdown();
    db.close();
  }
}, 30000);

it("una verifica che fallisce conserva le ultime righe e le passa all'AI", async () => {
  const { projectPrompt } = await import("../src/adapters/live.js");
  const root = mkdtempSync(join(tmpdir(), "continuity-ver-"));
  const data = mkdtempSync(join(tmpdir(), "continuity-dati-"));
  dirs.push(root, data);
  writeFileSync(
    join(root, "continuity.json"),
    JSON.stringify({
      verify: [
        {
          id: "test",
          label: "Test",
          command: [
            "node",
            "-e",
            "console.log('3 passed');console.error('FALLITO: menu da tastiera · token=Segreta12345');process.exit(1)",
          ],
        },
      ],
    }),
  );
  const p = openProject(root);
  const db = new Store(data);
  const engine = new Engine(db);
  try {
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
        modificati: p.modificati,
        senzaGit: p.senzaGit,
      },
      { providers: ["codex", "claude"] },
    );
    const r = engine.run(run.id);
    for (const stato of ["STARTING", "RUNNING", "QUIESCING", "SNAPSHOTTING"]) {
      r.state = stato;
      db.save(r, "prova", stato);
    }
    engine.checkpoint(r);
    await engine.verifyProject(r);
    expect(r.checks[0].passed).toBe(false);
    expect(r.checks[0].dettaglio).toContain("FALLITO: menu da tastiera");
    expect(r.checks[0].dettaglio).not.toContain("Segreta12345");
    const prompt = projectPrompt({
      role: "writer",
      goal: "x",
      work: "/w",
      criteria: r.checks,
    });
    expect(prompt).toContain("FALLITO: menu da tastiera");
  } finally {
    await engine.shutdown();
    db.close();
  }
}, 30000);
