// L'«AI ibrida» di Continuity (idea di Lorenzo, 15 ottobre 2026): un modello
// che gira sul Mac (oggi qwen3.5:4b con Ollama, utilizzabile anche con 8 GB
// di RAM) affianca le AI della sequenza con un ruolo scelto dalla persona:
// - riserva: quando tutte le AI sono senza crediti continua lei, sui file;
// - a comando: la persona decide di mandarle un messaggio (shift+tab);
// - compiti: lavori di testo con una parola chiave («#spiega …»), che la
//   persona accende, spegne, modifica e aggiunge dall'interfaccia.
// I compiti non toccano i file: Continuity chiama Ollama direttamente.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { spawn } from "node:child_process";
import { join } from "node:path";

export type Compito = {
  id: string;
  nome: string;
  // Come si chiama dal campo: «#spiega che cosa fa questo errore».
  parola: string;
  istruzioni: string;
  attivo: boolean;
  // I compiti di Continuity si possono spegnere e modificare, non eliminare.
  predefinito?: boolean;
};

export type ConfigIbrida = {
  attiva: boolean;
  modello: string;
  riserva: boolean;
  aComando: boolean;
  compiti: Compito[];
};

// L'indirizzo di Ollama; CONTINUITY_OLLAMA_URL serve alle prove con un finto
// Ollama su un'altra porta, senza toccare quello vero.
export function indirizzoOllama() {
  return process.env.CONTINUITY_OLLAMA_URL ?? "http://127.0.0.1:11434";
}

export const COMPITI_PREDEFINITI: Compito[] = [
  {
    id: "chiedi",
    nome: "Domande veloci",
    parola: "#chiedi",
    istruzioni:
      "Rispondi alla domanda della persona sul suo progetto, in modo breve e preciso. Se non lo sai, dillo: non inventare.",
    attivo: true,
    predefinito: true,
  },
  {
    id: "spiega",
    nome: "Spiega un errore o un comando",
    parola: "#spiega",
    istruzioni:
      "Spiega in modo semplice che cosa significa l'errore, il comando o il codice che la persona ti dà, e che cosa può fare. Al massimo 8 righe.",
    attivo: true,
    predefinito: true,
  },
  {
    id: "traduci",
    nome: "Traduci in italiano",
    parola: "#traduci",
    istruzioni:
      "Traduci in italiano il testo che la persona ti dà. Mantieni il significato e la formattazione Markdown; non aggiungere commenti.",
    attivo: true,
    predefinito: true,
  },
  {
    id: "riassumi",
    nome: "Riassumi la conversazione",
    parola: "#riassumi",
    istruzioni:
      "Riassumi, in al massimo 6 punti, la conversazione della sessione che trovi qui sotto: obiettivo, cosa è stato fatto, cosa manca. Se la persona aggiunge una richiesta, seguila.",
    attivo: true,
    predefinito: true,
  },
];

export function configPredefinita(): ConfigIbrida {
  return {
    attiva: true,
    modello: "qwen3.5:4b",
    riserva: true,
    aComando: true,
    compiti: COMPITI_PREDEFINITI.map((c) => ({ ...c })),
  };
}

const file = (root: string) => join(root, "ibrida.json");

export function leggiIbrida(root: string): ConfigIbrida {
  // Spenta per forza (i test, o chi non la vuole senza toccare la scelta
  // salvata): il motore non cerca il modello locale.
  if (process.env.CONTINUITY_IBRIDA === "spenta")
    return { ...configPredefinita(), attiva: false };
  const base = configPredefinita();
  try {
    const salvata = JSON.parse(readFileSync(file(root), "utf8"));
    const compiti: Compito[] = Array.isArray(salvata.compiti) ? salvata.compiti : [];
    // I compiti predefiniti nuovi entrano anche nelle configurazioni vecchie.
    for (const p of base.compiti)
      if (!compiti.some((c) => c.id === p.id)) compiti.push(p);
    // Le istruzioni di serie di prima dicevano «in italiano»: ora la lingua la
    // decide la preferenza (inglese di serie, 28 ottobre). Un testo cambiato
    // dalla persona resta.
    for (const c of compiti) {
      const serie = base.compiti.find((p) => p.id === c.id && p.id !== "traduci");
      if (serie && /^(Rispondi|Spiega|Riassumi) in italiano/.test(c.istruzioni)) c.istruzioni = serie.istruzioni;
    }
    return {
      attiva: typeof salvata.attiva === "boolean" ? salvata.attiva : base.attiva,
      modello: typeof salvata.modello === "string" && salvata.modello ? salvata.modello : base.modello,
      riserva: typeof salvata.riserva === "boolean" ? salvata.riserva : base.riserva,
      aComando: typeof salvata.aComando === "boolean" ? salvata.aComando : base.aComando,
      compiti: compiti.filter(validoCompito),
    };
  } catch {
    return base;
  }
}

