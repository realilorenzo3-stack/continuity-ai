// Il revisore (Fase 2, decisioni di Lorenzo del 21 e 25 ottobre, CONTINUITY_2.0.md
// §5.16): un'AI che legge le modifiche e suggerisce, senza toccare i file. Di
// serie un servizio gratuito (Groq o Google), a fine turno: ogni turno oppure
// ogni 2, 3, … turni (decisione di Lorenzo del 28 ottobre: niente più
// revisione a minuti, che partiva a metà di un turno in corso). Qui: la configurazione, le modifiche da
// mostrare, la domanda e la lettura della risposta. Quando chiamarlo lo decide
// il motore.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { join, sep } from "node:path";
import { percorsoSensibile } from "./sensibili.js";
import { istruzioneLingua, LINGUA_PREDEFINITA, type Lingua } from "./lingua.js";
import { PROVIDER, type ProviderNoto } from "./provider.js";
import { chiediModello, ErroreGratuito, inOrdine, siPassaAlProssimo, type Messaggio } from "./gratuiti.js";
import { ambienteGit } from "../git/ambiente.js";

export type ConfigRevisore = {
  attivo: boolean;
  // Il servizio che rivede; senza, il primo gratuito collegato (Groq, Cloudflare, Google…).
  provider?: string;
  modello?: string;
  // Ogni quanti turni rivede: 1 = a ogni turno.
  ogniTurni: number;
  istruzioni: string;
  // I servizi per cui la persona ha detto sì all'invio del codice (quelli che
  // con il piano gratuito usano i dati), per questo progetto.
  consensi: string[];
  // «Correggi da solo» (decisione di Lorenzo del 28 ottobre): a fine turno
  // chi rivede corregge lui gli errori nei file, invece di suggerire.
  corregge?: boolean;
};

export const ISTRUZIONI_REVISORE =
  "Controlla che le modifiche facciano ciò che la persona ha chiesto e cerca errori concreti: bug, casi limite dimenticati, problemi di sicurezza, codice che non può funzionare. Ignora lo stile e le preferenze.";

export function revisorePredefinito(): ConfigRevisore {
  return { attivo: false, ogniTurni: 1, istruzioni: ISTRUZIONI_REVISORE, consensi: [] };
}

export const TURNI_MASSIMI = 10;

// Una configurazione salvata, anche di prima del 28 ottobre («quando» e
// «minuti»): diventa «ogni N turni», di serie a ogni turno.
export function normalizzaRevisore(salvata: any): ConfigRevisore {
  const { quando: _q, minuti: _m, ...resto } = { ...revisorePredefinito(), ...(salvata ?? {}) };
  const n = Math.round(Number(resto.ogniTurni));
  return { ...resto, ogniTurni: Number.isFinite(n) ? Math.max(1, Math.min(TURNI_MASSIMI, n)) : 1 };
}

// «a ogni turno», «ogni 3 turni».
export function descriviOgniTurni(n: number, en = false): string {
  return en ? (n <= 1 ? "every turn" : `every ${n} turns`) : n <= 1 ? "a ogni turno" : `ogni ${n} turni`;
}

// L'ordine in cui si sceglie il revisore gratuito, se la persona non ne indica
// uno: tutti i gratuiti, sullo stesso piano (decisione di Lorenzo del 28
// ottobre); prima quelli che non usano i dati per addestrare.
export const PREFERITI_REVISORE = ["groq", "cloudflare", "google", "mistral", "nvidia", "cohere"];

// Chi rivede: quello scelto (qualunque AI, dal 28 ottobre; un gratuito solo
// se collegato), altrimenti il primo dei gratuiti preferiti collegato.
export function sceltaRevisore(config: ConfigRevisore, collegato: (id: string) => boolean): ProviderNoto | undefined {
  const diretti = PROVIDER.filter((p) => p.motore === "diretto" && p.diretto);
  if (config.provider) {
    const p = PROVIDER.find((x) => x.id === config.provider);
    // Un servizio tolto da Continuity (Zen gratuito, GitHub Models, 28
    // ottobre) vale come «automatico».
    if (p) return p.motore !== "diretto" ? p : collegato(p.id) ? p : undefined;
  }
  for (const id of PREFERITI_REVISORE) {
    const p = diretti.find((x) => x.id === id);
    if (p && collegato(p.id)) return p;
  }
  return undefined;
}

