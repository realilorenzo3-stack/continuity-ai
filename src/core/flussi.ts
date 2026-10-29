// Ruoli e flussi (Fase 3, decisioni di Lorenzo del 26 ottobre 2026,
// CONTINUITY_2.0.md §5.17). Un flusso è una catena di passi: ogni passo è un
// ruolo (pianifica, scrive, rivede, scrive i test, verifica finale, o uno
// personalizzato) affidato a un'AI. Chi rivede può rimandare il lavoro a chi
// scrive, fino a un numero di giri; il piano aspetta il sì della persona.
// Ruoli e flussi valgono per tutti i progetti (flussi.json nella cartella
// dati); il flusso attivo è della sessione.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { lavoraSuiFile, providerNoto } from "./provider.js";
import { istruzioneLingua, LINGUA_PREDEFINITA, type Lingua } from "./lingua.js";

// Che cosa produce un ruolo, e quindi che cosa fa il flusso dopo di lui:
// - piano: un piano a punti, che aspetta il sì della persona;
// - suggerimenti: problemi da correggere, che tornano a chi scrive;
// - verdetto: «pronto» o «non pronto» con i motivi, alla fine;
// - lavoro: modifiche ai file;
// - testo: una risposta che passa al passo dopo.
export type Esito = "piano" | "suggerimenti" | "verdetto" | "lavoro" | "testo";

export type Ruolo = {
  id: string;
  nome: string;
  // «legge»: non tocca i file (anche con Codex e Claude, in sola lettura);
  // «scrive»: lavora sui file, solo con le AI che lo sanno fare.
  tipo: "legge" | "scrive";
  esito: Esito;
  istruzioni: string;
  // I ruoli di Continuity si modificano ma non si eliminano.
  predefinito?: boolean;
};

// Chi fa il passo: «sequenza» = la prima AI disponibile della sequenza, con il
// cambio quando finiscono i crediti; «gratuito» = il primo servizio gratuito
// collegato (Groq, Cloudflare, Google…); altrimenti l'id di un provider.
export type Passo = { ruolo: string; ai: string; modello?: string };

export type Flusso = {
  id: string;
  nome: string;
  // Una riga che dice che cosa fa, per chi lo sceglie (prova di Lorenzo del
  // 27 ottobre: «Diretto», «Con revisione», «Completo» non si capivano).
  descrizione?: string;
  passi: Passo[];
  // Quante volte chi rivede può rimandare il lavoro a chi scrive.
  giri: number;
  // «Approva sempre»: il piano compare ma il lavoro parte senza chiedere.
  approvaPiano?: boolean;
  predefinito?: boolean;
};

export type ConfigFlussi = {
  ruoli: Ruolo[];
  flussi: Flusso[];
  // Le AI chiamate con @: il riepilogo «chi fa cosa» si conferma prima di
  // partire (di serie), oppure si parte subito.
  confermaIncarichi?: boolean;
};

export const FLUSSO_PREDEFINITO = "diretto";
// Servizi tolti: Zen gratuito (i modelli gratuiti «richiedono OpenCode») e
// GitHub Models (chiuso il 30 luglio 2026). docs/LEGALE_COLLABORAZIONE_AI.md.
export const SERVIZI_TOLTI = ["zen", "github"];
export const GIRI_PREDEFINITI = 2;
export const GIRI_MASSIMI = 5;

