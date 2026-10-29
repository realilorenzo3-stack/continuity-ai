// Regressioni dal collaudo ufficiale del 3 ottobre 2026
// (docs/COLLAUDO_UFFICIALE_2026-10-03.md). Ogni prova riproduce un rilievo:
// deve fallire sulla baseline 9673d9c e passare dopo la correzione.
import { it, expect, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  unlinkSync,
  renameSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { Engine } from "../src/core/engine.js";
import { Store } from "../src/persistence/store.js";
import { openProject } from "../src/core/project.js";
import { exportRun } from "../src/handoff/export.js";

const dirs: string[] = [];
const aperti: { engine: Engine; db: Store }[] = [];
afterEach(async () => {
  for (const { engine, db } of aperti.splice(0)) {
    await engine.shutdown().catch(() => {});
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
  }).trim();

async function sessione(conGit = false) {
  const base = mkdtempSync(join(tmpdir(), "continuity-collaudo-"));
  dirs.push(base);
  const project = join(base, "progetto");
  mkdirSync(project);
  writeFileSync(join(project, "old.txt"), "ORIGINAL\n");
  writeFileSync(join(project, "other.txt"), "KEEP\n");
  writeFileSync(
    join(project, "lungo.txt"),
    ["uno", "due", "tre", "quattro", "cinque", "sei", "sette", "otto"].join(
      "\n",
    ) + "\n",
  );
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
    "Collaudo",
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
  return {
    base,
    project,
    db,
    engine,
    id: run.id,
    work: engine.run(run.id).work,
  };
}

for (const conGit of [false, true]) {
  const dove = conGit ? "con Git" : "senza Git";

  it(`CT-003 · una cancellazione arriva nella cartella (${dove})`, async () => {
    const s = await sessione(conGit);
    unlinkSync(join(s.work, "old.txt"));
    const esito: any = s.engine.applyToProject(s.id);
    expect(existsSync(join(s.project, "old.txt"))).toBe(false);
    // CT-014: la cancellazione è dichiarata, non taciuta.
    expect(esito.eliminati).toEqual(["old.txt"]);
    expect(s.engine.changedFiles(s.engine.run(s.id))).toEqual([]);
    // E /annulla la rimette.
    s.engine.annullaUltimo(s.id);
    expect(readFileSync(join(s.project, "old.txt"), "utf8")).toBe("ORIGINAL\n");
    expect(readFileSync(join(s.work, "old.txt"), "utf8")).toBe("ORIGINAL\n");
  });

  it(`CT-003 · una rinomina non lascia il vecchio file (${dove})`, async () => {
    const s = await sessione(conGit);
    renameSync(join(s.work, "old.txt"), join(s.work, "new.txt"));
    s.engine.applyToProject(s.id);
    expect(existsSync(join(s.project, "old.txt"))).toBe(false);
    expect(readFileSync(join(s.project, "new.txt"), "utf8")).toBe("ORIGINAL\n");
  });

  it(`CT-004 · una modifica tua sullo stesso punto non viene sovrascritta (${dove})`, async () => {
    const s = await sessione(conGit);
    writeFileSync(join(s.work, "old.txt"), "AI\n");
    writeFileSync(join(s.project, "old.txt"), "USER NEW\n");
    expect(() => s.engine.applyToProject(s.id)).toThrow(/non si applicano/);
    // Niente è stato scritto: né il conflitto né gli altri file.
    expect(readFileSync(join(s.project, "old.txt"), "utf8")).toBe("USER NEW\n");
    expect(readFileSync(join(s.work, "old.txt"), "utf8")).toBe("AI\n");
    // Forzando, la tua versione resta recuperabile con /annulla.
    s.engine.applyToProject(s.id, { forza: true });
    expect(readFileSync(join(s.project, "old.txt"), "utf8")).toBe("AI\n");
    s.engine.annullaUltimo(s.id);
    expect(readFileSync(join(s.project, "old.txt"), "utf8")).toBe("USER NEW\n");
  });

  it(`CT-004 · modifiche tue e dell'AI in punti diversi si uniscono (${dove})`, async () => {
    const s = await sessione(conGit);
    const righe = readFileSync(join(s.work, "lungo.txt"), "utf8").split("\n");
    righe[0] = "UNO DELL'AI";
    writeFileSync(join(s.work, "lungo.txt"), righe.join("\n"));
    const mie = readFileSync(join(s.project, "lungo.txt"), "utf8").split("\n");
    mie[7] = "OTTO MIO";
    writeFileSync(join(s.project, "lungo.txt"), mie.join("\n"));
    s.engine.applyToProject(s.id);
    const finale = readFileSync(join(s.project, "lungo.txt"), "utf8");
    expect(finale).toContain("UNO DELL'AI");
    expect(finale).toContain("OTTO MIO");
    // Le due copie restano allineate.
    expect(readFileSync(join(s.work, "lungo.txt"), "utf8")).toBe(finale);
  });

  it(`CT-005 · una modifica binaria arriva intatta (${dove})`, async () => {
    const s = await sessione(conGit);
    writeFileSync(join(s.work, "old.txt"), Buffer.from([0, 1, 2, 3]));
    s.engine.applyToProject(s.id);
    expect(readFileSync(join(s.project, "old.txt")).toString("hex")).toBe(
      "00010203",
    );
    s.engine.annullaUltimo(s.id);
    expect(readFileSync(join(s.project, "old.txt"), "utf8")).toBe("ORIGINAL\n");
  });

  it(`CT-004 · /annulla non cancella ciò che hai cambiato dopo la consegna (${dove})`, async () => {
    const s = await sessione(conGit);
    writeFileSync(join(s.work, "old.txt"), "AI\n");
    s.engine.applyToProject(s.id);
    writeFileSync(join(s.project, "old.txt"), "RITOCCO MIO\n");
    expect(() => s.engine.annullaUltimo(s.id)).toThrow(/modificat/);
    expect(readFileSync(join(s.project, "old.txt"), "utf8")).toBe(
      "RITOCCO MIO\n",
    );
  });
}

it("CT-006 · un mandato lungo quanto il limite resta intero nella memoria", async () => {
  const s = await sessione();
  const r: any = {};
  s.engine.remember(r, "utente", "A".repeat(150_000) + "END-SECRET");
  expect(r.transcript[0].text.endsWith("END-SECRET")).toBe(true);
});

it("CT-007 · una risposta lunga non viene mozzata nel registro", async () => {
  const s = await sessione();
  const msg = "A".repeat(12_000) + "END-RESPONSE";
  s.engine.event(s.engine.run(s.id), "agent.message", msg, "codex");
  const salvato = s.db.eventiRecenti(s.id, 1)[0].payload.message;
  expect(salvato.endsWith("END-RESPONSE")).toBe(true);
});

it("CT-009 · un segreto oscurato nel registro non ricompare nella memoria né nell'export", async () => {
  const s = await sessione();
  const r = s.engine.run(s.id);
  const msg = "password=SYNTHETIC-NOT-A-REAL-SECRET";
  s.engine.remember(r, "utente", msg);
  s.engine.event(r, "agent.message", msg, "codex");
  expect(JSON.stringify(s.db.get(s.id))).not.toContain(
    "SYNTHETIC-NOT-A-REAL-SECRET",
  );
  expect(JSON.stringify(exportRun(s.db, s.id))).not.toContain(
    "SYNTHETIC-NOT-A-REAL-SECRET",
  );
});

it("CT-008 · /allega rifiuta file di credenziali, anche con altro nome o percorso", async () => {
  const s = await sessione();
  const fuori = mkdtempSync(join(tmpdir(), "continuity-allega-"));
  dirs.push(fuori);
  const casi = [
    ".env",
    ".env.local",
    "id_ed25519",
    "server.pem",
    "auth.json",
    ".npmrc",
  ];
  for (const nome of casi) {
    writeFileSync(join(fuori, nome), "SYNTHETIC=1\n");
    expect(() => s.engine.allega(s.id, join(fuori, nome)), nome).toThrow(
      /credenziali|sensibil/,
    );
  }
  mkdirSync(join(fuori, ".ssh"));
  writeFileSync(join(fuori, ".ssh", "config"), "Host x\n");
  expect(() => s.engine.allega(s.id, join(fuori, ".ssh", "config"))).toThrow(
    /credenziali|sensibil/,
  );
  expect(existsSync(join(s.work, "allegati", ".env"))).toBe(false);
  // Un file normale passa; due file con lo stesso nome non si sovrascrivono.
  mkdirSync(join(fuori, "a"));
  mkdirSync(join(fuori, "b"));
  writeFileSync(join(fuori, "a", "nota.txt"), "PRIMA\n");
  writeFileSync(join(fuori, "b", "nota.txt"), "SECONDA\n");
  s.engine.allega(s.id, join(fuori, "a", "nota.txt"));
  const r: any = s.engine.allega(s.id, join(fuori, "b", "nota.txt"));
  expect(r.allegati).toHaveLength(2);
  const contenuti = r.allegati.map((n: string) =>
    readFileSync(join(s.work, "allegati", n), "utf8"),
  );
  expect(contenuti.sort()).toEqual(["PRIMA\n", "SECONDA\n"]);
});

it("CT-002 · un turno fallito non viene presentato come concluso", async () => {
  const s = await sessione();
  const r = s.engine.run(s.id);
  r.turnNumber = 1;
  r.state = "STARTING";
  s.engine.event(r, "audit.setup", "avvio");
  r.state = "RUNNING";
  s.engine.event(r, "audit.setup", "turno in corso");
  writeFileSync(join(r.work, "failed-output.txt"), "mezzo lavoro\n");
  await s.engine.endTurn(
    s.id,
    "Turno interrotto: codex si è interrotto (uscita 7)",
    true,
  );
  const tipi = s.db.eventiRecenti(s.id, 10).map((e: any) => e.type);
  expect(tipi).toContain("turn.failed");
  expect(tipi).not.toContain("turn.completed");
  expect(s.engine.run(s.id).ultimoTurnoFallito).toBe(true);
});

it("CT-001 · dopo un riavvio non parte un secondo writer finché il primo è vivo", async () => {
  const s = await sessione();
  // Il processo del turno precedente, sopravvissuto al crash del servizio.
  const orfano = spawn("sleep", ["60"], { detached: true, stdio: "ignore" });
  orfano.unref();
  try {
    const r = s.engine.run(s.id);
    r.attemptId = "orfano";
    writeFileSync(
      join(r.dir, "attempt-orfano.json"),
      JSON.stringify({
        pid: orfano.pid,
        binary: "/bin/sleep",
        status: "spawned",
      }),
    );
    r.pid = orfano.pid;
    r.state = "STARTING";
    s.engine.event(r, "audit.setup", "avvio");
    r.state = "RUNNING";
    s.engine.event(r, "audit.setup", "al lavoro");
    // Il servizio riparte: un motore nuovo sullo stesso archivio.
    await s.engine.shutdown().catch(() => {});
    const nuovo = new Engine(s.db);
    aperti.push({ engine: nuovo, db: s.db });
    expect(nuovo.run(s.id).state).toBe("BLOCKED");
    // Riprendere ferma l'orfano prima di tutto, e solo dopo lavora.
    await nuovo.turn(s.id, "continua").catch(() => {});
    await new Promise((ok) => setTimeout(ok, 300));
    let vivo = true;
    try {
      process.kill(orfano.pid!, 0);
    } catch {
      vivo = false;
    }
    expect(vivo).toBe(false);
    const tipi = s.db.eventiRecenti(s.id, 30).map((e: any) => e.type);
    expect(tipi).toContain("recovery.orphan_stopped");
  } finally {
    try {
      process.kill(-orfano.pid!, "SIGKILL");
    } catch {}
  }
}, 30000);

it("CT-001 · un pid finito a un altro programma non viene toccato", async () => {
  const { identificaGruppo } = await import("../src/supervisor/process.js");
  const estraneo = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
  estraneo.unref();
  try {
    await new Promise((ok) => setTimeout(ok, 100));
    // La ricevuta dice «codex», ma con quel pid ora gira un altro programma.
    expect(identificaGruppo(estraneo.pid!, "/opt/bin/codex")).toBe("altro");
    expect(identificaGruppo(estraneo.pid!, "/bin/sleep")).toBe("nostro");
  } finally {
    try {
      process.kill(-estraneo.pid!, "SIGKILL");
    } catch {}
  }
});

// Revisione del 4 ottobre (B1): dopo una pausa pulita la ricevuta restava
// «spawned», e riprendendo giorni dopo si controllava un pid ormai di un
// altro programma — fermandolo, o bloccando la sessione per sempre.
it("CT-001 · una ricevuta chiusa o di un turno finito non tocca processi altrui", async () => {
  const s = await sessione();
  const estraneo = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
  estraneo.unref();
  try {
    const r = s.engine.run(s.id);
    r.attemptId = "vecchio";
    // Turno finito normalmente: nessun pid nella run, ricevuta mai chiusa
    // (versioni precedenti) e il suo numero ora appartiene a un altro.
    writeFileSync(
      join(r.dir, "attempt-vecchio.json"),
      JSON.stringify({
        pid: estraneo.pid,
        binary: "/bin/sleep",
        status: "spawned",
      }),
    );
    s.engine.event(r, "audit.setup", "turno precedente finito");
    await s.engine.assicuraNessunWriter(s.engine.run(s.id));
    // Ricevuta chiusa esplicitamente, anche con il pid ancora nella run.
    const r2 = s.engine.run(s.id);
    r2.pid = estraneo.pid;
    writeFileSync(
      join(r2.dir, "attempt-vecchio.json"),
      JSON.stringify({
        pid: estraneo.pid,
        binary: "/bin/sleep",
        status: "stopped",
      }),
    );
    await s.engine.assicuraNessunWriter(r2);
    process.kill(estraneo.pid!, 0); // ancora vivo: nessuno l'ha toccato
  } finally {
    try {
      process.kill(-estraneo.pid!, "SIGKILL");
    } catch {}
  }
});

it("CT-001 · un processo di sistema con lo stesso numero non blocca la sessione", async () => {
  const { identificaGruppo } = await import("../src/supervisor/process.js");
  // pid 1 è launchd, di root: prima la risposta EPERM diventava «incerto».
  expect(identificaGruppo(1, "/opt/bin/codex")).toBe("altro");
});

// Revisione del 4 ottobre (B3): la redazione lasciava il token dopo «Bearer»
// e storpiava frasi normali della richiesta conservata in memoria.
it("CT-009 · la redazione toglie i token e lascia stare le frasi normali", async () => {
  const { redact } = await import("../src/persistence/redact.js");
  expect(redact("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig")).toBe(
    "Authorization: Bearer [REDACTED]",
  );
  for (const frase of [
    "il campo password: deve avere almeno 12 caratteri",
    "const password = leggi();",
  ])
    expect(redact(frase)).toBe(frase);
  expect(redact("password=SYNTHETIC-NOT-A-REAL-SECRET")).toBe(
    "password=[REDACTED]",
  );
});

// Collaudo utente del 5 ottobre: dopo conflitto, «/applica forza» e
// «/annulla», l'AI riassumeva il titolo come «Titolo scritto dall'AI» mentre
// nel file c'era la versione della persona. Quei fatti non arrivavano mai
// nella memoria della sessione.
it("conflitto, forza e annulla arrivano nella memoria che legge l'AI successiva", async () => {
  const { projectPrompt } = await import("../src/adapters/live.js");
  const s = await sessione();
  writeFileSync(join(s.work, "old.txt"), "AI\n");
  writeFileSync(join(s.project, "old.txt"), "USER NEW\n");
  expect(() => s.engine.applyToProject(s.id)).toThrow(/non si applicano/);
  s.engine.applyToProject(s.id, { forza: true });
  s.engine.annullaUltimo(s.id);
  const r = s.engine.run(s.id);
  const note = r.transcript
    .filter((t: any) => t.role === "continuity")
    .map((t: any) => t.text);
  expect(note.some((t: string) => t.includes("Consegna bloccata"))).toBe(true);
  expect(note.some((t: string) => t.includes("/applica forza"))).toBe(true);
  expect(note.some((t: string) => t.includes("/annulla"))).toBe(true);
  const prompt = projectPrompt({
    role: "writer",
    goal: "x",
    work: r.work,
    criteria: [],
    transcript: [...r.transcript, { role: "utente", text: "Riassumi" }],
    request: "Riassumi",
  });
  expect(prompt).toContain(
    "[Continuity] L'utente ha annullato l'ultima consegna",
  );
});