export function validoCompito(c: any): c is Compito {
  return (
    c &&
    typeof c.id === "string" &&
    typeof c.nome === "string" &&
    typeof c.parola === "string" &&
    /^#[\p{L}\p{N}_-]{2,24}$/u.test(c.parola) &&
    typeof c.istruzioni === "string" &&
    c.istruzioni.length <= 4000 &&
    typeof c.attivo === "boolean"
  );
}

export function salvaIbrida(root: string, config: ConfigIbrida) {
  const parole = new Set<string>();
  for (const c of config.compiti) {
    if (!validoCompito(c)) throw Error(`Compito non valido: ${(c as any)?.nome ?? "?"}`);
    if (parole.has(c.parola.toLowerCase()))
      throw Error(`La parola ${c.parola} è già usata da un altro compito`);
    parole.add(c.parola.toLowerCase());
  }
  writeFileSync(file(root), JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
}

// Il nome con cui il modello locale compare nella conversazione: dalla sua
// famiglia («qwen3.5:4b» → «qwen», «llama3.2» → «llama»).
export function nomeLocale(modello: string) {
  return (modello.split(/[:/]/)[0].replace(/[\d.]+.*$/, "") || "locale").toLowerCase();
}

// «#spiega questo errore…» → il compito attivo con quella parola e il resto.
export function compitoDalTesto(config: ConfigIbrida, testo: string) {
  const m = /^(#[\p{L}\p{N}_-]+)\s*([\s\S]*)$/u.exec(testo.trim());
  if (!m || !config.attiva) return undefined;
  const compito = config.compiti.find(
    (c) => c.attivo && c.parola.toLowerCase() === m[1].toLowerCase(),
  );
  return compito ? { compito, testo: m[2].trim() } : undefined;
}

// Lo stato di Ollama sul Mac: acceso, versione, modelli scaricati.
export async function statoOllama(scarica: typeof fetch = fetch) {
  try {
    const v = await scarica(indirizzoOllama() + "/api/version", {
      signal: AbortSignal.timeout(1500),
    });
    if (!v.ok) return { acceso: false, modelli: [] as string[] };
    const versione = String(((await v.json()) as any)?.version ?? "");
    const t = await scarica(indirizzoOllama() + "/api/tags", {
      signal: AbortSignal.timeout(3000),
    });
    const modelli = t.ok
      ? (((await t.json()) as any)?.models ?? []).map((m: any) => String(m.name))
      : [];
    return { acceso: true, versione, modelli: modelli as string[] };
  } catch {
    return { acceso: false, modelli: [] as string[] };
  }
}

// I modelli scaricati si leggono anche a Ollama spento, dalla sua cartella:
// il pannello /ibrida li mostra senza doverlo avviare (prova di Lorenzo del
// 19 ottobre: con Ollama spento non si poteva nemmeno controllare il modello).
export function modelliSulDisco(
  cartella = process.env.OLLAMA_MODELS || join(homedir(), ".ollama", "models"),
): string[] {
  const libreria = join(cartella, "manifests", "registry.ollama.ai", "library");
  try {
    return readdirSync(libreria).flatMap((nome) => {
      try {
        return readdirSync(join(libreria, nome)).map((tag) => `${nome}:${tag}`);
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

// Ollama spento: lo si avvia, staccato, come farebbe la persona aprendo
// l'app. Si aspetta al massimo 15 secondi che risponda.
export function binarioOllama() {
  return [
    "/usr/local/bin/ollama",
    "/opt/homebrew/bin/ollama",
    "/Applications/Ollama.app/Contents/Resources/ollama",
  ].find((p) => existsSync(p));
}
export async function assicuraOllama(scarica: typeof fetch = fetch) {
  if ((await statoOllama(scarica)).acceso) return true;
  // Senza Ollama installato non c'è niente da avviare né da aspettare.
  const binario = binarioOllama();
  if (!binario) return false;
  try {
    const figlio = spawn(binario, ["serve"], { detached: true, stdio: "ignore" });
    figlio.on("error", () => {});
    figlio.unref();
  } catch {
    return false;
  }
  for (let i = 0; i < 30; i++) {
    await new Promise((ok) => setTimeout(ok, 500));
    if ((await statoOllama(scarica)).acceso) return true;
  }
  return false;
}

// Un compito: la risposta arriva a pezzi («ogniPezzo») e alla fine intera.
// «think: false»: i modelli che ragionano risponderebbero molto più tardi.
export async function eseguiCompito(
  opzioni: {
    modello: string;
    istruzioni: string;
    contesto?: string;
    testo: string;
    ogniPezzo?: (pezzo: string) => void;
    segnale?: AbortSignal;
  },
  scarica: typeof fetch = fetch,
): Promise<string> {
  const messaggi = [
    {
      role: "system",
      content:
        opzioni.istruzioni +
        (opzioni.contesto ? "\n\nContesto della sessione:\n" + opzioni.contesto : ""),
    },
    { role: "user", content: opzioni.testo || "Procedi." },
  ];
  const r = await scarica(indirizzoOllama() + "/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: opzioni.modello,
      messages: messaggi,
      stream: true,
      think: false,
      // Due minuti, non dieci: su un Mac da 8 GB il modello ne occupa quasi 4,
      // e restava in memoria a lungo dopo l'ultima domanda (26 ottobre).
      keep_alive: "2m",
    }),
    signal: opzioni.segnale,
  });
  if (!r.ok || !r.body)
    throw Error(
      r.status === 404
        ? `Il modello ${opzioni.modello} non è scaricato: «ollama pull ${opzioni.modello}»`
        : `Ollama ha risposto con errore (HTTP ${r.status})`,
    );
  let fuori = "";
  let resto = "";
  const lettore = r.body.getReader();
  const decodifica = new TextDecoder();
  for (;;) {
    const { value, done } = await lettore.read();
    if (done) break;
    resto += decodifica.decode(value, { stream: true });
    const righe = resto.split("\n");
    resto = righe.pop() ?? "";
    for (const riga of righe) {
      if (!riga.trim()) continue;
      let dato: any;
      try {
        dato = JSON.parse(riga);
      } catch {
        continue;
      }
      if (dato.error) throw Error(String(dato.error));
      const pezzo = String(dato.message?.content ?? "");
      if (pezzo) {
        fuori += pezzo;
        opzioni.ogniPezzo?.(pezzo);
      }
    }
  }
  return fuori.trim();
}

// Toglie il modello dalla memoria di Ollama (keep_alive 0), senza avviare
// Ollama se è spento e senza toccare altri modelli. Si usa quando la persona
// passa a un'altra AI: prima restava caricato e occupava quasi tutti gli 8 GB
// del Mac (prova di Lorenzo del 26 ottobre). Restituisce se l'ha tolto: un
// rifiuto di Ollama (per esempio 503) non vale come riuscito (CT-2.0-203).
export async function liberaModello(modello: string, scarica: typeof fetch = fetch): Promise<boolean> {
  try {
    const ps = await scarica(indirizzoOllama() + "/api/ps", { signal: AbortSignal.timeout(1500) });
    if (!ps.ok) return false;
    const caricati: string[] = (((await ps.json()) as any)?.models ?? []).map((m: any) => String(m.name ?? m.model));
    if (!caricati.includes(modello)) return false;
    const r = await scarica(indirizzoOllama() + "/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: modello, keep_alive: 0 }),
      signal: AbortSignal.timeout(5000),
    });
    return r.ok;
  } catch {
    return false;
  }
}
