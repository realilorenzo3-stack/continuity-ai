// Il registro dei provider: chi può stare nella sequenza delle AI, con quale
// programma lavora, come si collega e come si paga. È il solo posto da toccare
// per aggiungerne uno: sequenza, «/ordine», «collega», aiuto e motore lo
// leggono da qui.
//
// Le strade sono quelle verificate nella Fase 0.3 (docs/rea/cli-chiavi-api.md):
// Codex accetta solo servizi con la Responses API, Claude Code solo servizi
// compatibili con l'API Messages di Anthropic.

export type Accesso = "abbonamento" | "chiave" | "locale";

export type ProviderNoto = {
  // Il nome nella sequenza e nei comandi: «/ordine claude».
  id: string;
  // Come lo si mostra alla persona.
  nome: string;
  // Il programma che fa il lavoro: oggi le CLI ufficiali. «diretto»: un
  // servizio che Continuity chiama da sé (API chat/completions, Fase 1 del
  // 21 ottobre); non lavora sui file finché non c'è il ponte (Fase 4), quindi
  // non entra nella sequenza delle AI: serve per rispondere e rivedere.
  motore: "codex" | "claude" | "diretto";
  accesso: Accesso;
  // Altri nomi che la persona può scrivere.
  alias: string[];
  // La variabile con cui la chiave arriva al programma, solo per quel turno.
  // La chiave sta nel Portachiavi, mai nel progetto né nella configurazione.
  chiave?: string;
  // Claude Code verso un servizio compatibile: ANTHROPIC_BASE_URL.
  indirizzo?: string;
  // Codex: il provider da usare. «openai» è quello integrato; «--oss» porta
  // ai server locali; un provider personalizzato si definisce riga per riga.
  codex?:
    | { tipo: "openai" }
    | { tipo: "locale"; nome: "ollama" | "lmstudio" }
    | { tipo: "personalizzato"; indirizzo: string };
  // Claude Code: le fonti di credenziale accettabili in system/init. Una fonte
  // diversa vuol dire che il turno non va dove la persona crede: si ferma.
  fontiClaude?: string[];
  // Un modello è necessario quando il predefinito del programma non esiste
  // presso quel servizio (OpenRouter non ha «gpt-…» senza prefisso).
  modelloObbligatorio?: boolean;
  // Il modello quando la persona non ne sceglie uno: quello che Codex stesso
  // usa con «--oss» (verificato nel binario di Codex 0.162).
  modelloPredefinito?: string;
  // La prova del collegamento: un indirizzo che risponde senza spendere
  // (elenco dei modelli o stato della chiave); una richiesta al modello solo
  // con «unToken», di un token, dove non c'è altro modo.
  // «{account}» si sostituisce con la prima parte di una chiave doppia.
  prova?: {
    url: string;
    intestazioni?: (chiave: string) => Record<string, string>;
    // L'indirizzo risponde anche senza chiave (elenco pubblico dei modelli):
    // dice che il servizio c'è, non che la chiave è buona.
    pubblica?: boolean;
    // L'elenco è pubblico e il servizio non ha un indirizzo per la sola
    // chiave (NVIDIA): la si prova con una risposta di un token al primo
    // modello consigliato dell'elenco. Una chiave inventata risponde 401/403
    // (settimo collaudo, CT-2.0-610: l'elenco da solo diceva «riuscito»).
    unToken?: boolean;
  };
  // La chiamata diretta di Continuity (src/core/gratuiti.ts): l'indirizzo base
  // compatibile OpenAI (si aggiunge /chat/completions) e dove leggere i
  // modelli, se diverso da «base/models».
  diretto?: { indirizzo: string; modelli?: string };
  // Quali modelli sono gratuiti con l'account gratuito della persona:
  // - «tutti»: tutti quelli di chat, dentro i limiti del piano gratuito;
  // - «prezzo-zero»: quelli che il servizio o models.dev danno a prezzo zero;
  // - un'espressione: i modelli il cui nome corrisponde (Google).
  // I modelli si leggono dal servizio ogni volta, non si scrivono qui.
  gratis?: "tutti" | "prezzo-zero" | RegExp;
  // Il modello che Continuity sceglie da sé quando la persona sceglie il
  // servizio con /ai (25 ottobre: niente seconda domanda). Il primo che c'è.
  consigliati?: RegExp[];
  // Quanti token al massimo accetta una richiesta con il piano gratuito
  // (domanda più risposta). Groq: 8.000 al minuto (errore 413 del 25 ottobre,
  // 9.059 chiesti); GitHub Models: 8.000 in entrata. Senza: nessun limite noto.
  massimoToken?: number;
  // Che cosa il servizio fa dei dati con il piano gratuito, detto prima di
  // collegarlo (ricerca del 21 ottobre, docs/MODELLI_GRATUITI.md).
  dati?: string;
  // Una chiave fatta di due parti (Cloudflare: ID dell'account e token):
  // si chiede prima la parte visibile, la chiave è «parte:token».
  primaParte?: string;
  // Il nome del servizio nel catalogo models.dev, per prezzi e modelli.
  catalogo?: string;
  // Dove si crea la chiave.
  console?: string;
  // Che cosa la persona deve sapere prima di usarlo.
  nota?: string;
};

