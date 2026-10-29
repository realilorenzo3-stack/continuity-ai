import { it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  preparaPubblicazione,
  eseguiPubblicazione,
  risolviDestinazione,
  indirizzoWeb,
} from "../src/core/pubblica.js";
import { openProject } from "../src/core/project.js";
import { Store } from "../src/persistence/store.js";
import { Engine } from "../src/core/engine.js";

const dirs: string[] = [];
afterEach(() =>
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })),
);
const temp = (n: string) => {
  const d = mkdtempSync(join(tmpdir(), n));
  dirs.push(d);
  return d;
};
const git = (cwd: string, ...a: string[]) =>
  execFileSync("git", ["-c", "user.name=T", "-c", "user.email=t@l", ...a], {
    cwd,
    encoding: "utf8",
  }).trim();
// Un «GitHub» locale: un repository bare, eventualmente con un primo commit.
function remoto(file: Record<string, string> = {}) {
  const bare = join(temp("gh-"), "sito.git");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", bare]);
  if (Object.keys(file).length) {
    const lavoro = temp("gh-lavoro-");
    git(lavoro, "clone", "-q", bare, ".");
    for (const [n, c] of Object.entries(file))
      writeFileSync(join(lavoro, n), c);
    git(lavoro, "add", "-A");
    git(lavoro, "commit", "-qm", "iniziale");
    git(lavoro, "push", "-q", "origin", "HEAD:main");
  }
  return bare;
}
function cartella(file: Record<string, string>) {
  const root = temp("sito-");
  for (const [n, c] of Object.entries(file)) {
    mkdirSync(join(root, n, ".."), { recursive: true });
    writeFileSync(join(root, n), c);
  }
  return root;
}
const fileSu = (bare: string) =>
  git(bare, "ls-tree", "-r", "--name-only", "main").split("\n").filter(Boolean);

it("pubblica in un repository vuoto, senza credenziali, dipendenze e file ignorati, e senza toccare la cartella", () => {
  const root = cartella({
    "index.html": "<h1>Ciao</h1>\n",
    ".gitignore": "dist/\n",
    "dist/out.js": "build\n",
    ".env": "TOKEN=x\n",
    ".env.example": "PUBLIC_URL=\n",
    "node_modules/pkg/i.js": "x\n",
  });
  const bare = remoto();
  const prep = join(temp("prep-"), "p");
  const a = preparaPubblicazione(root, bare, prep);
  expect(a.vuotoSuGithub).toBe(true);
  expect(a.aggiunti.sort()).toEqual([
    ".env.example",
    ".gitignore",
    "index.html",
  ]);
  expect(a.esclusi).toEqual([".env"]);
  const esito = eseguiPubblicazione(prep, a, "Continuity: primo invio");
  expect(esito.commit).toMatch(/^[0-9a-f]{40}$/);
  expect(fileSu(bare).sort()).toEqual([
    ".env.example",
    ".gitignore",
    "index.html",
  ]);
  expect(existsSync(join(root, ".git"))).toBe(false);
});

it("su un repository con file già presenti mostra modificati ed eliminati prima del push", () => {
  const bare = remoto({ "README.md": "vecchio\n", "vecchio.txt": "x\n" });
  const root = cartella({ "README.md": "nuovo\n", "index.html": "<h1/>\n" });
  const prep = join(temp("prep-"), "p");
  const a = preparaPubblicazione(root, bare, prep);
  expect(a.vuotoSuGithub).toBe(false);
  expect(a.ramo).toBe("main");
  expect(a.aggiunti).toEqual(["index.html"]);
  expect(a.modificati).toEqual(["README.md"]);
  expect(a.eliminati).toEqual(["vecchio.txt"]);
  eseguiPubblicazione(prep, a, "aggiornamento");
  expect(fileSu(bare).sort()).toEqual(["README.md", "index.html"]);
  expect(git(bare, "log", "--format=%s", "main").split("\n")).toEqual([
    "aggiornamento",
    "iniziale",
  ]);
});

it("una cartella già sotto Git non viene pubblicata da Continuity", () => {
  const root = cartella({ "a.txt": "a\n" });
  git(root, "init", "-q");
  expect(() =>
    preparaPubblicazione(root, remoto(), join(temp("prep-"), "p")),
  ).toThrow(/già un repository Git/);
});

it("destinazioni: utente/repo, indirizzo, indirizzo web del commit", () => {
  expect(risolviDestinazione("realilorenzo3-stack/Continuity_website")).toBe(
    "https://github.com/realilorenzo3-stack/Continuity_website.git",
  );
  expect(risolviDestinazione("https://github.com/a/b.git")).toBe(
    "https://github.com/a/b.git",
  );
  expect(indirizzoWeb("https://github.com/a/b.git", "abc")).toBe(
    "https://github.com/a/b/commit/abc",
  );
});

it("dalla sessione: anteprima, segreti bloccati, cartella cambiata = nuova anteprima, poi pubblicazione", async () => {
  const root = cartella({ "index.html": "<h1>Sito</h1>\n" });
  const data = temp("dati-");
  const bare = remoto({ "README.md": "x\n" });
  const p = openProject(root);
  const db = new Store(data);
  const engine = new Engine(db);
  try {
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
      },
      { providers: ["codex", "claude"] },
    );
    expect(() => engine.anteprimaPubblicazione(run.id)).toThrow(/Dimmi dove/);
    // Un segreto nel sito.
    writeFileSync(join(root, "config.js"), "const password = 'Segreta1234';\n");
    let a = engine.anteprimaPubblicazione(run.id, bare);
    expect(a.sospetti).toEqual(["config.js"]);
    expect(() => engine.pubblica(run.id, a.piano)).toThrow(/segreti/);
    // La cartella cambia dopo l'anteprima.
    rmSync(join(root, "config.js"));
    a = engine.anteprimaPubblicazione(run.id);
    writeFileSync(join(root, "index.html"), "<h1>Cambiato</h1>\n");
    expect(() => engine.pubblica(run.id, a.piano)).toThrow(/cambiati/);
    // Chi ha lavorato e chi ha controllato: in fondo al commit (AI Act).
    const r = engine.run(run.id);
    engine.remember(r, "ai", "Ho cambiato il titolo.", "codex");
    r.suggerimenti = [{ id: "s1", testo: "x", da: "Sicurezza · Groq · openai/gpt-oss-120b", stato: "inviato" }];
    engine.event(r, "review.marked", "prova");
    a = engine.anteprimaPubblicazione(run.id);
    const esito = engine.pubblica(run.id, a.piano);
    expect(esito.ramo).toBe("main");
    expect(git(bare, "log", "-1", "--format=%B", "main")).toMatch(
      /Codice scritto o controllato con l'aiuto di AI, tramite Continuity: Codex, Groq\./,
    );
    expect(git(bare, "show", "main:index.html")).toBe("<h1>Cambiato</h1>");
    // La cartella standard di Continuity fa parte del progetto.
    expect(fileSu(bare)).toEqual(["continuity/README.md", "index.html"]);
    expect(
      engine
        .run(run.id)
        .transcript.some((t: any) =>
          /pubblicato la sua cartella su GitHub/.test(t.text),
        ),
    ).toBe(true);
  } finally {
    await engine.shutdown();
    db.close();
  }
}, 60000);
