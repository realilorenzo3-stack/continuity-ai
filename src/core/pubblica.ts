import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { redact } from "../persistence/redact.js";
import { percorsoSensibile } from "./sensibili.js";
import { autocrlfPerCartella } from "../git/ambiente.js";

// Pubblicazione su GitHub fatta da Continuity, non dall'AI: l'AI lavora in una
// sandbox, su una copia, senza le credenziali della persona, e non deve fare
// commit né push. /pubblica prepara il commit dalla cartella della persona in
// una cartella temporanea (la cartella della persona non diventa un
// repository e non viene toccata), mostra che cosa cambierà su GitHub e fa il
// push solo dopo la conferma, con il login GitHub del Mac, mai forzando.

export type Anteprima = {
  destinazione: string;
  ramo: string;
  aggiunti: string[];
  modificati: string[];
  eliminati: string[];
  esclusi: string[];
  sospetti: string[];
  vuotoSuGithub: boolean;
  piano: string;
};

// Cartelle che non si pubblicano mai: dipendenze, risultati di build, cache.
const MAI = new Set([
  ".git",
  "node_modules",
  ".venv",
  "venv",
  "__pycache__",
  ".cache",
  ".DS_Store",
  ".continuity",
  ".npm-cache",
  ".pytest_cache",
]);

// Git con la configurazione della persona (serve il suo login, cioè il suo
// «credential helper»), ma senza hook né fsmonitor: nessun comando scelto da
// un file del progetto viene eseguito.
function git(cwd: string, args: string[], input?: string, ambiente: NodeJS.ProcessEnv = {}) {
  return execFileSync(
    "git",
    ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", ...args],
    {
      cwd,
      input,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      env: { ...process.env, ...ambiente, GIT_TERMINAL_PROMPT: "0" },
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    },
  ).trim();
}
function messaggioDi(e: unknown) {
  const x = e as { stderr?: string; message?: string };
  return redact(String(x?.stderr || x?.message || e))
    .trim()
    .slice(0, 400);
}

// «Continuity_website», «utente/repo», un indirizzo https o ssh.
export function risolviDestinazione(testo: string): string {
  const t = testo.trim();
  // Anche un repository sul disco di Windows («C:\…\sito.git»).
  if (/^(https:\/\/|git@|ssh:\/\/|file:\/\/|\/)/.test(t) || /^[A-Za-z]:[\\/]/.test(t)) return t;
  if (/^[\w.-]+\/[\w.-]+$/.test(t))
    return `https://github.com/${t.replace(/\.git$/, "")}.git`;
  if (/^[\w.-]+$/.test(t)) {
    // Solo il nome: chiede a gh di quale account è.
    const gh = spawnSync(
      "gh",
      ["repo", "view", t, "--json", "url", "-q", ".url"],
      {
        encoding: "utf8",
        timeout: 20_000,
        env: process.env,
      },
    );
    const url = gh.stdout?.trim();
    if (gh.status === 0 && url) return url + ".git";
    throw Error(
      `Non trovo il repository «${t}» con il tuo account GitHub. Scrivi /pubblica utente/${t} (oppure l'indirizzo completo).`,
    );
  }
  throw Error(`Destinazione non valida: «${t}»`);
}

// I file della cartella della persona da pubblicare, con i relativi esclusi.
function fileDaPubblicare(root: string) {
  const file: string[] = [];
  const esclusi: string[] = [];
  const visita = (rel: string) => {
    for (const voce of readdirSync(join(root, rel), { withFileTypes: true })) {
      const percorso = rel ? rel + "/" + voce.name : voce.name;
      if (MAI.has(voce.name) || voce.isSymbolicLink()) continue;
      if (voce.isDirectory()) visita(percorso);
      else if (voce.isFile()) {
        // I modelli di configurazione (.env.example) sono fatti per essere
        // condivisi; il controllo dei segreti sul contenuto vale anche per loro.
        const modello = /^\.env\.(example|sample|template|dist)$/i.test(
          voce.name,
        );
        if (!modello && percorsoSensibile(join(root, percorso)))
          esclusi.push(percorso);
        else file.push(percorso);
      }
    }
  };
  visita("");
  return { file, esclusi };
}