const bearer = (chiave: string) => ({ authorization: `Bearer ${chiave}` });
const NON_SUPPORTATO_DA_ANTHROPIC =
  "Sperimentale: usa Claude Code con modelli di un altro servizio. È una strada documentata da quel servizio, che Anthropic non supporta.";

export const PROVIDER: readonly ProviderNoto[] = [
  {
    id: "codex",
    nome: "Codex · abbonamento ChatGPT",
    motore: "codex",
    accesso: "abbonamento",
    alias: ["chatgpt"],
    codex: { tipo: "openai" },
  },
  {
    id: "claude",
    nome: "Claude Code · abbonamento Claude",
    motore: "claude",
    accesso: "abbonamento",
    alias: ["claude-code"],
    fontiClaude: ["none", "oauth"],
  },
  {
    id: "openai",
    nome: "Codex · chiave API OpenAI (a consumo)",
    motore: "codex",
    accesso: "chiave",
    alias: ["openai-api"],
    chiave: "CODEX_API_KEY",
    codex: { tipo: "openai" },
    prova: { url: "https://api.openai.com/v1/models", intestazioni: bearer },
    catalogo: "openai",
    console: "https://platform.openai.com/api-keys",
  },
  {
    id: "anthropic",
    nome: "Claude Code · chiave API Anthropic (a consumo)",
    motore: "claude",
    accesso: "chiave",
    alias: ["anthropic-api"],
    chiave: "ANTHROPIC_API_KEY",
    fontiClaude: ["ANTHROPIC_API_KEY"],
    prova: {
      url: "https://api.anthropic.com/v1/models",
      intestazioni: (chiave) => ({
        "x-api-key": chiave,
        "anthropic-version": "2023-06-01",
      }),
    },
    catalogo: "anthropic",
    console: "https://platform.claude.com/",
  },
  {
    id: "openrouter",
    nome: "Codex · OpenRouter (anche modelli :free)",
    motore: "codex",
    accesso: "chiave",
    alias: [],
    chiave: "OPENROUTER_API_KEY",
    codex: {
      tipo: "personalizzato",
      indirizzo: "https://openrouter.ai/api/v1",
    },
    modelloObbligatorio: true,
    prova: { url: "https://openrouter.ai/api/v1/key", intestazioni: bearer },
    diretto: { indirizzo: "https://openrouter.ai/api/v1" },
    gratis: "prezzo-zero",
    dati: "Ogni modello gratuito ha i termini del suo fornitore: alcuni usano i dati per l'addestramento.",
    catalogo: "openrouter",
    console: "https://openrouter.ai/settings/keys",
    nota: "I modelli che finiscono in «:free» sono gratuiti ma limitati (circa 20 richieste al minuto e 50 al giorno sotto i 10 crediti) e il servizio può usare i dati secondo i termini di ciascun modello.",
  },
  {
    id: "deepseek",
    nome: "Claude Code · DeepSeek (a consumo)",
    motore: "claude",
    accesso: "chiave",
    alias: [],
    chiave: "ANTHROPIC_API_KEY",
    indirizzo: "https://api.deepseek.com/anthropic",
    fontiClaude: ["ANTHROPIC_API_KEY"],
    prova: { url: "https://api.deepseek.com/models", intestazioni: bearer },
    catalogo: "deepseek",
    console: "https://platform.deepseek.com/api_keys",
    nota: NON_SUPPORTATO_DA_ANTHROPIC,
  },
  {
    id: "kimi",
    nome: "Claude Code · Kimi di Moonshot (a consumo)",
    motore: "claude",
    accesso: "chiave",
    alias: ["moonshot"],
    chiave: "ANTHROPIC_AUTH_TOKEN",
    indirizzo: "https://api.moonshot.ai/anthropic",
    fontiClaude: ["none"],
    prova: { url: "https://api.moonshot.ai/v1/models", intestazioni: bearer },
    catalogo: "moonshotai",
    console: "https://platform.moonshot.ai/console/api-keys",
    nota: NON_SUPPORTATO_DA_ANTHROPIC,
  },
  {
    id: "zai",
    nome: "Claude Code · GLM di Z.ai (consumo o GLM Coding Plan)",
    motore: "claude",
    accesso: "chiave",
    alias: ["glm"],
    chiave: "ANTHROPIC_AUTH_TOKEN",
    indirizzo: "https://api.z.ai/api/anthropic",
    fontiClaude: ["none"],
    prova: {
      url: "https://api.z.ai/api/paas/v4/models",
      intestazioni: bearer,
    },
    diretto: { indirizzo: "https://api.z.ai/api/paas/v4" },
    gratis: "prezzo-zero",
    catalogo: "zai",
    console: "https://z.ai/manage-apikey/apikey-list",
    nota: NON_SUPPORTATO_DA_ANTHROPIC,
  },
  // Servizi con un piano gratuito, chiamati direttamente da Continuity
  // (docs/MODELLI_GRATUITI.md). Ognuno con l'account gratuito della persona.
  {
    id: "google",
    // Provati il 25 ottobre con la chiave di Lorenzo: 3.6 e 3.5 Flash
    // rispondono in 2–4 s, 2.5 Flash in meno di 1; 3.8 e 3.7 erano
    // sovraccarichi (503 o nessuna risposta). Comunque si prova prima di
    // sceglierli (primoCheFunziona).
    consigliati: [/^gemini-3\.6-flash$/, /^gemini-3\.5-flash$/, /^gemini-2\.5-flash$/, /^gemini-3\.\d-flash$/],
    nome: "Google AI Studio · Gemini (gratuito)",
    motore: "diretto",
    accesso: "chiave",
    alias: ["gemini", "aistudio"],
    prova: {
      url: "https://generativelanguage.googleapis.com/v1beta/openai/models",
      intestazioni: bearer,
    },
    diretto: { indirizzo: "https://generativelanguage.googleapis.com/v1beta/openai" },
    // Dalla pagina dei prezzi del 21 ottobre: Flash, Flash-Lite, 2.5 Pro e
    // Gemma sono gratuiti; Pro recenti, immagini e video no.
    gratis: /^(?:models\/)?(?:gemini-[\d.]+-flash(?:-lite)?(?:-preview)?(?:-[\d-]+)?|gemini-2\.5-pro|gemma-[\w.-]+)$/,
    dati: "Con il piano gratuito Google usa i contenuti per migliorare i suoi prodotti e persone possono leggerli: «Human reviewers may read, annotate, and process your API input and output». Non mandare dati personali o riservati.",
    catalogo: "google",
    console: "https://aistudio.google.com/apikey",
  },
  {
    id: "groq",
    massimoToken: 7000,
    consigliati: [/gpt-oss-120b/, /qwen/],
    nome: "Groq (gratuito)",
    motore: "diretto",
    accesso: "chiave",
    alias: [],
    prova: { url: "https://api.groq.com/openai/v1/models", intestazioni: bearer },
    diretto: { indirizzo: "https://api.groq.com/openai/v1" },
    gratis: "tutti",
    catalogo: "groq",
    console: "https://console.groq.com/keys",
    nota: "Piano gratuito senza carta: circa 30 richieste al minuto e 1.000 al giorno per modello.",
  },
  {
    id: "mistral",
    consigliati: [/^mistral-large-latest$/, /^mistral-medium-latest$/, /^codestral-latest$/],
    nome: "Mistral (gratuito, Free mode)",
    motore: "diretto",
    accesso: "chiave",
    alias: ["codestral"],
    prova: { url: "https://api.mistral.ai/v1/models", intestazioni: bearer },
    diretto: { indirizzo: "https://api.mistral.ai/v1" },
    gratis: "tutti",
    dati: "Con il piano gratuito Mistral usa i dati per l'addestramento, con una licenza irrevocabile: «improve, enhance, or train our models».",
    catalogo: "mistral",
    console: "https://console.mistral.ai/api-keys",
  },
  {
    id: "nvidia",
    consigliati: [/nemotron.*super/i, /deepseek/i, /qwen/i],
    nome: "NVIDIA build (gratuito)",
    dati: "Solo per provare, non per lavoro vero: «internal testing and evaluation purposes, not in production». Non mandare dati personali o riservati.",
    motore: "diretto",
    accesso: "chiave",
    alias: ["nim"],
    prova: { url: "https://integrate.api.nvidia.com/v1/models", intestazioni: bearer, unToken: true },
    diretto: { indirizzo: "https://integrate.api.nvidia.com/v1" },
    gratis: "tutti",
    catalogo: "nvidia",
    console: "https://build.nvidia.com/settings/api-keys",
    nota: "Più di 100 modelli con limiti di prova non pubblicati (circa 40 richieste al minuto).",
  },
  {
    id: "cloudflare",
    consigliati: [/gpt-oss-120b/, /llama-3\.3-70b/],
    nome: "Cloudflare Workers AI (gratuito)",
    motore: "diretto",
    accesso: "chiave",
    alias: ["workers-ai"],
    primaParte: "ID dell'account Cloudflare",
    prova: {
      url: "https://api.cloudflare.com/client/v4/accounts/{account}/ai/models/search?task=Text%20Generation",
      intestazioni: (chiave) => bearer(chiave.split(":").slice(1).join(":")),
    },
    diretto: {
      indirizzo: "https://api.cloudflare.com/client/v4/accounts/{account}/ai/v1",
      modelli: "https://api.cloudflare.com/client/v4/accounts/{account}/ai/models/search?task=Text%20Generation",
    },
    gratis: "tutti",
    catalogo: "cloudflare-workers-ai",
    console: "https://dash.cloudflare.com/profile/api-tokens",
    nota: "Gratis 10.000 «neuroni» al giorno: da poche decine a un migliaio di risposte, secondo il modello. Serve un token con il permesso Workers AI.",
  },
  {
    id: "cohere",
    consigliati: [/^command-a/],
    nome: "Cohere (chiave di prova gratuita)",
    motore: "diretto",
    accesso: "chiave",
    alias: [],
    prova: { url: "https://api.cohere.com/v1/models?endpoint=chat", intestazioni: bearer },
    diretto: {
      indirizzo: "https://api.cohere.ai/compatibility/v1",
      modelli: "https://api.cohere.com/v1/models?endpoint=chat",
    },
    gratis: "tutti",
    dati: "Chiave di prova, solo per provare: «not permitted to be used for production or commercial purposes». 1.000 chiamate al mese.",
    catalogo: "cohere",
    console: "https://dashboard.cohere.com/api-keys",
  },
  {
    id: "ollama",
    nome: "Codex · Ollama sul tuo computer (gratuito)",
    motore: "codex",
    accesso: "locale",
    alias: ["qwen"],
    codex: { tipo: "locale", nome: "ollama" },
    modelloPredefinito: "gpt-oss:20b",
    prova: { url: "http://localhost:11434/api/version" },
    diretto: { indirizzo: "http://localhost:11434/v1" },
    gratis: "tutti",
    nota: "Serve Ollama 0.13.3 o più recente, già avviato, con il modello scaricato. Il lavoro resta sul computer.",
  },
  {
    id: "lmstudio",
    nome: "Codex · LM Studio sul tuo computer (gratuito)",
    motore: "codex",
    accesso: "locale",
    alias: ["lm-studio"],
    codex: { tipo: "locale", nome: "lmstudio" },
    modelloPredefinito: "openai/gpt-oss-20b",
    prova: { url: "http://localhost:1234/v1/models" },
    diretto: { indirizzo: "http://localhost:1234/v1" },
    gratis: "tutti",
    nota: "Serve LM Studio con il server locale acceso e un modello caricato. Il lavoro resta sul computer.",
  },
];

