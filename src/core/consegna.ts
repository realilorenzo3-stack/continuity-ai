import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { percorsoSensibile } from "./sensibili.js";
import { ambienteGit } from "../git/ambiente.js";

// Come il lavoro dell'AI arriva nella cartella della persona. Un solo percorso
// per cartelle con e senza Git: prima esistevano due rami, e quello senza Git
// ricavava i file dalle righe «+++ b/» di una patch testuale — cancellazioni,
// rinomine e file binari andavano persi, e una modifica fatta nel frattempo
// dalla persona veniva sovrascritta senza dirlo (collaudo del 3 ottobre,
// CT-003, CT-004, CT-005, CT-014).
//
// Ogni file viene confrontato in tre stati: la base (l'ultimo stato comune,
// cioè il commit della copia di lavoro), la versione dell'AI e quella attuale
// della persona. Se la persona non l'ha toccato si prende la versione
// dell'AI; se l'hanno cambiato entrambi in punti diversi di un testo, si
// uniscono; altrimenti è un conflitto, e non si scrive nulla.

export type Operazione = {
  path: string;
  // Il contenuto finale: null significa che il file non deve esistere.
  finale: Buffer | null;
  mode?: number;
  // Vero se il finale è un'unione: va scritto anche nella copia di lavoro.
  unito?: boolean;
  // Vero se il file era in conflitto e si sta forzando la versione dell'AI.
  forzato?: boolean;
};

export type Piano = {
  operazioni: Operazione[];
  conflitti: string[];
  // File che la consegna non sa trattare (collegamenti simbolici): restano
  // in sospeso nella copia, non entrano nella base.
  saltati: string[];
  // File già identici nelle due copie: entrano nella base senza scrivere.
  allineati: string[];
  // Percorsi che nella cartella della persona attraversano un collegamento
  // simbolico: scriverli vorrebbe dire scrivere fuori dal progetto.
  bloccati: string[];
};

// Vero se nessun pezzo del percorso, dalla radice in giù, è un collegamento
// simbolico. Una cartella del progetto sostituita da un collegamento portava
// la consegna a scrivere fuori dal progetto (collaudo del 5 ottobre, CT-016).
export function percorsoConfinato(radice: string, percorso: string) {
  // Anche la cartella del progetto stessa: sostituita da un collegamento, ogni
  // percorso al suo interno finirebbe altrove (collaudo del 5 ottobre, CT-022).
  if (!radiceVera(radice)) return false;
  let corrente = radice;
  for (const parte of percorso.split("/")) {
    corrente = join(corrente, parte);
    try {
      if (lstatSync(corrente).isSymbolicLink()) return false;
    } catch {
      return true; // da qui in giù non esiste ancora: niente da attraversare
    }
  }
  return true;
}
// La radice è una cartella vera, non un collegamento e non sparita.
export function radiceVera(radice: string) {
  try {
    const s = lstatSync(radice);
    return s.isDirectory() && !s.isSymbolicLink();
  } catch {
    return false;
  }
}
export function controllaConfinamento(radice: string, percorsi: string[]) {
  if (!radiceVera(radice))
    throw Error(
      `La cartella ${radice} non è più una cartella vera (è un collegamento simbolico o non esiste): non scrivo niente.`,
    );
  const fuori = percorsi.filter((p) => !percorsoConfinato(radice, p));
  if (fuori.length)
    throw Error(
      `${fuori.join(", ")}: nella tua cartella il percorso passa da un collegamento simbolico, e scrivere lì vorrebbe dire modificare file fuori dal progetto. Non scrivo niente: sostituisci il collegamento con una cartella vera, oppure lascia il file all'AI nella copia.`,
    );
}

const ambiente = ambienteGit();
const git = (cwd: string, args: string[]) =>
  execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
    cwd,
    env: ambienteGit(cwd),
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });

export const impronta = (b: Buffer | null) =>
  b === null ? null : createHash("sha256").update(b).digest("hex");
const uguali = (a: Buffer | null, b: Buffer | null) =>
  a === null || b === null ? a === b : a.equals(b);

