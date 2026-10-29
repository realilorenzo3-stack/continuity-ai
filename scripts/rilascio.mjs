#!/usr/bin/env node
// pnpm rilascio <versione>: pubblica una versione di Continuity con un comando
// solo (piano di pubblicazione, punto 4).
//   1. controlla che la repository sia pulita, sul ramo main, e che le note
//      della versione (CHANGELOG.md, «## Prossima versione») ci siano;
//   2. esegue tipi, compilazione e tutte le prove;
//   3. scrive la versione in package.json e nelle note, fa il commit e
//      l'etichetta v<versione> qui, e li manda su GitHub;
//   4. copia nella repository pubblica (realilorenzo3-stack/continuity-ai) solo
//      ciò che è in scripts/pubblici.txt, con il commit «Continuity <versione>»
//      e la stessa etichetta. Da lì GitHub Actions prepara il pacchetto con
//      l'impronta e la pagina della versione (.github/workflows/versione.yml).
//
// Opzioni: --prova <cartella> fa tutto in locale, senza commit né invii: la
// copia pubblica finisce nella cartella indicata. --senza-prove salta il
// punto 2 (solo con --prova).
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const radice = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PUBBLICA = process.env.CONTINUITY_REPO_PUBBLICA ?? "https://github.com/realilorenzo3-stack/continuity-ai.git";
// I commit pubblici non portano nome del computer né indirizzi di casa:
// l'indirizzo «noreply» di GitHub dell'account.
const AUTORE = ["-c", "user.name=Lorenzo Reali", "-c", "user.email=300788351+realilorenzo3-stack@users.noreply.github.com"];

const args = process.argv.slice(2);
const versione = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--prova");
const prova = args.includes("--prova") ? args[args.indexOf("--prova") + 1] : undefined;
const senzaProve = args.includes("--senza-prove");

const esci = (testo) => {
  console.error(testo);
  process.exit(1);
};
const git = (argomenti, cwd = radice, opzioni = {}) =>
  execFileSync("git", argomenti, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opzioni }).trim();
const passo = (testo) => console.log(`· ${testo}`);

if (!versione || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(versione))
  esci("Uso: pnpm rilascio <versione>  (per esempio 2.0.1, oppure 2.1.0-beta.1 per un'anteprima)");
if (senzaProve && !prova) esci("--senza-prove si usa solo con --prova");

// 1. Repository pulita, ramo main, etichetta nuova, note scritte.
// (Con --prova no: serve a vedere la copia pubblica anche mentre si lavora.)
if (!prova) {
  if (git(["status", "--porcelain", "--untracked-files=no"])) esci("Ci sono modifiche non salvate: fai il commit prima del rilascio.");
  if (git(["rev-parse", "--abbrev-ref", "HEAD"]) !== "main") esci("Il rilascio si fa dal ramo main.");
  if (git(["tag", "--list", `v${versione}`])) esci(`La versione ${versione} esiste già.`);
}
const fileNote = join(radice, "CHANGELOG.md");
const note = readFileSync(fileNote, "utf8");
const sezione = /## Prossima versione\n([\s\S]*?)(?=\n## |\s*$)/.exec(note);
if (!sezione || !sezione[1].trim())
  esci("Scrivi in CHANGELOG.md, sotto «## Prossima versione», che cosa cambia per chi usa Continuity.");
const testoNote = sezione[1].trim();

// 2. Tipi, compilazione, prove.
if (!senzaProve) {
  for (const [nome, comando] of [
    ["tipi", ["exec", "tsc", "--noEmit"]],
    ["tipi dell'interfaccia", ["exec", "tsc", "-p", "tsconfig.tui.json", "--noEmit"]],
    ["compilazione", ["build"]],
    ["prove", ["exec", "vitest", "run"]],
  ]) {
    passo(nome);
    try {
      execFileSync("pnpm", comando, { cwd: radice, stdio: ["ignore", "ignore", "inherit"] });
    } catch {
      esci(`Rilascio fermato: ${nome} non riuscit${nome === "compilazione" ? "a" : "e"}.`);
    }
  }
}

// 3. Versione e note.
const data = new Date().toISOString().slice(0, 10);
const pacchetto = JSON.parse(readFileSync(join(radice, "package.json"), "utf8"));
const nuovoPacchetto = readFileSync(join(radice, "package.json"), "utf8").replace(`"version": "${pacchetto.version}"`, `"version": "${versione}"`);
const nuoveNote = note.replace(sezione[0], `## Prossima versione\n\n## ${versione} — ${data}\n\n${testoNote}\n`);

// 4. La copia pubblica: solo i file tracciati dei percorsi in pubblici.txt.
const elenco = readFileSync(join(radice, "scripts", "pubblici.txt"), "utf8")
  .split("\n")
  .map((r) => r.trim())
  .filter((r) => r && !r.startsWith("#"));
// I file di Git, compresi i nuovi non ancora nel commit (ma mai quelli
// ignorati da .gitignore): l'elenco filtra il resto.
const tracciati = git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"]).split("\0").filter((f) => f && existsSync(join(radice, f)));
const daCopiare = tracciati.filter((f) => elenco.some((p) => f === p || f.startsWith(p + "/")));
for (const p of elenco) if (!daCopiare.some((f) => f === p || f.startsWith(p + "/"))) esci(`In pubblici.txt c'è ${p}, ma non è un file della repository.`);

function riempi(cartella) {
  for (const voce of readdirSync(cartella)) if (voce !== ".git") rmSync(join(cartella, voce), { recursive: true, force: true });
  for (const f of daCopiare) {
    mkdirSync(dirname(join(cartella, f)), { recursive: true });
    cpSync(join(radice, f), join(cartella, f));
  }
  writeFileSync(join(cartella, "package.json"), nuovoPacchetto);
  writeFileSync(join(cartella, "CHANGELOG.md"), nuoveNote);
}

if (prova) {
  const cartella = resolve(prova);
  mkdirSync(cartella, { recursive: true });
  riempi(cartella);
  passo(`prova: copia pubblica della versione ${versione} in ${cartella} (${daCopiare.length} file); nessun commit, nessun invio`);
  process.exit(0);
}

writeFileSync(join(radice, "package.json"), nuovoPacchetto);
writeFileSync(fileNote, nuoveNote);
git(["add", "package.json", "CHANGELOG.md"]);
git(["commit", "-qm", `Versione ${versione}`]);
git(["tag", "-a", `v${versione}`, "-m", `Continuity ${versione}`]);
passo(`commit e etichetta v${versione} in questa repository`);
git(["push", "-q", "origin", "main", `v${versione}`]);

const lavoro = mkdtempSync(join(tmpdir(), "continuity-rilascio-"));
try {
  git(["clone", "-q", PUBBLICA, "pubblica"], lavoro);
  const cartella = join(lavoro, "pubblica");
  riempi(cartella);
  git(["add", "-A"], cartella);
  git([...AUTORE, "commit", "-q", "--allow-empty", "-m", `Continuity ${versione}\n\n${testoNote}`], cartella);
  git([...AUTORE, "tag", "-a", `v${versione}`, "-m", `Continuity ${versione}`], cartella);
  git(["push", "-q", "origin", "HEAD:main", `v${versione}`], cartella);
  passo(`versione ${versione} mandata nella repository pubblica: GitHub prepara il pacchetto in pochi minuti`);
  console.log(`Pagina della versione: ${PUBBLICA.replace(/\.git$/, "")}/releases/tag/v${versione}`);
} finally {
  rmSync(lavoro, { recursive: true, force: true });
}