export function providerNoto(nome: string): ProviderNoto | undefined {
  const n = nome.trim().toLowerCase();
  return PROVIDER.find((p) => p.id === n || p.alias.includes(n));
}

// Il programma che lavora per un provider; per gli id storici (sessioni nate
// prima del registro) il nome coincide con il programma.
// Il programma che fa il lavoro sui file. I servizi gratuiti chiamati
// direttamente lavorano attraverso Codex e il ponte di Continuity (Fase 4,
// 28 ottobre: tutte le AI sullo stesso piano).
export function motoreDi(id: string): string {
  // Le CLI storiche del primo prototipo: «gemini» è anche un nome di Google
  // AI Studio, ma qui è la Gemini CLI.
  if (id === "gemini" || id === "antigravity") return id;
  const p = providerNoto(id);
  if (p?.motore === "diretto") return "codex";
  return p?.motore ?? id;
}

// Il limite dei piani (gratuito fino a 3 provider, «Go» illimitato) è
// un'idea non ancora decisa: qui c'è solo il posto. Senza piano, nessun limite.
export function limiteProvider(): number | undefined {
  return undefined;
}

// Una nuova sequenza da ciò che la persona scrive, nel modo più corto possibile.
// - «claude»: claude passa in testa, le altre restano dietro nell'ordine di prima;
// - «claude, codex»: queste in testa in quest'ordine, le altre dietro;
// - «2» o «2 1»: le posizioni dell'elenco mostrato da «/ordine»;
// - «solo claude»: la sequenza diventa esattamente quella scritta.
// Restituisce gli id del registro; un nome sconosciuto o ripetuto è un errore
// con un messaggio da mostrare così com'è.
export function nuovaSequenza(attuale: string[], richiesta: string): string[] {
  let testo = richiesta.trim();
  const solo = /^solo\b/i.test(testo);
  if (solo) testo = testo.replace(/^solo\b/i, "").trim();
  const parole = testo.split(/[\s,→>]+/).filter(Boolean);
  if (!parole.length) throw Error("Serve almeno un'AI");
  const scelti = parole.map((parola) => {
    if (/^\d+$/.test(parola)) {
      const voce = attuale[Number(parola) - 1];
      if (!voce)
        throw Error(
          `Posizione ${parola} inesistente: la sequenza ha ${attuale.length} voci`,
        );
      return voce;
    }
    const noto = providerNoto(parola);
    if (!noto) throw Error("AI non supportata: " + parola);
    return noto.id;
  });
  if (new Set(scelti).size !== scelti.length)
    throw Error("La sequenza contiene ripetizioni");
  const risultato = solo
    ? scelti
    : [...scelti, ...attuale.filter((p) => !scelti.includes(p))];
  const limite = limiteProvider();
  if (limite !== undefined && risultato.length > limite)
    throw Error(`Il tuo piano consente al massimo ${limite} provider`);
  return risultato;
}