function leggi(radice: string, percorso: string): Buffer | null {
  const pieno = join(radice, percorso);
  try {
    const s = lstatSync(pieno);
    if (!s.isFile()) return null;
    return readFileSync(pieno);
  } catch {
    return null;
  }
}

// La base com'è sul disco, non com'è archiviata: con fine riga CRLF o altri
// filtri dichiarati in .gitattributes il blob grezzo è diverso dal file, e
// ogni modifica dell'AI sembrava un conflitto con la persona.
// Che cosa c'è nella base a quel percorso: un file (con il suo permesso di
// esecuzione) oppure niente. Una cartella nella base non è un file: leggerla
// come tale restituiva il suo elenco e creava conflitti inesistenti.
function voceBase(work: string, percorso: string) {
  try {
    const riga = git(work, ["ls-tree", "-z", "HEAD", "--", percorso])
      .toString("utf8")
      .split("\u0000")[0];
    const [modo, tipoOggetto] = riga.split(/\s+/);
    if (tipoOggetto !== "blob") return { blob: false, eseguibile: false };
    return { blob: true, eseguibile: modo === "100755" };
  } catch {
    return { blob: false, eseguibile: false };
  }
}
// La base com'è sul disco, non com'è archiviata: con fine riga CRLF o altri
// filtri dichiarati in .gitattributes il blob grezzo è diverso dal file, e
// ogni modifica dell'AI sembrava un conflitto con la persona.
function base(work: string, percorso: string): Buffer | null {
  if (!voceBase(work, percorso).blob) return null;
  try {
    return git(work, ["cat-file", "--filters", `HEAD:${percorso}`]);
  } catch {
    try {
      return git(work, ["cat-file", "blob", `HEAD:${percorso}`]);
    } catch {
      return null;
    }
  }
}
const eseguibileInBase = (work: string, percorso: string) =>
  voceBase(work, percorso).eseguibile;
const eseguibile = (radice: string, percorso: string) => {
  try {
    const s = lstatSync(join(radice, percorso));
    return s.isFile() && (s.mode & 0o111) !== 0;
  } catch {
    return false;
  }
};
const tipo = (radice: string, percorso: string) => {
  try {
    const s = lstatSync(join(radice, percorso));
    return s.isDirectory() ? "dir" : s.isSymbolicLink() ? "link" : "file";
  } catch {
    return "assente";
  }
};
// Tutti i file sotto una cartella, come percorsi relativi alla radice.
function fileSotto(radice: string, cartella: string): string[] {
  const fuori: string[] = [];
  const scendi = (rel: string) => {
    for (const voce of readdirSync(join(radice, rel), {
      withFileTypes: true,
    })) {
      const figlio = rel + "/" + voce.name;
      if (voce.isDirectory()) scendi(figlio);
      else fuori.push(figlio);
    }
  };
  // Una cartella che non si riesce a leggere (permessi, dati di un
  // container) non è vuota: ignorare l'errore faceva sembrare libera la
  // strada, e la consegna cancellava i file della persona che c'erano.
  try {
    scendi(cartella);
  } catch (e) {
    throw Error(
      `Non riesco a leggere tutto ${cartella} nella tua cartella (${(e as NodeJS.ErrnoException).code ?? "errore"}): la consegna si ferma per non perdere file tuoi`,
    );
  }
  return fuori;
}

const binario = (b: Buffer) => b.subarray(0, 8000).includes(0);