export const RUOLI_PREDEFINITI: Ruolo[] = [
  {
    id: "pianifica",
    nome: "Pianifica",
    tipo: "legge",
    esito: "piano",
    istruzioni:
      "Leggi il progetto e la richiesta e prepara un piano: passi numerati, brevi e concreti, con i file da toccare e come verificare il risultato. Non modificare nulla. Se qualcosa non è chiaro, scrivi le domande in fondo.",
    predefinito: true,
  },
  {
    id: "scrive",
    nome: "Scrive",
    tipo: "scrive",
    esito: "lavoro",
    istruzioni: "Fai quello che chiede la persona, seguendo il piano se c'è.",
    predefinito: true,
  },
  {
    id: "test",
    nome: "Scrive i test",
    tipo: "scrive",
    esito: "lavoro",
    istruzioni:
      "Scrivi o completa i test per le modifiche appena fatte, senza cambiare il codice dell'applicazione. Eseguili e di' quali passano e quali no. Se un test fallisce per un errore del codice, non correggerlo: descrivilo.",
    predefinito: true,
  },
  {
    id: "rivede",
    nome: "Rivede",
    tipo: "legge",
    esito: "suggerimenti",
    istruzioni:
      "Rivedi le modifiche: errori, casi dimenticati, sicurezza, test mancanti. Per ogni problema una riga con file, problema e proposta. Se è tutto a posto, dillo.",
    predefinito: true,
  },
  {
    id: "verifica",
    nome: "Verifica finale",
    tipo: "legge",
    esito: "verdetto",
    istruzioni:
      "Controlla se il lavoro fa quello che la persona ha chiesto e se le verifiche passano. Rispondi «PRONTO» o «NON PRONTO» nella prima riga, poi i motivi in pochi punti.",
    predefinito: true,
  },
];

export const FLUSSI_PREDEFINITI: Flusso[] = [
  {
    id: "diretto",
    nome: "Lavora",
    descrizione: "Un'AI fa il lavoro, come sempre. Se finisce i crediti continua la successiva.",
    passi: [{ ruolo: "scrive", ai: "sequenza" }],
    giri: 0,
    predefinito: true,
  },
  {
    id: "revisione",
    nome: "Lavora e ricontrolla",
    descrizione: "Un'AI fa il lavoro, un'altra (gratuita) lo ricontrolla e fa correggere gli errori, fino a 2 volte.",
    passi: [
      { ruolo: "scrive", ai: "sequenza" },
      { ruolo: "rivede", ai: "gratuito" },
    ],
    giri: GIRI_PREDEFINITI,
    predefinito: true,
  },
  {
    id: "completo",
    nome: "Pianifica, lavora e ricontrolla",
    descrizione: "Prima un piano che approvi tu, poi il lavoro, i test, il controllo e una verifica finale prima di consegnare.",
    passi: [
      { ruolo: "pianifica", ai: "sequenza" },
      { ruolo: "scrive", ai: "sequenza" },
      { ruolo: "test", ai: "sequenza" },
      { ruolo: "rivede", ai: "gratuito" },
      { ruolo: "verifica", ai: "gratuito" },
    ],
    giri: GIRI_PREDEFINITI,
    predefinito: true,
  },
];

const file = (root: string) => join(root, "flussi.json");
const copia = <T>(x: T): T => JSON.parse(JSON.stringify(x));

export function flussiPredefiniti(): ConfigFlussi {
  return { ruoli: copia(RUOLI_PREDEFINITI), flussi: copia(FLUSSI_PREDEFINITI) };
}