export function elencoDisponibili() {
  return PROVIDER.map((p) => p.id).join(", ");
}

// Chi può stare nella sequenza delle AI: chi lavora sui file.
// Ogni AI lavora sui file (28 ottobre): i gratuiti attraverso il ponte.
// Resta per chi chiede «può modificare il progetto?».
export function lavoraSuiFile(_p: ProviderNoto) {
  return true;
}

// L'indirizzo con l'account al posto di «{account}» (chiave doppia).
export function conAccount(indirizzo: string, chiave?: string) {
  return indirizzo.includes("{account}")
    ? indirizzo.replace("{account}", encodeURIComponent((chiave ?? "").split(":")[0]))
    : indirizzo;
}

// La parte della chiave che va nell'intestazione (senza l'account).
export function chiaveVera(p: ProviderNoto, chiave: string) {
  return p.primaParte ? chiave.split(":").slice(1).join(":") : chiave;
}

// Alcuni modelli gratuiti OpenRouter li dà solo ai programmi della sua lista
// (openrouter.ai/apps, «agentic harnesses»), non a una chiamata qualunque:
// «thinkingmachines/inkling:free is only available on agentic harnesses»
// (prova di Lorenzo del 31 ottobre). Non è la chiave né la quota: è il
// modello che non c'è per Continuity, e va scelto un altro.
export const SOLO_PROGRAMMI_ELENCATI = /only available (?:on|to|in|for) (?:agentic harness|coding agent|select(?:ed)? app|approved app)/i;