// Un valore che dichiara di essere da sostituire: YOUR_API_KEY, <token>,
// ${SECRET}, changeme, xxxx. Nei modelli di configurazione (.env.example) è la
// norma, e segnalarlo come segreto faceva rispondere «no» a una pubblicazione
// innocua (prova reale dell'11 ottobre, SUPABASE_PUBLISHABLE_KEY=YOUR_…).
const SEGNAPOSTO =
  /^["']?(?:<[^>]*>|\$\{[^}]*\}|\{\{[^}]*\}\}|x{3,}|\*{3,}|\.{3,}|(?:[A-Za-z0-9]+[_-])*(?:your|my|example|sample|placeholder|changeme|change[_-]?me|replace[_-]?me|insert|dummy|fake|todo|tbd|redacted)(?:[_-][A-Za-z0-9]+)*)["']?[,;]?$/i;
export function segretoProbabile(testo: string) {
  const senzaSegnaposto = testo.replace(
    /([:=][ \t]*)([^\s]+)/g,
    (intero, separatore: string, valore: string) =>
      SEGNAPOSTO.test(valore) ? separatore : intero,
  );
  return redact(senzaSegnaposto) !== senzaSegnaposto;
}

// Prepara in «cartella» un clone della destinazione con dentro i file della
// persona, e dice che cosa cambierebbe su GitHub. Non scrive niente sul
// remoto e non tocca la cartella della persona.
export function preparaPubblicazione(
  root: string,
  destinazione: string,
  cartella: string,
): Anteprima {
  if (existsSync(join(root, ".git")))
    throw Error(
      "La tua cartella è già un repository Git: pubblicala con i tuoi comandi Git (commit e push), così la sua storia resta tua.",
    );
  rmSync(cartella, { recursive: true, force: true });
  mkdirSync(dirname(cartella), { recursive: true });
  try {
    git(dirname(cartella), [
      "clone",
      "--quiet",
      "--no-tags",
      destinazione,
      cartella,
    ]);
  } catch (e) {
    const motivo = messaggioDi(e);
    throw Error(
      /Authentication|could not read Username|Permission denied|403|denied/i.test(
        motivo,
      )
        ? "GitHub non ha accettato il login di questo computer. Collegalo una volta con «gh auth login» nel terminale, poi riprova /pubblica."
        : /not found|does not exist|Repository not found/i.test(motivo)
          ? `Il repository ${destinazione} non esiste o il tuo account non può vederlo.`
          : "Non riesco a raggiungere il repository: " + motivo,
    );
  }
  let vuotoSuGithub = false;
  let ramo = "";
  try {
    ramo = git(cartella, ["symbolic-ref", "--short", "HEAD"]);
    git(cartella, ["rev-parse", "--verify", "HEAD"]);
  } catch {
    vuotoSuGithub = true;
    ramo ||= "main";
  }
  // Al posto dei file del repository, quelli della persona.
  for (const voce of readdirSync(cartella))
    if (voce !== ".git")
      rmSync(join(cartella, voce), { recursive: true, force: true });
  const { file, esclusi } = fileDaPubblicare(root);
  for (const p of file) {
    mkdirSync(dirname(join(cartella, p)), { recursive: true });
    copyFileSync(join(root, p), join(cartella, p));
  }
  // .gitignore del progetto decide cosa resta fuori (dist, .env, …). Una
  // cartella sul disco di Windows, da WSL: le fine riga come le tratterebbe
  // Git per Windows.
  const autocrlf = autocrlfPerCartella(root);
  git(cartella, [...(autocrlf ? ["-c", `core.autocrlf=${autocrlf}`] : []), "add", "-A"]);
  const cambi = git(cartella, [
    "diff",
    "--cached",
    "--name-status",
    "--no-renames",
    "-z",
  ]).split("\u0000");
  const aggiunti: string[] = [];
  const modificati: string[] = [];
  const eliminati: string[] = [];
  for (let i = 0; i + 1 < cambi.length; i += 2) {
    const [stato, percorso] = [cambi[i], cambi[i + 1]];
    if (stato === "A") aggiunti.push(percorso);
    else if (stato === "D") eliminati.push(percorso);
    else if (percorso) modificati.push(percorso);
  }
  // Un segreto dentro un file pubblicato: quello che la redazione oscurerebbe.
  const sospetti = [...aggiunti, ...modificati].filter((p) => {
    try {
      const s = lstatSync(join(cartella, p));
      if (s.size > 1024 * 1024) return false;
      const testo = readFileSync(join(cartella, p), "utf8");
      return !testo.includes("\u0000") && segretoProbabile(testo);
    } catch {
      return false;
    }
  });
  const albero = git(cartella, ["write-tree"]);
  const base = vuotoSuGithub ? "" : git(cartella, ["rev-parse", "HEAD"]);
  return {
    destinazione,
    ramo,
    aggiunti,
    modificati,
    eliminati,
    esclusi,
    sospetti,
    vuotoSuGithub,
    piano: createHash("sha256")
      .update([destinazione, ramo, base, albero].join("\n"))
      .digest("hex")
      .slice(0, 16),
  };
}

// Chi firma il commit pubblicato. Prima c'era «Continuity
// <continuity@localhost>» quando git non aveva un nome: GitHub non lo lega a
// nessun account e Vercel Hobby blocca il deploy (segnalazione di Lorenzo del
// 31 ottobre). Per GitHub vale l'account collegato con gh: l'email di git
// solo se GitHub la conferma verificata per quell'account, altrimenti il suo
// indirizzo noreply esatto, «ID+login@users.noreply.github.com», costruito
// con l'ID e il login che GitHub stesso restituisce. Nessun indirizzo
// inventato: senza identità ci si ferma e si spiega come configurarla.
export type Identita = { nome: string; email: string; fonte: string };

export type DipendenzeIdentita = {
  gh: (args: string[]) => { ok: boolean; testo: string };
  gitConfig: (chiave: string) => string;
};

const dipendenzeVere: DipendenzeIdentita = {
  gh(args) {
    const r = spawnSync("gh", args, { encoding: "utf8", timeout: 20_000, env: process.env });
    return { ok: r.status === 0 && !r.error, testo: r.stdout ?? "" };
  },
  gitConfig(chiave) {
    const r = spawnSync("git", ["config", "--get", chiave], { encoding: "utf8", timeout: 10_000 });
    return r.status === 0 ? (r.stdout ?? "").trim() : "";
  },
};

export const SENZA_IDENTITA_GITHUB =
  "Per pubblicare serve sapere chi sei su GitHub, così i commit portano il tuo nome e il tuo account. Collega GitHub una volta con «gh auth login» nel terminale, poi riprova /pubblica.";
export const SENZA_IDENTITA_GIT =
  "Per pubblicare serve la tua identità Git. Impostala una volta nel terminale con «git config --global user.name \"Il tuo nome\"» e «git config --global user.email tua@email», poi riprova /pubblica.";

export function identitaPubblicazione(
  destinazione: string,
  dipendenze: DipendenzeIdentita = dipendenzeVere,
): Identita {
  const nomeGit = dipendenze.gitConfig("user.name");
  const emailGit = dipendenze.gitConfig("user.email");
  if (!/github\.com[:/]/i.test(destinazione)) {
    if (nomeGit && emailGit && !/@localhost$/i.test(emailGit))
      return { nome: nomeGit, email: emailGit, fonte: "configurazione di git" };
    throw Error(SENZA_IDENTITA_GIT);
  }
  const utente = dipendenze.gh(["api", "user"]);
  let account: { login?: string; id?: number; name?: string | null } = {};
  try {
    account = utente.ok ? JSON.parse(utente.testo) : {};
  } catch {}
  if (!account.login || !Number.isInteger(account.id)) throw Error(SENZA_IDENTITA_GITHUB);
  const nome = nomeGit || account.name?.trim() || account.login;
  // Le email verificate si leggono solo se gh ha il permesso «user:email»;
  // senza, vale il noreply, che non ne ha bisogno.
  if (emailGit) {
    const email = dipendenze.gh(["api", "user/emails"]);
    try {
      const elenco: { email?: string; verified?: boolean }[] = email.ok ? JSON.parse(email.testo) : [];
      if (elenco.some((x) => x.verified && x.email?.toLowerCase() === emailGit.toLowerCase()))
        return { nome, email: emailGit, fonte: `account GitHub ${account.login}, email verificata` };
    } catch {}
  }
  return {
    nome,
    email: `${account.id}+${account.login}@users.noreply.github.com`,
    fonte: `account GitHub ${account.login}, indirizzo noreply`,
  };
}

// Commit e push dalla cartella preparata. Mai forzando: se su GitHub nel
// frattempo è arrivato altro, il push viene rifiutato e lo si dice.
export function eseguiPubblicazione(
  cartella: string,
  anteprima: Anteprima,
  messaggio: string,
  identita: Identita = identitaPubblicazione(anteprima.destinazione),
) {
  if (
    !anteprima.aggiunti.length &&
    !anteprima.modificati.length &&
    !anteprima.eliminati.length
  )
    return { commit: undefined, gia: true };
  if (anteprima.vuotoSuGithub)
    git(cartella, ["checkout", "-q", "-b", anteprima.ramo]);
  // Autore e committer insieme, anche sopra variabili GIT_AUTHOR_* o
  // GIT_COMMITTER_* rimaste nell'ambiente.
  git(cartella, ["-c", `user.name=${identita.nome}`, "-c", `user.email=${identita.email}`, "commit", "-q", "-m", messaggio], undefined, {
    GIT_AUTHOR_NAME: identita.nome,
    GIT_AUTHOR_EMAIL: identita.email,
    GIT_COMMITTER_NAME: identita.nome,
    GIT_COMMITTER_EMAIL: identita.email,
  });
  // Si controlla nel clone, prima del push: se non torna, non parte nulla.
  const [an, ae, cn, ce] = git(cartella, ["log", "-1", "--format=%an%x00%ae%x00%cn%x00%ce"]).split("\u0000");
  if (an !== identita.nome || ae !== identita.email || cn !== identita.nome || ce !== identita.email)
    throw Error(
      `Il commit non porta la tua identità (autore ${an} <${ae}>, committer ${cn} <${ce}>): non ho pubblicato nulla.`,
    );
  try {
    git(cartella, ["push", "origin", `HEAD:refs/heads/${anteprima.ramo}`]);
  } catch (e) {
    const motivo = messaggioDi(e);
    throw Error(
      /rejected|non-fast-forward|fetch first/i.test(motivo)
        ? "Su GitHub nel frattempo è arrivato altro: non ho sovrascritto nulla. Riprova /pubblica, ripartirò dalla versione aggiornata."
        : /Authentication|denied|403/i.test(motivo)
          ? "GitHub non ha accettato il login di questo computer. Collegalo con «gh auth login», poi riprova /pubblica."
          : "Il push non è riuscito: " + motivo,
    );
  }
  return { commit: git(cartella, ["rev-parse", "HEAD"]), gia: false };
}

// L'indirizzo da aprire nel browser per vedere il commit.
export function indirizzoWeb(destinazione: string, commit?: string) {
  const m = /github\.com[:/]([\w.-]+\/[\w.-]+?)(\.git)?$/.exec(destinazione);
  if (!m) return undefined;
  return `https://github.com/${m[1]}${commit ? "/commit/" + commit : ""}`;
}