export function leggiFlussi(root: string): ConfigFlussi {
  const base = flussiPredefiniti();
  let salvata: any;
  try {
    salvata = JSON.parse(readFileSync(file(root), "utf8"));
  } catch {
    return base;
  }
  // I predefiniti modificati dalla persona vincono; quelli nuovi entrano
  // anche nelle configurazioni vecchie.
  const ruoli: Ruolo[] = (Array.isArray(salvata?.ruoli) ? salvata.ruoli : []).filter(validoRuolo);
  for (const p of base.ruoli) if (!ruoli.some((r) => r.id === p.id)) ruoli.push(p);
  for (const r of ruoli) if (base.ruoli.some((p) => p.id === r.id)) r.predefinito = true;
  // «Pianifica» di serie diceva «un piano in italiano»: ora la lingua la decide
  // la preferenza (28 ottobre). Un testo cambiato dalla persona resta.
  for (const r of ruoli)
    if (r.id === "pianifica" && r.istruzioni.includes("prepara un piano in italiano:"))
      r.istruzioni = r.istruzioni.replace("prepara un piano in italiano:", "prepara un piano:");
  // I servizi tolti da Continuity (28 ottobre): i passi che li usavano
  // passano al gratuito automatico, invece di far sparire il flusso.
  for (const f of Array.isArray(salvata?.flussi) ? salvata.flussi : [])
    for (const p of Array.isArray(f?.passi) ? f.passi : []) if (SERVIZI_TOLTI.includes(p?.ai)) p.ai = "gratuito";
  const flussi: Flusso[] = (Array.isArray(salvata?.flussi) ? salvata.flussi : []).filter(
    (f: any) => problemaFlusso(f, ruoli) === undefined,
  );
  for (const p of base.flussi) if (!flussi.some((f) => f.id === p.id)) flussi.push(p);
  // I flussi pronti salvati con i nomi di prima prendono quelli nuovi e la
  // descrizione (27 ottobre); un nome cambiato dalla persona resta.
  const VECCHI: Record<string, string> = { diretto: "Diretto", revisione: "Con revisione", completo: "Completo" };
  for (const f of flussi) {
    const serie = base.flussi.find((p) => p.id === f.id);
    if (!serie) continue;
    f.predefinito = true;
    if (f.nome === VECCHI[f.id]) f.nome = serie.nome;
    if (f.descrizione === undefined && f.nome === serie.nome) f.descrizione = serie.descrizione;
  }
  for (const f of flussi) delete (f as any).parola;
  return { ruoli, flussi, ...(salvata?.confermaIncarichi === false ? { confermaIncarichi: false } : {}) };
}