// Unione a tre vie di un testo, senza bisogno di un repository.
function unisci(persona: Buffer, comune: Buffer, ai: Buffer): Buffer | null {
  if ([persona, comune, ai].some(binario)) return null;
  const cartella = mkdtempSync(join(tmpdir(), "continuity-unione-"));
  try {
    const [p, b, a] = ["persona", "base", "ai"].map((n) => join(cartella, n));
    writeFileSync(p, persona);
    writeFileSync(b, comune);
    writeFileSync(a, ai);
    try {
      return execFileSync("git", ["merge-file", "-p", p, b, a], {
        env: ambiente,
        maxBuffer: 256 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      // Uscita positiva: conflitti. Negativa: errore. In entrambi i casi non
      // c'è un'unione pulita da proporre.
      return null;
    }
  } finally {
    rmSync(cartella, { recursive: true, force: true });
  }
}

// I percorsi che l'AI ha cambiato rispetto alla base, delimitati da NUL:
// i nomi con spazi, accenti o virgolette non vengono citati né spezzati.
// File nuovi che l'AI ha messo dove il .gitignore del progetto non guarda.
// Prima non arrivavano mai: spostare un documento in una cartella ignorata
// (prova reale dell'11 ottobre, «gitignore/») lo faceva sparire dalla
// cartella della persona, perché lo spostamento arrivava come eliminazione.
// Restano fuori i risultati di build, le cache, i log e le credenziali, e i
// file che la persona ha già: senza una base comune non si sa chi li ha
// cambiati, e la versione della persona non si tocca. Una volta consegnati
// entrano nella base della copia, così non tornano se la persona li elimina.
const GENERATI = new Set([
  "dist",
  "build",
  "out",
  ".astro",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".output",
  ".vercel",
  ".netlify",
  ".wrangler",
  ".turbo",
  ".cache",
  ".parcel-cache",
  ".vite",
  ".gradle",
  ".terraform",
  ".tox",
  ".continuity",
  "coverage",
  ".nyc_output",
  "test-results",
  "playwright-report",
  "blob-report",
  "target",
  "tmp",
  "temp",
  ".tmp",
  "logs",
]);
const FILE_GENERATI =
  /(^|\/)(\.DS_Store|Thumbs\.db)$|\.(log|pyc|pyo|tsbuildinfo|swp|tmp)$/i;
const LIMITE_IGNORATI = 500;
const LIMITE_FILE = 20 * 1024 * 1024;
export function ignoratiDaConsegnare(
  work: string,
  root: string,
  daConsegnare: (p: string) => boolean,
): string[] {
  let voci: string[];
  try {
    voci = git(work, [
      "ls-files",
      "--others",
      "--ignored",
      "--exclude-standard",
      "--directory",
      "-z",
    ])
      .toString("utf8")
      .split("\u0000")
      .filter(Boolean);
  } catch {
    return [];
  }
  const ammesso = (p: string) =>
    daConsegnare(p.replace(/\/$/, "")) &&
    !p.split("/").some((parte) => GENERATI.has(parte)) &&
    !FILE_GENERATI.test(p.replace(/\/$/, "")) &&
    !percorsoSensibile(join(work, p.replace(/\/$/, "")));
  const fuori: string[] = [];
  const aggiungi = (p: string) => {
    try {
      const s = lstatSync(join(work, p));
      if (!s.isFile() || s.size > LIMITE_FILE) return;
    } catch {
      return;
    }
    if (lstatOpzionale(join(root, p))) return;
    fuori.push(p);
  };
  for (const voce of voci) {
    if (!ammesso(voce)) continue;
    if (!voce.endsWith("/")) {
      aggiungi(voce);
      continue;
    }
    // Una cartella intera ignorata: i suoi file, finché sono pochi. Una
    // cartella con migliaia di file è materiale generato, non lavoro.
    const dentro: string[] = [];
    let troppi = false;
    const scendi = (rel: string) => {
      if (troppi) return;
      for (const e of readdirSync(join(work, rel), { withFileTypes: true })) {
        const figlio = rel + e.name;
        if (e.isSymbolicLink()) continue;
        if (e.isDirectory()) {
          if (ammesso(figlio + "/")) scendi(figlio + "/");
        } else if (e.isFile() && ammesso(figlio)) dentro.push(figlio);
        if (dentro.length > LIMITE_IGNORATI) {
          troppi = true;
          return;
        }
      }
    };
    try {
      scendi(voce);
    } catch {
      continue;
    }
    if (!troppi) dentro.forEach(aggiungi);
  }
  return fuori.length > LIMITE_IGNORATI ? [] : fuori.sort();
}
const lstatOpzionale = (p: string) => {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
};

export function percorsiCambiati(
  work: string,
  daConsegnare: (p: string) => boolean,
  root?: string,
) {
  const tracciati = git(work, [
    "diff",
    "--name-only",
    "-z",
    "--no-renames",
    "HEAD",
  ])
    .toString("utf8")
    .split("\u0000");
  const nuovi = git(work, ["ls-files", "--others", "--exclude-standard", "-z"])
    .toString("utf8")
    .split("\u0000");
  const ignorati = root ? ignoratiDaConsegnare(work, root, daConsegnare) : [];
  return [...new Set([...tracciati, ...nuovi, ...ignorati])]
    .filter(Boolean)
    .filter(daConsegnare)
    .sort();
}

export function pianoConsegna(
  work: string,
  root: string,
  daConsegnare: (p: string) => boolean,
  forza = false,
): Piano {
  const piano: Piano = {
    operazioni: [],
    conflitti: [],
    saltati: [],
    allineati: [],
    bloccati: [],
  };
  for (const percorso of percorsiCambiati(work, daConsegnare, root)) {
    if (tipo(work, percorso) === "link") {
      piano.saltati.push(percorso);
      continue;
    }
    if (!percorsoConfinato(root, percorso)) {
      piano.bloccati.push(percorso);
      continue;
    }
    const comune = base(work, percorso);
    const ai = leggi(work, percorso);
    const persona = leggi(root, percorso);
    // Il permesso di esecuzione segue la stessa regola del contenuto: vale
    // quello dell'AI se l'ha cambiato lei, altrimenti resta quello della
    // persona. Prima si prendeva sempre quello dell'AI, e un chmod fatto a
    // mano spariva con la consegna (CT-018).
    const exAi = eseguibile(work, percorso);
    const exBase = eseguibileInBase(work, percorso);
    const exFinale =
      persona !== null && exAi === exBase ? eseguibile(root, percorso) : exAi;
    const modoAi = ai
      ? lstatSync(join(work, percorso)).mode & 0o777
      : undefined;
    // Dall'AI arriva solo il permesso di esecuzione: lettura e scrittura
    // restano quelle del file della persona. Prendendo tutto dalla copia, un
    // file privato (0600) diventava leggibile da tutti (0644).
    let modoPersona: number | undefined;
    if (persona !== null)
      try {
        modoPersona = lstatSync(join(root, percorso)).mode & 0o777;
      } catch {}
    const modoBase = modoPersona ?? modoAi;
    const mode =
      modoAi === undefined || modoBase === undefined
        ? undefined
        : exFinale
          ? modoBase | ((modoBase & 0o444) >> 2)
          : modoBase & ~0o111;
    // Stesso contenuto: resta da allineare solo il permesso di esecuzione,
    // se l'ha cambiato l'AI e non la persona.
    if (uguali(persona, ai)) {
      if (
        ai &&
        eseguibile(work, percorso) !== eseguibile(root, percorso) &&
        eseguibile(root, percorso) === eseguibileInBase(work, percorso)
      )
        piano.operazioni.push({ path: percorso, finale: ai, mode });
      else piano.allineati.push(percorso);
      continue;
    }
    // La persona non l'ha toccato: vale la versione dell'AI. (Una sua
    // cartella al posto del file si controlla dopo, sul piano intero.)
    const personaInBase = uguali(persona, comune);
    if (personaInBase) {
      piano.operazioni.push({ path: percorso, finale: ai, mode });
      continue;
    }
    // Entrambi l'hanno cambiato: un testo modificato in punti diversi si unisce.
    const unione = persona && comune && ai ? unisci(persona, comune, ai) : null;
    if (unione) {
      piano.operazioni.push({
        path: percorso,
        finale: unione,
        mode,
        unito: true,
      });
      continue;
    }
    if (forza)
      piano.operazioni.push({
        path: percorso,
        finale: ai,
        mode,
        forzato: true,
      });
    else piano.conflitti.push(percorso);
  }
  // Un file da scrivere dove la persona ha una cartella: va bene solo se ogni
  // file di quella cartella viene eliminato dallo stesso piano.
  const eliminati = new Set(
    piano.operazioni.filter((o) => o.finale === null).map((o) => o.path),
  );
  for (const op of [...piano.operazioni])
    if (op.finale !== null && tipo(root, op.path) === "dir") {
      const extra = fileSotto(root, op.path).filter((f) => !eliminati.has(f));
      if (!extra.length) continue;
      if (forza) {
        // Forzando, i file nuovi della persona in quella cartella vengono
        // tolti come operazioni esplicite: così entrano nel punto di
        // ripristino e /annulla li restituisce (CT-019).
        op.forzato = true;
        for (const f of extra)
          piano.operazioni.push({ path: f, finale: null, forzato: true });
      } else {
        piano.operazioni = piano.operazioni.filter((o) => o !== op);
        piano.conflitti.push(op.path);
      }
    }
  // Prima le eliminazioni, dalle più profonde; poi le scritture.
  piano.operazioni.sort((x, y) =>
    (x.finale === null) !== (y.finale === null)
      ? x.finale === null
        ? -1
        : 1
      : x.finale === null
        ? y.path.split("/").length - x.path.split("/").length
        : x.path.localeCompare(y.path),
  );
  return piano;
}

// Toglie le cartelle rimaste vuote risalendo verso la radice: eliminare una
// cartella intera non deve lasciarne lo scheletro.
export function potaVuote(radice: string, percorso: string) {
  let cartella = dirname(percorso);
  while (cartella && cartella !== ".") {
    const piena = join(radice, cartella);
    try {
      if (readdirSync(piena).length) return;
      rmdirSync(piena);
    } catch {
      return;
    }
    cartella = dirname(cartella);
  }
}

export function scrivi(radice: string, op: Operazione) {
  // Ricontrollato qui, non solo nel piano: un collegamento creato nel
  // frattempo non deve diventare una via d'uscita dal progetto.
  controllaConfinamento(radice, [op.path]);
  const pieno = join(radice, op.path);
  try {
    if (op.finale === null) {
      rmSync(pieno, { recursive: true, force: true });
      potaVuote(radice, op.path);
      return;
    }
    // Una cartella rimasta al posto del file (vuota, o forzata) lascia spazio.
    if (tipo(radice, op.path) === "dir")
      rmSync(pieno, { recursive: true, force: true });
    mkdirSync(dirname(pieno), { recursive: true });
    writeFileSync(pieno, op.finale);
    if (op.mode !== undefined) chmodSync(pieno, op.mode);
  } catch (e: any) {
    // Un file aperto in un programma di Windows (da WSL) o protetto: lo si
    // dice con il suo nome. Chi chiama rimette la cartella com'era.
    if (["EBUSY", "EPERM", "EACCES", "ETXTBSY"].includes(e?.code))
      throw Error(
        `Non posso scrivere ${op.path}: è aperto in un altro programma o protetto. Chiudilo e riprova con /applica`,
      );
    throw e;
  }
}

// Esegue un piano nella cartella della persona e controlla, file per file, che
// il risultato sia quello previsto. Solo dopo il controllo le unioni vengono
// scritte anche nella copia di lavoro: le due copie restano identiche.
export function eseguiPiano(work: string, root: string, piano: Piano) {
  for (const op of piano.operazioni) scrivi(root, op);
  const divergenti = piano.operazioni
    .filter((op) => !uguali(leggi(root, op.path), op.finale))
    .map((op) => op.path);
  if (divergenti.length)
    throw Error(
      `Consegna non verificata: ${divergenti.join(", ")} non corrisponde a ciò che doveva essere scritto`,
    );
  for (const op of piano.operazioni) {
    if (op.unito) scrivi(work, op);
    // Le due copie devono avere anche lo stesso permesso di esecuzione.
    else if (op.finale !== null && op.mode !== undefined)
      try {
        if (tipo(work, op.path) === "file")
          chmodSync(join(work, op.path), op.mode);
      } catch {}
  }
}

// Con contenuto già uguale nelle due copie non c'è niente da scrivere, ma il
// permesso di esecuzione può essere diverso: vale quello della persona, e va
// riportato nella copia prima che la base avanzi (CT-024).
export function allineaPermessi(
  work: string,
  root: string,
  percorsi: string[],
) {
  for (const p of percorsi) {
    if (tipo(work, p) !== "file" || tipo(root, p) !== "file") continue;
    const modoPersona = lstatSync(join(root, p)).mode & 0o777;
    const modoCopia = lstatSync(join(work, p)).mode & 0o777;
    if ((modoPersona & 0o111) !== (modoCopia & 0o111))
      chmodSync(join(work, p), modoPersona);
  }
}

// Che cosa la persona ha cambiato nella sua cartella dall'ultima consegna, sui
// file che l'AI non ha toccato: aggiunte, modifiche, eliminazioni. All'inizio
// di un turno la copia si allinea, altrimenti l'AI lavora su una cartella
// vecchia (una foto aggiunta dopo l'apertura della sessione non c'era, prova
// dell'8 ottobre). I file cambiati da entrambi restano alla consegna, che li
// unisce o segnala il conflitto.
export function cambiamentiDellaPersona(
  work: string,
  root: string,
  daConsegnare: (p: string) => boolean,
  fileDellaPersona: string[],
): { path: string; contenuto: Buffer | null }[] {
  if (!radiceVera(root) || !radiceVera(work)) return [];
  const inBase = new Map<string, string>();
  for (const voce of git(work, ["ls-tree", "-r", "-z", "HEAD"])
    .toString("utf8")
    .split("\u0000")) {
    const m = /^(\d+) blob ([0-9a-f]+)\t(.+)$/.exec(voce);
    if (m) inBase.set(m[3], m[2]);
  }
  const toccatiDallAI = new Set(percorsiCambiati(work, () => true));
  // I file che il progetto stesso ignora (.astro, dist, cache: scritti da
  // strumenti nella cartella della persona) non fanno parte del lavoro: Git
  // rifiutava di registrarli e l'allineamento falliva (prova dell'8 ottobre).
  const nuovi = fileDellaPersona.filter((p) => !inBase.has(p));
  const ignorati = new Set<string>();
  if (nuovi.length) {
    const esito = spawnSync(
      "git",
      ["-c", "core.hooksPath=/dev/null", "check-ignore", "-z", "--stdin"],
      {
        cwd: work,
        env: ambienteGit(work),
        input: nuovi.join("\u0000") + "\u0000",
        maxBuffer: 64 * 1024 * 1024,
      },
    );
    for (const p of String(esito.stdout ?? "").split("\u0000"))
      if (p) ignorati.add(p);
  }
  const candidati = [...new Set([...fileDellaPersona, ...inBase.keys()])]
    .filter(daConsegnare)
    .filter((p) => !ignorati.has(p))
    .filter((p) => !toccatiDallAI.has(p))
    .filter((p) => percorsoConfinato(root, p) && percorsoConfinato(work, p));
  // Le impronte dei file della persona in una sola chiamata: confrontarli
  // uno per uno con la base era troppo lento sui progetti grandi.
  const presenti = candidati.filter((p) => {
    try {
      const s = lstatSync(join(root, p));
      return s.isFile() && s.size <= 100 * 1024 * 1024;
    } catch {
      return false;
    }
  });
  const impronte = new Map<string, string>();
  if (presenti.length) {
    const righe = execFileSync(
      "git",
      [
        "-c",
        "core.hooksPath=/dev/null",
        "hash-object",
        "--no-filters",
        "--stdin-paths",
      ],
      {
        cwd: work,
        env: ambienteGit(work),
        input: presenti.map((p) => join(root, p)).join("\n") + "\n",
        maxBuffer: 64 * 1024 * 1024,
      },
    )
      .toString("utf8")
      .trim()
      .split("\n");
    presenti.forEach((p, i) => impronte.set(p, righe[i]));
  }
  const fuori: { path: string; contenuto: Buffer | null }[] = [];
  for (const p of candidati) {
    const suo = impronte.get(p);
    const diBase = inBase.get(p);
    if (suo === diBase) continue;
    // Impronte diverse ma stesso file sul disco (filtri, fine riga): uguale.
    if (suo && diBase && uguali(leggi(root, p), base(work, p))) continue;
    fuori.push({ path: p, contenuto: suo ? leggi(root, p) : null });
  }
  return fuori;
}
