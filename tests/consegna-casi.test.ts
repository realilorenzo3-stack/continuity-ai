// Casi limite della consegna trovati dalla revisione indipendente del 4
// ottobre sul nuovo percorso a tre stati. Ognuno è stato riprodotto prima
// della correzione.
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
  lstatSync,
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

async function sessione(
  file: Record<string, string | Buffer>,
  conGit: boolean,
  prima?: (root: string) => void,
) {
  const base = mkdtempSync(join(tmpdir(), "continuity-casi-"));
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
  prima?.(project);
  const p = openProject(project);
  const db = new Store(join(base, "dati"));
  const engine = new Engine(db);
  aperti.push({ engine, db });
  const run = await engine.create(
    "Casi",
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
  return { project, engine, id: run.id, work: engine.run(run.id).work };
}

for (const conGit of [false, true]) {
  const dove = conGit ? "con Git" : "senza Git";

  it(`/annulla non inghiotte il lavoro non ancora consegnato (${dove})`, async () => {
    const s = await sessione({ "a.txt": "A\n", "b.txt": "B\n" }, conGit);
    writeFileSync(join(s.work, "a.txt"), "A2\n");
    s.engine.applyToProject(s.id);
    writeFileSync(join(s.work, "b.txt"), "B-AI\n"); // turno dopo, non consegnato
    s.engine.annullaUltimo(s.id);
    expect(leggi(join(s.project, "a.txt"))).toBe("A\n");
    expect(s.engine.changedFiles(s.engine.run(s.id))).toEqual(["b.txt"]);
    s.engine.applyToProject(s.id);
    expect(leggi(join(s.project, "b.txt"))).toBe("B-AI\n");
  });

  it(`una cartella sostituita da un file arriva intera, e si annulla (${dove})`, async () => {
    const s = await sessione({ "d/x.txt": "X\n", "a.txt": "A\n" }, conGit);
    rmSync(join(s.work, "d"), { recursive: true });
    writeFileSync(join(s.work, "d"), "ORA SONO UN FILE\n");
    writeFileSync(join(s.work, "a.txt"), "A2\n");
    s.engine.applyToProject(s.id);
    expect(leggi(join(s.project, "d"))).toBe("ORA SONO UN FILE\n");
    expect(leggi(join(s.project, "a.txt"))).toBe("A2\n");
    s.engine.annullaUltimo(s.id);
    for (const radice of [s.project, s.work]) {
      expect(leggi(join(radice, "d", "x.txt"))).toBe("X\n");
      expect(leggi(join(radice, "a.txt"))).toBe("A\n");
    }
  });

  it(`un file sostituito da una cartella si annulla (${dove})`, async () => {
    const s = await sessione({ d: "FILE\n" }, conGit);
    unlinkSync(join(s.work, "d"));
    mkdirSync(join(s.work, "d"));
    writeFileSync(join(s.work, "d", "y.txt"), "Y\n");
    s.engine.applyToProject(s.id);
    expect(leggi(join(s.project, "d", "y.txt"))).toBe("Y\n");
    s.engine.annullaUltimo(s.id);
    for (const radice of [s.project, s.work])
      expect(leggi(join(radice, "d"))).toBe("FILE\n");
  });

  it(`una cartella eliminata non lascia lo scheletro vuoto (${dove})`, async () => {
    const s = await sessione({ "d/e/x.txt": "X\n", "a.txt": "A\n" }, conGit);
    rmSync(join(s.work, "d"), { recursive: true });
    s.engine.applyToProject(s.id);
    expect(existsSync(join(s.project, "d"))).toBe(false);
  });

  it(`un collegamento simbolico resta in sospeso, non entra nella base (${dove})`, async () => {
    const s = await sessione({ "b.txt": "B\n", "c.txt": "C\n" }, conGit);
    unlinkSync(join(s.work, "b.txt"));
    symlinkSync("c.txt", join(s.work, "b.txt"));
    const esito: any = s.engine.applyToProject(s.id);
    expect(esito.saltati).toEqual(["b.txt"]);
    expect(s.engine.changedFiles(s.engine.run(s.id))).toContain("b.txt");
  });

  it(`un cambio del solo permesso di esecuzione arriva (${dove})`, async () => {
    const s = await sessione({ "run.sh": "#!/bin/sh\necho ok\n" }, conGit);
    chmodSync(join(s.work, "run.sh"), 0o755);
    s.engine.applyToProject(s.id);
    expect(statSync(join(s.project, "run.sh")).mode & 0o111).not.toBe(0);
  });
}

it("con Git, i file tracciati in vendor/ vengono consegnati", async () => {
  const s = await sessione(
    { "vendor/lib.go": "v1\n", "main.go": "m1\n" },
    true,
  );
  writeFileSync(join(s.work, "vendor", "lib.go"), "v2\n");
  writeFileSync(join(s.work, "main.go"), "m2\n");
  s.engine.applyToProject(s.id);
  expect(leggi(join(s.project, "vendor", "lib.go"))).toBe("v2\n");
  expect(leggi(join(s.project, "main.go"))).toBe("m2\n");
});

it("senza Git, vendor/ è lavoro: va nella copia e torna con /annulla", async () => {
  const s = await sessione(
    { "vendor/lib.go": "v1\n", "main.go": "m1\n" },
    false,
  );
  expect(lstatSync(join(s.work, "vendor")).isSymbolicLink()).toBe(false);
  writeFileSync(join(s.work, "vendor", "lib.go"), "v2\n");
  // Finché non viene consegnato, la cartella dell'utente non cambia.
  expect(leggi(join(s.project, "vendor", "lib.go"))).toBe("v1\n");
  s.engine.applyToProject(s.id);
  expect(leggi(join(s.project, "vendor", "lib.go"))).toBe("v2\n");
});

it("senza Git, le cartelle generate (dist/) non bloccano la consegna", async () => {
  const s = await sessione(
    { "src.js": "1\n", "dist/app.js": "VECCHIO\n" },
    false,
  );
  mkdirSync(join(s.work, "dist"), { recursive: true });
  writeFileSync(join(s.work, "dist", "app.js"), "NUOVO BUILD\n");
  writeFileSync(join(s.work, "src.js"), "2\n");
  s.engine.applyToProject(s.id);
  expect(leggi(join(s.project, "src.js"))).toBe("2\n");
  expect(leggi(join(s.project, "dist", "app.js"))).toBe("VECCHIO\n");
});

it("con fine riga CRLF dichiarate in .gitattributes non nascono falsi conflitti", async () => {
  const s = await sessione(
    {
      ".gitattributes": "*.txt text eol=crlf\n",
      "a.txt": "uno\r\ndue\r\ntre\r\n",
    },
    true,
  );
  const corrente = readFileSync(join(s.work, "a.txt"), "utf8");
  writeFileSync(join(s.work, "a.txt"), corrente.replace("due", "DUE"));
  s.engine.applyToProject(s.id);
  expect(leggi(join(s.project, "a.txt"))).toContain("DUE");
});

it("una sessione si apre anche con una modifica binaria non salvata, e non sporca il repository se fallisce", async () => {
  const s = await sessione(
    { "img.bin": Buffer.from([0, 1, 2, 3]) },
    true,
    (root) => writeFileSync(join(root, "img.bin"), Buffer.from([0, 9, 9, 9])),
  );
  expect(readFileSync(join(s.work, "img.bin")).toString("hex")).toBe(
    "00090909",
  );
});

for (const conGit of [false, true]) {
  const dove = conGit ? "con Git" : "senza Git";

  it(`la consegna conserva i permessi privati della persona (${dove})`, async () => {
    const s = await sessione({ "segreto.txt": "v1\n" }, conGit);
    chmodSync(join(s.project, "segreto.txt"), 0o600);
    writeFileSync(join(s.work, "segreto.txt"), "v2\n");
    s.engine.applyToProject(s.id);
    expect(leggi(join(s.project, "segreto.txt"))).toBe("v2\n");
    expect(statSync(join(s.project, "segreto.txt")).mode & 0o777).toBe(0o600);
  });

  it(`una cartella illeggibile ferma la consegna invece di perdere i file della persona (${dove})`, async () => {
    const s = await sessione({ "x/a.txt": "A\n" }, conGit);
    // La persona aggiunge file e una cartella che non si può leggere.
    writeFileSync(join(s.project, "x", "mio.txt"), "MIO\n");
    mkdirSync(join(s.project, "x", "chiusa"));
    writeFileSync(join(s.project, "x", "chiusa", "dentro.txt"), "D\n");
    chmodSync(join(s.project, "x", "chiusa"), 0o000);
    try {
      // L'AI trasforma la cartella x in un file.
      rmSync(join(s.work, "x"), { recursive: true, force: true });
      writeFileSync(join(s.work, "x"), "ORA SONO UN FILE\n");
      expect(() => s.engine.applyToProject(s.id, { forza: true })).toThrow(
        /non riesco a leggere/i,
      );
      expect(leggi(join(s.project, "x", "mio.txt"))).toBe("MIO\n");
    } finally {
      chmodSync(join(s.project, "x", "chiusa"), 0o755);
    }
  });
}

for (const conGit of [false, true]) {
  const dove = conGit ? "con Git" : "senza Git";
  it(`a inizio turno la copia si allinea ai cambiamenti della persona, senza toccare il lavoro dell'AI (${dove})`, async () => {
    const s = await sessione(
      { "a.txt": "A\n", "b.txt": "B\n", "c.txt": "C\n", "d.txt": "D\n" },
      conGit,
    );
    // L'AI ha lavorato su c.txt e d.txt (non ancora consegnati).
    writeFileSync(join(s.work, "c.txt"), "C-AI\n");
    writeFileSync(join(s.work, "d.txt"), "D-AI\n");
    // Nel frattempo la persona aggiunge una foto, cambia a.txt, elimina
    // b.txt e cambia anche d.txt (cambiato da entrambi).
    writeFileSync(
      join(s.project, "foto.png"),
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]),
    );
    writeFileSync(join(s.project, "a.txt"), "A-PERSONA\n");
    unlinkSync(join(s.project, "b.txt"));
    writeFileSync(join(s.project, "d.txt"), "D-PERSONA\n");
    const r = s.engine.run(s.id);
    s.engine.allineaAllaPersona(r);
    expect(readFileSync(join(s.work, "foto.png"))).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]),
    );
    expect(leggi(join(s.work, "a.txt"))).toBe("A-PERSONA\n");
    expect(existsSync(join(s.work, "b.txt"))).toBe(false);
    // Il lavoro dell'AI resta suo; il file cambiato da entrambi va alla consegna.
    expect(leggi(join(s.work, "c.txt"))).toBe("C-AI\n");
    expect(leggi(join(s.work, "d.txt"))).toBe("D-AI\n");
    expect(
      r.transcript.some(
        (t: any) => /foto\.png/.test(t.text) && /b\.txt/.test(t.text),
      ),
    ).toBe(true);
    // Da consegnare restano solo i file dell'AI.
    expect(s.engine.changedFiles(s.engine.run(s.id))).toEqual([
      "c.txt",
      "d.txt",
    ]);
  });
}

for (const conGit of [false, true]) {
  const dove = conGit ? "con Git" : "senza Git";
  it(`l'allineamento salta i file che il progetto ignora, come .astro (${dove})`, async () => {
    const s = await sessione(
      { ".gitignore": ".astro/\ndist/\n", "a.txt": "A\n" },
      conGit,
    );
    mkdirSync(join(s.project, ".astro"), { recursive: true });
    writeFileSync(join(s.project, ".astro", "cache.json"), "{}\n");
    writeFileSync(join(s.project, "logo.png"), "PNG\n");
    const r = s.engine.run(s.id);
    s.engine.allineaAllaPersona(r);
    const eventi = JSON.stringify(s.engine.store.events(s.id));
    expect(eventi).not.toContain("Non sono riuscito ad allineare");
    expect(leggi(join(s.work, "logo.png"))).toBe("PNG\n");
    expect(existsSync(join(s.work, ".astro", "cache.json"))).toBe(false);
  });
}