export function salvaFlussi(root: string, config: ConfigFlussi) {
  const ids = new Set<string>();
  for (const r of config.ruoli) {
    if (!validoRuolo(r)) throw Error(`Ruolo non valido: ${(r as any)?.nome ?? "?"}`);
    if (ids.has(r.id)) throw Error(`Due ruoli con lo stesso nome: ${r.nome}`);
    ids.add(r.id);
  }
  for (const p of RUOLI_PREDEFINITI)
    if (!ids.has(p.id)) throw Error(`Il ruolo «${p.nome}» di Continuity non si può eliminare`);
  const idFlussi = new Set<string>();
  for (const f of config.flussi) {
    const problema = problemaFlusso(f, config.ruoli);
    if (problema) throw Error(`Flusso «${(f as any)?.nome ?? "?"}»: ${problema}`);
    if (idFlussi.has(f.id)) throw Error(`Due flussi con lo stesso nome: ${f.nome}`);
    idFlussi.add(f.id);
  }
  for (const p of FLUSSI_PREDEFINITI)
    if (!idFlussi.has(p.id)) throw Error(`Il flusso «${p.nome}» di Continuity non si può eliminare`);
  writeFileSync(file(root), JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
}

const ESITI: Esito[] = ["piano", "suggerimenti", "verdetto", "lavoro", "testo"];

export function validoRuolo(r: any): r is Ruolo {
  return (
    r &&
    typeof r.id === "string" &&
    /^[a-z0-9-]{2,32}$/.test(r.id) &&
    typeof r.nome === "string" &&
    r.nome.trim().length > 0 &&
    r.nome.length <= 40 &&
    (r.tipo === "legge" || r.tipo === "scrive") &&
    ESITI.includes(r.esito) &&
    // Chi scrive produce lavoro; chi legge non può dichiarare «lavoro».
    (r.tipo === "scrive") === (r.esito === "lavoro") &&
    typeof r.istruzioni === "string" &&
    r.istruzioni.trim().length > 0 &&
    r.istruzioni.length <= 4000
  );
}

// Perché un flusso non va bene, o undefined.
export function problemaFlusso(f: any, ruoli: Ruolo[]): string | undefined {
  if (!f || typeof f.id !== "string" || !/^[a-z0-9-]{2,32}$/.test(f.id)) return "nome interno non valido";
  if (typeof f.nome !== "string" || !f.nome.trim() || f.nome.length > 40) return "nome mancante o troppo lungo";
  if (f.descrizione !== undefined && (typeof f.descrizione !== "string" || f.descrizione.length > 300)) return "descrizione troppo lunga";
  if (!Number.isInteger(f.giri) || f.giri < 0 || f.giri > GIRI_MASSIMI) return `i giri vanno da 0 a ${GIRI_MASSIMI}`;
  if (!Array.isArray(f.passi) || !f.passi.length) return "serve almeno un passo";
  if (f.passi.length > 12) return "al massimo 12 passi";
  for (const [i, p] of f.passi.entries()) {
    const ruolo = ruoli.find((r) => r.id === p?.ruolo);
    if (!ruolo) return `passo ${i + 1}: ruolo sconosciuto`;
    const problema = problemaAI(ruolo, p.ai);
    if (problema) return `passo ${i + 1} (${ruolo.nome}): ${problema}`;
    if (p.modello !== undefined && typeof p.modello !== "string") return `passo ${i + 1}: modello non valido`;
  }
  // Senza chi scrive non c'è nulla da rivedere né a chi rimandarlo.
  const scrive = f.passi.some((p: Passo) => ruoli.find((r) => r.id === p.ruolo)?.tipo === "scrive");
  const rivede = f.passi.some((p: Passo) => ruoli.find((r) => r.id === p.ruolo)?.esito === "suggerimenti");
  if (rivede && !scrive) return "chi rivede ha bisogno di un passo che scrive prima di lui";
  return undefined;
}


// Se un'AI può fare un ruolo: chi scrive solo con le AI che lavorano sui file.
export function problemaAI(ruolo: Ruolo, ai: unknown): string | undefined {
  if (ai === "sequenza") return undefined;
  if (ai === "gratuito") return undefined;
  const p = typeof ai === "string" ? providerNoto(ai) : undefined;
  if (!p) return "AI sconosciuta";
  if (ruolo.tipo === "scrive" && !lavoraSuiFile(p)) return `${p.nome} non lavora sui file`;
  return undefined;
}

// Un nome scritto dalla persona → un id stabile («Sicurezza dei form» →
// «sicurezza-dei-form»), diverso da quelli già usati.
export function idDaNome(nome: string, usati: Iterable<string>): string {
  const base =
    nome
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 28) || "nuovo";
  const presi = new Set(usati);
  let id = base.length >= 2 ? base : `${base}-1`;
  for (let n = 2; presi.has(id); n++) id = `${base}-${n}`;
  return id;
}

// Chi fa il passo, in parole: «la sequenza», «un gratuito», «Claude».
export function nomeAI(ai: string): string {
  if (ai === "sequenza") return "la sequenza";
  if (ai === "gratuito") return "un gratuito";
  // «Codex · Qwen sul Mac (Ollama)» e simili: il motore non è il nome dell'AI
  // (28 ottobre: il passo di Qwen compariva come «Codex»).
  if (ai === "ollama") return "Qwen sul Mac";
  const parti = (providerNoto(ai)?.nome ?? ai).split(" · ");
  return ai !== "codex" && ai !== "claude" && /^(Codex|Claude Code)$/.test(parti[0]) && parti[1] ? parti[1].replace(/\s*\(.*\)\s*$/, "").trim() : parti[0];
}

// Un flusso in una riga: «Pianifica (la sequenza) → Scrive (la sequenza) → …».
export function descriviFlusso(f: Flusso, ruoli: Ruolo[]): string {
  return f.passi
    .map((p) => `${ruoli.find((r) => r.id === p.ruolo)?.nome ?? p.ruolo} (${nomeAI(p.ai)})`)
    .join(" → ");
}

// ---- L'esecuzione (passo 2) ----

