// L'elenco dei comandi della sessione, in un solo posto: il riquadro iniziale,
// /aiuto e le parole accettate senza barra si costruiscono da qui. Tenuti in
// tre elenchi scritti a mano, divergevano: il riquadro ne mostrava 5 su 12.
export type Comando = {
  nome: string;
  // Riga breve, per il riquadro iniziale.
  breve: string;
  // Descrizione per /aiuto, con un esempio d'uso quando serve.
  aiuto: string;
};

export const COMANDI: Comando[] = [
  {
    nome: "linguaggio",
    breve: "italiano o inglese",
    aiuto: "cambia la lingua dell'interfaccia · /linguaggio italiano oppure /language english",
  },
  {
    nome: "modello",
    breve: "scegli il modello dell'AI",
    aiuto: "scegli il modello dell'AI attiva · /modello opus",
  },
  {
    nome: "ragionamento",
    breve: "quanto a fondo ragiona",
    aiuto:
      "quanto a fondo ragiona l'AI: basso, medio, alto (predefinito), massimo · /ragionamento massimo",
  },
  {
    nome: "connettori",
    breve: "accendi e spegni i connettori",
    aiuto:
      "i connettori di Claude e Codex (Gmail, GitHub, Figma…): vedili, accendili e spegnili",
  },
  {
    nome: "allega",
    breve: "aggiungi un file alla richiesta",
    aiuto: "aggiungi un file alla richiesta · /allega ~/nota.pdf",
  },
  {
    nome: "ordine",
    breve: "cambia la sequenza delle AI",
    aiuto:
      "cambia la sequenza delle AI · /ordine claude la mette in testa · /ordine 2 sceglie dall'elenco · /ordine solo claude tiene solo lei · /ordine da solo mostra l'elenco",
  },
  {
    nome: "collega",
    breve: "collega un provider: chiave API o server locale",
    aiuto:
      "collega un provider · /collega mostra l'elenco · /collega openrouter va diretto; la chiave non compare a schermo e finisce nell'archivio protetto del sistema (Portachiavi sul Mac)",
  },
  {
    nome: "annulla",
    breve: "rimette i file come stavano",
    aiuto:
      "rimette i file come stavano prima dell'ultima consegna · /annulla forza anche se nel frattempo sono cambiati (le versioni vengono conservate)",
  },
  {
    nome: "applica",
    breve: "riprova la consegna dei file",
    aiuto:
      "riprova a portare i file nella tua cartella · /applica forza anche sopra file che hai cambiato tu (/annulla te li ridà)",
  },
  {
    nome: "pubblica",
    breve: "pubblica la cartella su GitHub",
    aiuto:
      "pubblica la tua cartella su GitHub (si ferma a chiedere solo per file eliminati o possibili segreti) · /pubblica utente/repository · /pubblica automatica sì|no: pubblica da solo dopo ogni modifica",
  },
  {
    nome: "file",
    breve: "file modificati finora",
    aiuto: "file modificati finora nella sessione",
  },
  {
    nome: "stato",
    breve: "AI attiva, turni e verifiche",
    aiuto: "AI attiva, turni, durata e verifiche",
  },
  {
    nome: "aiuto",
    breve: "tutti i comandi",
    aiuto: "questo elenco",
  },
  {
    nome: "esci",
    breve: "esci, la sessione resta",
    aiuto: "esce: riaprendo Continuity qui si riprende da dove eri",
  },
  {
    nome: "chiudi",
    breve: "chiudi la sessione",
    aiuto: "chiude la sessione per sempre: la prossima parte da zero",
  },
];

export const PAROLE_COMANDO = COMANDI.map((c) => c.nome);

// I comandi italiani restano compatibili; questi alias rendono utilizzabile la
// stessa sessione anche quando l'interfaccia è in inglese.
const ALIAS_INGLESE: Record<string, string> = {
  language: "linguaggio", lang: "linguaggio", model: "modello", reasoning: "ragionamento",
  connectors: "connettori", attach: "allega", order: "ordine", connect: "collega",
  reviewer: "revisore", workflow: "flusso", workflows: "flusso", hybrid: "ibrida",
  free: "gratuiti", files: "file", undo: "annulla", apply: "applica", publish: "pubblica",
  status: "stato", setup: "configura", permissions: "permessi", help: "aiuto", exit: "esci", quit: "esci", close: "chiudi", theme: "tema",
};

// Solo i comandi: «/model gpt», oppure un alias inglese scritto da solo
// («help»). Un messaggio normale resta com'è: prima la prima parola di ogni
// messaggio finiva in minuscolo («Sezione 1…» → «sezione 1…», 28 ottobre).
export function normalizzaComando(testo: string) {
  const pulito = testo.trim();
  const m = /^(\/)?([^\s]+)([\s\S]*)$/.exec(pulito);
  if (!m) return testo;
  const parola = m[2].toLowerCase();
  if (m[1]) return "/" + (ALIAS_INGLESE[parola] ?? parola) + m[3];
  if (!m[3].trim() && ALIAS_INGLESE[parola]) return ALIAS_INGLESE[parola];
  return testo;
}

export function testoAiuto(colonne = process.stdout.columns ?? 100) {
  const largo = Math.max(...COMANDI.map((c) => c.nome.length)) + 1;
  // Le descrizioni lunghe vanno a capo sotto di sé, non sotto il comando.
  const rientro = " ".repeat(largo + 4);
  const spazio = Math.max(30, Math.min(colonne, 110) - rientro.length);
  const aCapo = (testo: string) => {
    const righe: string[] = [];
    let riga = "";
    for (const parola of testo.split(" ")) {
      if (riga && (riga + " " + parola).length > spazio) {
        righe.push(riga);
        riga = parola;
      } else riga = riga ? riga + " " + parola : parola;
    }
    if (riga) righe.push(riga);
    return righe.join("\n" + rientro);
  };
  return [
    "Comandi della sessione (anche senza barra: «connettori» vale «/connettori»):",
    ...COMANDI.map((c) => `  /${c.nome.padEnd(largo)} ${aCapo(c.aiuto)}`),
    "",
    "Tasti:",
    `  ${"Ctrl+C".padEnd(largo + 1)} una volta avvisa, due volte di fila interrompe il turno`,
    `  ${"incolla".padEnd(largo + 1)} un testo incollato aspetta il tuo invio`,
    "Qualsiasi altro testo è una richiesta all'AI.",
  ].join("\n");
}

// Una parola sola che somiglia a un comando («connettore», «modelo»,
// «/aiutp») è quasi sempre un comando scritto male: mandarla all'AI costa un
// turno e dei crediti per una risposta inutile.
export function comandoSimile(testo: string): string | undefined {
  const parola = testo.trim().toLowerCase().replace(/^\//, "");
  if (!/^[a-zàèéìòù]{3,20}$/.test(parola)) return undefined;
  if (PAROLE_COMANDO.includes(parola)) return undefined;
  let migliore: { nome: string; distanza: number } | undefined;
  for (const nome of PAROLE_COMANDO) {
    const d = distanza(parola, nome);
    const soglia = nome.length <= 5 ? 1 : 2;
    if (d <= soglia && (!migliore || d < migliore.distanza))
      migliore = { nome, distanza: d };
  }
  return migliore?.nome;
}

function distanza(a: string, b: string) {
  const riga = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prima = riga[0];
    riga[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = riga[j];
      riga[j] = Math.min(
        riga[j] + 1,
        riga[j - 1] + 1,
        prima + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      prima = tmp;
    }
  }
  return riga[b.length];
}