// Chi rivede con un turno vero, dopo quello di chi ha lavorato: chi corregge,
// e le AI che lavorano attraverso un programma (Codex, Claude, Qwen…). Un
// gratuito che suggerisce soltanto risponde a una domanda, anche durante il
// lavoro.
export function rivedeConUnTurno(p: ProviderNoto, config: ConfigRevisore) {
  return Boolean(config.corregge) || p.motore !== "diretto";
}

// Serve il consenso della persona: il servizio, con il piano gratuito, può
// usare i dati (lo dice il campo «dati» del registro).
// Il consenso sui dati non si chiede più (decisione di Lorenzo del 28
// ottobre: «una riga quando li colleghi, poi basta»): che cosa fa ciascun
// servizio dei dati lo dice /collega, una volta, al collegamento.
export function serveConsenso(_p: ProviderNoto, _config: ConfigRevisore) {
  return false;
}

export type Differenze = {
  testo: string;
  file: string[];
  troncato: boolean;
  impronta: string;
  // Le modifiche intere, per file: servono ad accorciarle di nuovo dopo, quando
  // nella copia potrebbero non esserci più (consegnate nella cartella).
  pezzi: { file: string; testo: string }[];
  // I file lasciati fuori: credenziali, collegamenti, percorsi fuori dalla
  // copia (collaudo del 25 ottobre, CT-2.0-101). Solo i nomi.
  esclusi: string[];
};

const gitIn = (cartella: string, args: string[]) =>
  execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
    cwd: cartella,
    encoding: "utf8",
    timeout: 30000,
    maxBuffer: 16 * 1024 * 1024,
    env: ambienteGit(cartella),
  });

// Le modifiche nella copia di lavoro rispetto all'ultima consegna: la
// «fotografia» che il revisore guarda. I file nuovi entrano con il loro testo.
// Oltre «massimo» caratteri si accorcia ogni file in proporzione, così il
// revisore li vede tutti (prima si tagliava la coda e gli ultimi sparivano), e
// lo si dice al revisore e alla persona.
export function differenze(lavoro: string, massimo = 24_000): Differenze {
  const pezzi: { file: string; testo: string }[] = [];
  const esclusi: string[] = [];
  // Se Git non funziona nella copia (repository sparito) si dice: prima
  // risultava «niente da guardare» e il revisore taceva (26 ottobre).
  const tutto = gitIn(lavoro, ["diff", "--no-color", "-U2", "HEAD"]);
  for (const blocco of tutto.split(/^(?=diff --git )/m).filter((b) => b.trim())) {
    const m = /^diff --git a\/(.+?) b\/(.+)$/m.exec(blocco);
    const nome = m?.[1] ?? "?";
    const nomi = m ? [m[1], m[2]] : [nome];
    // Un collegamento tracciato si riconosce dal modo 120000.
    if (/^(new|old|deleted) file mode 120000|^(old|new) mode 120000/m.test(blocco) || nomi.some((n) => escluso(lavoro, n))) {
      esclusi.push(nome);
      continue;
    }
    pezzi.push({ file: nome, testo: blocco });
  }
  const nuovi = gitIn(lavoro, ["ls-files", "--others", "--exclude-standard"]).split("\n").filter(Boolean);
  for (const f of nuovi) {
    if (f.startsWith("allegati/")) continue;
    if (escluso(lavoro, f)) {
      esclusi.push(f);
      continue;
    }
    try {
      const contenuto = readFileSync(join(lavoro, f), "utf8");
      if (/\u0000/.test(contenuto)) continue;
      pezzi.push({ file: f, testo: `File nuovo: ${f}\n${contenuto}\n` });
    } catch {}
  }
  return { ...accorcia(pezzi, massimo), esclusi };
}

