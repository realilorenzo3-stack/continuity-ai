// Dalla prova reale dell'11 ottobre su sito_1: un falso allarme di segreti su
// un .env.example, documenti spostati in una cartella ignorata che sparivano
// dalla cartella della persona, AI che si preoccupavano della storia Git della
// copia, e la richiesta di pubblicare su GitHub dopo ogni modifica.
import { it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  renameSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Engine } from "../src/core/engine.js";
import { Store } from "../src/persistence/store.js";
import { openProject } from "../src/core/project.js";
import {
  preparaPubblicazione,
  segretoProbabile,
} from "../src/core/pubblica.js";
import { intentoAutomatica, intentoPubblica } from "../src/cli/session.js";
import { projectPrompt } from "../src/adapters/live.js";

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
const temp = (n: string) => {
  const d = mkdtempSync(join(tmpdir(), n));
  dirs.push(d);
  return d;
};
const git = (cwd: string, ...a: string[]) =>
  execFileSync("git", ["-c", "user.name=T", "-c", "user.email=t@l", ...a], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

async function sessione(
  file: Record<string, string>,
  conGit: boolean,
  dati = temp("dati-"),
  project = temp("progetto-"),
) {
  for (const [nome, contenuto] of Object.entries(file)) {
    mkdirSync(join(project, nome, ".."), { recursive: true });
    writeFileSync(join(project, nome), contenuto);
  }
  if (conGit && !existsSync(join(project, ".git"))) {
    git(project, "init", "-q");
    git(project, "add", "-A");
    git(project, "commit", "-qm", "base");
  }
  const p = openProject(project);
  const db = new Store(dati);
  const engine = new Engine(db);
  aperti.push({ engine, db });
  const run = await engine.create(
    "Sito",
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
  return { project, engine, id: run.id, work: engine.run(run.id).work, dati };
}

it("un segnaposto in un .env.example non è un segreto, un valore vero sì", () => {
  for (const testo of [
    "SUPABASE_URL=https://your-project.supabase.co\nSUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY\n",
    "API_KEY=<la tua chiave>",
    "API_KEY=${API_KEY}",
    "DB_PASSWORD=changeme",
    "STRIPE_SECRET_KEY=xxxxxxxx",
    '"password": "your-password-here"',
  ])
    expect(segretoProbabile(testo), testo).toBe(false);
  for (const testo of [
    "API_KEY=a8Fk29dLqP0zX",
    '"password": "S3greto!lungo"',
    "token = ghp_abcdefghijklmnop1234",
    "DB_PASSWORD=changeme\nSECRET_KEY=Zq81kLmN0pRs",
  ])
    expect(segretoProbabile(testo), testo).toBe(true);
});

it("la pubblicazione non chiede conferma per il .env.example con segnaposto", () => {
  const bare = join(temp("gh-"), "sito.git");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", bare]);
  const root = temp("sito-");
  writeFileSync(join(root, "index.html"), "<h1>Ciao</h1>\n");
  writeFileSync(
    join(root, ".env.example"),
    "SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY\n",
  );
  const a = preparaPubblicazione(root, bare, join(temp("pub-"), "c"));
  expect(a.aggiunti).toContain(".env.example");
  expect(a.sospetti).toEqual([]);
});

for (const conGit of [false, true]) {
  const dove = conGit ? "con Git" : "senza Git";

  it(`un file spostato dall'AI in una cartella ignorata arriva, build e segreti no (${dove})`, async () => {
    const s = await sessione(
      {
        ".gitignore": "gitignore/\ndist/\n.env\n*.log\n",
        "AUDIT.md": "audit\n",
        "index.html": "<h1>Ciao</h1>\n",
      },
      conGit,
    );
    mkdirSync(join(s.work, "gitignore"), { recursive: true });
    renameSync(join(s.work, "AUDIT.md"), join(s.work, "gitignore/AUDIT.md"));
    mkdirSync(join(s.work, "dist"), { recursive: true });
    writeFileSync(join(s.work, "dist/index.html"), "build\n");
    writeFileSync(join(s.work, ".env"), "API_KEY=Segreto123456\n");
    writeFileSync(join(s.work, "npm-debug.log"), "log\n");
    expect(s.engine.changedFiles(s.engine.run(s.id)).sort()).toEqual([
      "AUDIT.md",
      "gitignore/AUDIT.md",
    ]);
    s.engine.applyToProject(s.id);
    expect(readFileSync(join(s.project, "gitignore/AUDIT.md"), "utf8")).toBe(
      "audit\n",
    );
    expect(existsSync(join(s.project, "AUDIT.md"))).toBe(false);
    for (const assente of ["dist", ".env", "npm-debug.log"])
      expect(existsSync(join(s.project, assente)), assente).toBe(false);
    // Consegnato una volta: se la persona lo elimina non torna.
    expect(s.engine.changedFiles(s.engine.run(s.id))).toEqual([]);
    rmSync(join(s.project, "gitignore"), { recursive: true });
    writeFileSync(join(s.work, "index.html"), "<h1>Due</h1>\n");
    s.engine.applyToProject(s.id);
    expect(existsSync(join(s.project, "gitignore/AUDIT.md"))).toBe(false);
  });

  it(`un file ignorato che la persona ha già non viene toccato né resta in sospeso (${dove})`, async () => {
    const s = await sessione(
      { ".gitignore": "note/\n", "index.html": "<h1>Ciao</h1>\n" },
      conGit,
    );
    mkdirSync(join(s.project, "note"));
    writeFileSync(join(s.project, "note/mie.md"), "della persona\n");
    mkdirSync(join(s.work, "note"), { recursive: true });
    writeFileSync(join(s.work, "note/mie.md"), "dell'AI\n");
    writeFileSync(join(s.work, "note/nuova.md"), "nuova\n");
    expect(s.engine.changedFiles(s.engine.run(s.id))).toEqual([
      "note/nuova.md",
    ]);
    s.engine.applyToProject(s.id);
    expect(readFileSync(join(s.project, "note/mie.md"), "utf8")).toBe(
      "della persona\n",
    );
    expect(readFileSync(join(s.project, "note/nuova.md"), "utf8")).toBe(
      "nuova\n",
    );
    // /annulla toglie anche ciò che è arrivato dalla cartella ignorata.
    s.engine.annullaUltimo(s.id);
    expect(existsSync(join(s.project, "note/nuova.md"))).toBe(false);
    expect(readFileSync(join(s.project, "note/mie.md"), "utf8")).toBe(
      "della persona\n",
    );
  });
}

it("la scelta sulla pubblicazione automatica e il repository restano al progetto", async () => {
  const bare = join(temp("gh-"), "sito.git");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", bare]);
  const s = await sessione({ "index.html": "<h1>Ciao</h1>\n" }, false);
  expect(s.engine.impostazioneGithub(s.id)).toEqual({
    destinazione: undefined,
    automatica: undefined,
  });
  const a = s.engine.anteprimaPubblicazione(s.id, bare);
  const esito = s.engine.pubblica(s.id, a.piano);
  // Mai chiesto: la CLI farà la domanda.
  expect(esito.automatica).toBeUndefined();
  s.engine.impostaPubblicazioneAutomatica(s.id, true);
  await s.engine.closeSession(s.id, { forza: true }).catch(() => {});
  // Una nuova sessione sullo stesso progetto ricorda tutto.
  const t = await sessione({}, false, s.dati, s.project);
  expect(t.engine.impostazioneGithub(t.id)).toEqual({
    destinazione: bare,
    automatica: true,
  });
  writeFileSync(join(t.project, "index.html"), "<h1>Due</h1>\n");
  const b = t.engine.anteprimaPubblicazione(t.id);
  expect(b.destinazione).toBe(bare);
  expect(t.engine.pubblica(t.id, b.piano).automatica).toBe(true);
  t.engine.impostaPubblicazioneAutomatica(t.id, false);
  expect(t.engine.impostazioneGithub(t.id).automatica).toBe(false);
  // Fuori dal progetto: un'AI non può cambiare dove finiscono i push.
  expect(existsSync(join(t.project, "github-progetti.json"))).toBe(false);
  expect(existsSync(join(s.dati, "github-progetti.json"))).toBe(true);
});

it("«attiva la pubblicazione automatica» cambia la scelta, non pubblica", () => {
  expect(intentoAutomatica("attiva la pubblicazione automatica")).toBe(true);
  expect(intentoAutomatica("voglio il push automatico su github")).toBe(true);
  expect(intentoAutomatica("disattiva la pubblicazione automatica")).toBe(
    false,
  );
  expect(intentoAutomatica("non voglio più la pubblicazione automatica")).toBe(
    false,
  );
  expect(intentoAutomatica("pubblica su git")).toBeUndefined();
  expect(
    intentoAutomatica("come funziona la pubblicazione automatica?"),
  ).toBeUndefined();
  expect(intentoPubblica("pubblica su git")).toEqual({
    destinazione: undefined,
  });
});

it("le AI sanno come pubblica Continuity e quando la pubblicazione è automatica", () => {
  const base = {
    role: "writer" as const,
    goal: "sito",
    work: "/tmp/w",
    criteria: [],
  };
  const manuale = projectPrompt(base);
  expect(manuale).toMatch(/scrivere «pubblica su git»/);
  expect(manuale).toMatch(/storia Git[^.]*non vengono mai inviati/);
  const auto = projectPrompt({
    ...base,
    pubblicazioneAutomatica: "https://github.com/u/sito.git",
  });
  expect(auto).toMatch(/pubblicazione automatica su GitHub è attiva/);
  expect(auto).toMatch(/non chiedere all'utente di scrivere «pubblica su git»/);
});

// Solo dove il disco non distingue le maiuscole (il Mac): su Linux «sito» e
// «Sito» sono due cartelle diverse, ed è giusto che restino tali.
const discoSenzaMaiuscole = (() => {
  const d = mkdtempSync(join(tmpdir(), "maiuscole-prova-"));
  try {
    writeFileSync(join(d, "A"), "");
    return existsSync(join(d, "a"));
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
})();

it.skipIf(!discoSenzaMaiuscole)("la stessa cartella scritta con maiuscole diverse ritrova sessione e scelte su GitHub", async () => {
  const { cartellaCanonica, stessaCartella } = await import(
    "../src/core/project.js"
  );
  const base = temp("maiuscole-");
  const vera = join(base, "Sito");
  // Il disco del Mac non distingue le maiuscole: «sito» e «SITO» sono «Sito».
  const s = await sessione(
    { "index.html": "<h1>Ciao</h1>\n" },
    false,
    undefined,
    vera,
  );
  expect(existsSync(join(base, "SITO"))).toBe(true);
  expect(cartellaCanonica(join(base, "sito"))).toBe(cartellaCanonica(vera));
  expect(stessaCartella(join(base, "sito"), vera)).toBe(true);
  expect(stessaCartella(join(base, "altro"), vera)).toBe(false);
  // La sessione aperta su «Sito» è la stessa di chi scrive «sito».
  expect(
    stessaCartella(
      s.engine.run(s.id).project.root,
      openProject(join(base, "sito")).root,
    ),
  ).toBe(true);
  // Le scelte salvate con la chiave in minuscolo valgono ancora, e alla
  // prima modifica la chiave diventa quella vera.
  writeFileSync(
    join(s.dati, "github-progetti.json"),
    JSON.stringify({
      [join(base, "sito")]: { destinazione: "x/y", automatica: true },
    }),
  );
  expect(s.engine.impostazioneGithub(s.id).automatica).toBe(true);
  s.engine.impostaPubblicazioneAutomatica(s.id, false);
  const salvate = JSON.parse(
    readFileSync(join(s.dati, "github-progetti.json"), "utf8"),
  );
  expect(salvate).toEqual({
    [cartellaCanonica(vera)]: { destinazione: "x/y", automatica: false },
  });
});