// Un flusso in corso nella sessione: il flusso e i ruoli come erano alla
// partenza (cambiarli a metà non lo rompe), la richiesta, dove si è arrivati.
export type Esecuzione = {
  flusso: Flusso;
  ruoli: Ruolo[];
  richiesta: string;
  passo: number;
  giro: number;
  // Il primo evento del passo in corso: la risposta dell'AI si legge da lì.
  seqPasso?: number;
  // Il piano approvato dalla persona, o quello che aspetta il suo sì.
  piano?: string;
  attesa?: "piano";
  // Che cosa la persona vuole cambiare del piano.
  modificaPiano?: string;
  // I problemi trovati da chi rivede, da correggere in questo giro, e il passo
  // di chi rivede a cui tornare dopo la correzione.
  correzioni?: { da: string; testo: string[] };
  // I problemi già segnalati e corretti per questo pezzo di lavoro: chi
  // rivede non li ripete e non chiede il contrario (28 ottobre: Groq chiedeva
  // i titoli Markdown al secondo giro e di toglierli al terzo).
  segnalati?: string[];
  // Quante volte, in questo flusso, un passo è passato a un'altra AI perché
  // quella scelta non rispondeva.
  ripieghi?: number;
  ritorno?: number;
  // Ciò che hanno detto i passi che rispondono con un testo.
  uscite: { ruolo: string; da: string; testo: string }[];
  verdetto?: { pronto: boolean; da: string };
};

// Un flusso di un solo passo che scrive è un turno normale: niente esecuzione.
export function soloUnTurno(f: Flusso, ruoli: Ruolo[]): boolean {
  return f.passi.length === 1 && ruoli.find((r) => r.id === f.passi[0].ruolo)?.tipo === "scrive";
}

// L'ultimo passo che scrive prima di «indice»: a lui torna il lavoro da
// correggere.
export function chiScrivePrima(e: Esecuzione, indice: number): number {
  for (let i = indice - 1; i >= 0; i--)
    if (e.ruoli.find((r) => r.id === e.flusso.passi[i].ruolo)?.tipo === "scrive") return i;
  return -1;
}

export const NESSUN_PROBLEMA = "NESSUN SUGGERIMENTO";

// Come deve rispondere un ruolo, perché Continuity sappia leggerlo.
export function formatoEsito(esito: Esito): string {
  switch (esito) {
    case "piano":
      return "Rispondi con il piano: passi numerati (1., 2., …), brevi e concreti, con i file da toccare e come verificare. Niente codice completo.";
    case "suggerimenti":
      return `Rispondi con al massimo 8 problemi, uno per riga, ciascuno nella forma:\n- file:riga — problema → che cosa fare\nSolo problemi reali e concreti rispetto alla richiesta della persona: errori, parti mancanti, cose che non funzionano. Non segnalare gusti di stile o di formattazione. Se non c'è niente da correggere rispondi esattamente: ${NESSUN_PROBLEMA}`;
    case "verdetto":
      return "Nella prima riga scrivi soltanto PRONTO oppure NON PRONTO. Poi i motivi, uno per riga, ciascuno con «- ».";
    default:
      return "";
  }
}

// Il contesto comune: la richiesta, il piano, ciò che hanno detto i passi
// prima, i problemi da correggere.
function contestoEsecuzione(e: Esecuzione): string[] {
  return [
    `Richiesta della persona:\n${e.richiesta}`,
    ...(e.piano && !e.attesa ? [`Piano approvato dalla persona:\n${e.piano}`] : []),
    ...e.uscite.map((u) => `${u.ruolo} (${u.da}) ha scritto:\n${u.testo}`),
    ...(!e.correzioni && e.segnalati?.length
      ? [
          "Nei giri precedenti sono già stati segnalati e corretti questi problemi: non ripeterli e non chiedere il contrario.\n" +
            e.segnalati.map((t) => `- ${t}`).join("\n"),
        ]
      : []),
    ...(e.correzioni
      ? [
          `Correzione, giro ${e.giro} di ${e.flusso.giri}: ${e.correzioni.da} ha trovato questi problemi nel lavoro fatto. Correggili, poi di' in breve che cosa hai cambiato:\n` +
            e.correzioni.testo.map((t) => `- ${t}`).join("\n"),
        ]
      : []),
  ];
}