// Che cosa non va mai al revisore: file di credenziali (anche tracciati),
// collegamenti simbolici (file o cartella lungo il percorso), tutto ciò che
// esce dalla copia e la cartella degli allegati.
export function escluso(lavoro: string, relativo: string): boolean {
  if (!relativo || relativo === "?" || relativo.startsWith("allegati/")) return true;
  const percorso = join(lavoro, relativo);
  if (percorsoSensibile(percorso)) return true;
  // Ogni tratto del percorso: un collegamento a metà porta fuori anche se il
  // file in fondo è normale.
  let corrente = lavoro;
  for (const parte of relativo.split("/")) {
    corrente = join(corrente, parte);
    try {
      if (lstatSync(corrente).isSymbolicLink()) return true;
    } catch {
      break; // file cancellato: il diff dice solo che non c'è più
    }
  }
  try {
    const base = realpathSync(lavoro);
    const vero = realpathSync(percorso);
    if (vero !== base && !vero.startsWith(base + sep)) return true;
  } catch {}
  return false;
}

// Le stesse modifiche in al massimo «massimo» caratteri.
export function accorcia(pezzi: { file: string; testo: string }[], massimo: number): Differenze {
  const intero = pezzi.map((x) => x.testo).join("\n");
  const impronta = createHash("sha256").update(intero).digest("hex").slice(0, 16);
  const file = [...new Set(pezzi.map((x) => x.file))];
  if (intero.length <= massimo) return { testo: intero, file, troncato: false, impronta, pezzi, esclusi: [] };
  // Una parte uguale per file; quella che un file corto non usa va agli altri.
  const ordinati = [...pezzi].sort((a, b) => a.testo.length - b.testo.length);
  let resto = massimo;
  const parti = new Map<(typeof pezzi)[number], string>();
  ordinati.forEach((x, i) => {
    const quota = Math.floor(resto / (ordinati.length - i));
    const t = x.testo.length <= quota ? x.testo : x.testo.slice(0, Math.max(0, quota - 40)) + "\n… (file accorciato)\n";
    parti.set(x, t);
    resto -= t.length;
  });
  const testo = pezzi.map((x) => parti.get(x)!).join("\n").slice(0, massimo);
  return { testo, file, troncato: true, impronta, pezzi, esclusi: [] };
}

// Quanti caratteri di modifiche stanno in una richiesta del servizio: i suoi
// token massimi, meno la risposta e le istruzioni, a circa 2,8 caratteri per
// token (il codice ne usa meno del testo).
export function caratteriPer(p: { massimoToken?: number }, risposta = 1200): number {
  if (!p.massimoToken) return 24_000;
  return Math.max(2_000, Math.floor((p.massimoToken - risposta - 900) * 2.8));
}

export const NESSUN_SUGGERIMENTO = "NESSUN SUGGERIMENTO";

// I suggerimenti dalla risposta: una riga che comincia con «-» è un
// suggerimento; «NESSUN SUGGERIMENTO» vuol dire che va bene così.
export function leggiSuggerimenti(risposta: string): string[] {
  if (risposta.toUpperCase().includes(NESSUN_SUGGERIMENTO)) return [];
  return risposta
    .split("\n")
    .map((r) => r.trim())
    .filter((r) => /^[-*•]\s+/.test(r))
    .map((r) => r.replace(/^[-*•]\s+/, "").trim())
    .filter(Boolean)
    .slice(0, 8);
}

export function messaggiRevisione(opzioni: {
  richiesta: string;
  conversazione: string;
  diff: Differenze;
  istruzioni: string;
  // La lingua scelta (28 ottobre: inglese di serie).
  lingua?: Lingua;
}): Messaggio[] {
  return [
    {
      role: "system",
      content:
        "Sei il revisore di Continuity: un'altra AI ha modificato un progetto e tu controlli il suo lavoro. Non modifichi nulla: suggerisci. " +
        opzioni.istruzioni +
        `\n\n${istruzioneLingua(opzioni.lingua ?? LINGUA_PREDEFINITA)} Rispondi con al massimo 8 suggerimenti, uno per riga, ciascuno nella forma:\n- file:riga — problema → che cosa fare\n` +
        `Solo problemi reali e concreti. Se non c'è niente di importante rispondi esattamente: ${NESSUN_SUGGERIMENTO}`,
    },
    {
      role: "user",
      content:
        `Richiesta della persona:\n${opzioni.richiesta || "(non indicata)"}\n\n` +
        (opzioni.conversazione ? `Conversazione recente:\n${opzioni.conversazione}\n\n` : "") +
        `Modifiche (${opzioni.diff.file.length} file${opzioni.diff.troncato ? ", mostrate solo in parte perché sono molte" : ""}):\n` +
        opzioni.diff.testo,
    },
  ];
}

// La revisione: il modello scelto, e se è sovraccarico, lento o al limite il
// prossimo gratuito dello stesso servizio (al massimo 3), come nelle risposte.
export async function chiediRevisione(opzioni: {
  provider: ProviderNoto;
  chiave?: string;
  modelli: string[];
  // Il modello scelto dalla persona, provato per primo.
  primo?: string;
  messaggi: Messaggio[];
  // Per riprovare più corti: le domande con le modifiche ridotte a «quanti»
  // caratteri, se il servizio dice che la richiesta è troppo grande.
  piuCorti?: (quanti: number) => Messaggio[];
  caratteri?: number;
  segnale?: AbortSignal;
  scarica?: typeof fetch;
  // Un modello che il servizio dice di non avere per questo account.
  scarta?: (modello: string) => void;
}): Promise<{ suggerimenti: string[]; modello: string; risposta: string; ridotto: boolean }> {
  const ordinati = inOrdine(opzioni.provider, opzioni.modelli);
  // Tre modelli che falliscono davvero; quelli che il servizio non ha per
  // l'account (404, una risposta immediata) non contano, fino a 8 in tutto
  // (28 ottobre: NVIDIA ne elenca molti che l'account non può usare).
  const tutti = (opzioni.primo ? [opzioni.primo, ...ordinati.filter((m) => m !== opzioni.primo)] : ordinati).slice(0, 8);
  let falliti = 0;
  const candidati = tutti;
  let ultimo: unknown;
  let messaggi = opzioni.messaggi;
  let caratteri = opzioni.caratteri ?? 24_000;
  let riduzioni = 0;
  for (let i = 0; i < candidati.length; i++) {
    const modello = candidati[i];
    try {
      const risposta = await chiediModello(
        {
          provider: opzioni.provider,
          chiave: opzioni.chiave,
          modello,
          messaggi,
          massimo: 1200,
          segnale: opzioni.segnale,
          attesaPrimo: 45_000,
        },
        opzioni.scarica,
      );
      return { suggerimenti: leggiSuggerimenti(risposta), modello, risposta, ridotto: riduzioni > 0 };
    } catch (e) {
      ultimo = e;
      // Troppo grande: stesse modifiche, la metà dei caratteri, stesso
      // modello (al massimo due volte).
      if (e instanceof ErroreGratuito && e.tipo === "troppo" && opzioni.piuCorti && riduzioni < 2) {
        riduzioni++;
        caratteri = Math.floor(caratteri / 2);
        messaggi = opzioni.piuCorti(caratteri);
        i--;
        continue;
      }
      if (!siPassaAlProssimo(e)) throw e;
      if (e instanceof ErroreGratuito && e.tipo === "modello") opzioni.scarta?.(modello);
      else if (++falliti >= 3) break;
    }
  }
  throw ultimo instanceof Error ? ultimo : Error("Nessun modello del revisore risponde");
}