// Il messaggio per un passo fatto da un'AI che lavora sul progetto (Codex,
// Claude, Qwen): in un turno vero, che scrive o in sola lettura.
export function promptPasso(e: Esecuzione): string {
  const passo = e.flusso.passi[e.passo];
  const ruolo = e.ruoli.find((r) => r.id === passo.ruolo)!;
  const intestazione = `Flusso «${e.flusso.nome}» di Continuity, passo ${e.passo + 1} di ${e.flusso.passi.length}: il tuo ruolo è «${ruolo.nome}».`;
  const piano =
    ruolo.esito === "piano" && e.piano && e.modificaPiano
      ? [`Il tuo piano di prima:\n${e.piano}`, `La persona chiede di cambiarlo così:\n${e.modificaPiano}`]
      : [];
  return [
    intestazione,
    ruolo.istruzioni,
    ...(ruolo.tipo === "legge"
      ? ["In questo passo leggi soltanto: puoi leggere i file ed eseguire comandi che non cambiano nulla (per esempio i test), ma non modificare, creare o cancellare file."]
      : []),
    formatoEsito(ruolo.esito),
    ...contestoEsecuzione(e),
    ...piano,
  ]
    .filter(Boolean)
    .join("\n\n");
}

// I messaggi per un passo fatto da un modello che risponde soltanto (Groq,
// Google…): non legge i file, riceve le modifiche e le verifiche.
export function messaggiPasso(
  e: Esecuzione,
  opzioni: {
    modifiche: string;
    file: number;
    troncato: boolean;
    verifiche?: { label?: string; passed: boolean; dettaglio?: string }[];
    lingua?: Lingua;
  },
): { role: "system" | "user"; content: string }[] {
  const passo = e.flusso.passi[e.passo];
  const ruolo = e.ruoli.find((r) => r.id === passo.ruolo)!;
  const verifiche = opzioni.verifiche?.length
    ? [
        "Verifiche del progetto eseguite da Continuity:\n" +
          opzioni.verifiche
            .map((c) => `- ${c.label ?? "verifica"}: ${c.passed ? "passa" : "NON passa"}${c.dettaglio && !c.passed ? `\n  ${c.dettaglio.slice(-600)}` : ""}`)
            .join("\n"),
      ]
    : [];
  return [
    {
      role: "system",
      content: [
        `Sei «${ruolo.nome}» nel flusso «${e.flusso.nome}» di Continuity: altre AI lavorano sul progetto, tu non modifichi nulla. ${istruzioneLingua(opzioni.lingua ?? LINGUA_PREDEFINITA)}`,
        ruolo.istruzioni,
        formatoEsito(ruolo.esito),
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
    {
      role: "user",
      content: [
        ...contestoEsecuzione({ ...e, correzioni: undefined }),
        ...verifiche,
        `Modifiche al progetto (${opzioni.file} file${opzioni.troncato ? ", mostrate solo in parte perché sono molte" : ""}):\n${opzioni.modifiche || "(nessuna modifica)"}`,
      ].join("\n\n"),
    },
  ];
}

// «PRONTO» nella prima riga, e non «NON PRONTO».
// Con le risposte in inglese anche «READY» e «NOT READY».
export function leggiVerdetto(testo: string): boolean {
  const prima = testo.trim().split("\n")[0]?.toUpperCase() ?? "";
  if (/\bNON\s+PRONTO\b|\bNOT\s+READY\b/.test(prima)) return false;
  return /\bPRONTO\b|\bREADY\b/.test(prima);
}
