// Il traduttore del ponte (Fase 4, decisione di Lorenzo del 28 ottobre: tutte
// le AI sullo stesso piano). Codex parla solo la Responses API; i servizi
// gratuiti (Groq, Gemini, Mistral, NVIDIA, Cloudflare, Cohere) parlano Chat
// Completions. Qui la richiesta di Codex diventa una richiesta chat, e lo
// stream chat diventa di nuovo eventi Responses. Specifica e fonti:
// docs/ponte/RICERCA_FASE4.md (LiteLLM come riferimento, MIT).
import { randomUUID } from "node:crypto";
import { redact, senzaChiavi } from "../persistence/redact.js";

// Le particolarità di un servizio verso Chat Completions.
export type Variante = {
  // Cohere: niente parallel_tool_calls; tool_choice solo «auto».
  senzaParallele?: boolean;
  soloAuto?: boolean;
  // Mistral: «required» si scrive «any».
  requiredComeAny?: boolean;
  // Il servizio accetta stream_options.include_usage.
  usageInStream?: boolean;
  // Google (Gemini 3): ogni chiamata a uno strumento rimandata indietro porta
  // la firma del ragionamento.
  firmaGemini?: boolean;
};

// Le firme viste nelle risposte, per call_id: Codex rimanda le chiamate senza
// campi che non conosce, il ponte le rimette. In memoria, le ultime 2.000.
const FIRME = new Map<string, any>();
export function ricordaFirma(callId: string, firma: any) {
  FIRME.set(callId, firma);
  if (FIRME.size > 2000) FIRME.delete(FIRME.keys().next().value!);
}
function firmaDi(callId: string) {
  return FIRME.get(callId);
}

type Chat = { role: string; content?: any; tool_calls?: any[]; tool_call_id?: string };

const SEPARATORE = "__";
// I nomi degli strumenti per Chat Completions: [A-Za-z0-9_-], al massimo 64.
const nomeChat = (nome: string) => nome.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64);

function testoDi(contenuto: any): string {
  if (typeof contenuto === "string") return contenuto;
  if (!Array.isArray(contenuto)) return "";
  return contenuto
    .map((p: any) =>
      typeof p === "string"
        ? p
        : p?.type === "input_image" || p?.type === "image_url"
          ? "[immagine omessa]"
          : String(p?.text ?? p?.output ?? ""),
    )
    .filter(Boolean)
    .join("\n");
}

// Richiesta Responses → richiesta Chat Completions. «custom» sono i nomi
// degli strumenti freeform (apply_patch) diventati funzioni: le loro chiamate
// tornano a Codex come custom_tool_call. «spazi» ricorda i namespace.
export function richiestaChat(
  corpo: any,
  modello: string,
  variante: Variante = {},
): { chat: any; custom: Set<string>; spazi: Map<string, { namespace: string; name: string }> } {
  const custom = new Set<string>();
  const spazi = new Map<string, { namespace: string; name: string }>();
  const messaggi: Chat[] = [];
  const sistema: string[] = [];
  if (typeof corpo.instructions === "string" && corpo.instructions.trim()) sistema.push(corpo.instructions);
  const ingressi: any[] = Array.isArray(corpo.input)
    ? corpo.input
    : typeof corpo.input === "string"
      ? [{ type: "message", role: "user", content: corpo.input }]
      : [];
  // Le chiamate consecutive dell'assistente vanno in un solo messaggio.
  let assistente: Chat | undefined;
  const chiudiAssistente = () => {
    if (assistente) messaggi.push(assistente);
    assistente = undefined;
  };
  const nomeChiamata = (x: any) => nomeChat(x.namespace ? `${x.namespace}${SEPARATORE}${x.name}` : x.name);
  for (const x of ingressi) {
    const tipo = x?.type ?? (x?.role ? "message" : undefined);
    if (tipo === "message") {
      const ruolo = x.role;
      const testo = testoDi(x.content);
      if (ruolo === "developer" || ruolo === "system") {
        // Il system solo in testa: a metà conversazione diventa un messaggio.
        if (!messaggi.length && !assistente) sistema.push(testo);
        else {
          chiudiAssistente();
          messaggi.push({ role: "user", content: `[istruzioni] ${testo}` });
        }
      } else if (ruolo === "assistant") {
        chiudiAssistente();
        assistente = { role: "assistant", content: testo };
      } else {
        chiudiAssistente();
        messaggi.push({ role: "user", content: testo });
      }
    } else if (tipo === "function_call" || tipo === "custom_tool_call") {
      if (!assistente) assistente = { role: "assistant", content: null };
      assistente.tool_calls = [
        ...(assistente.tool_calls ?? []),
        {
          id: x.call_id,
          // Gemini 3 vuole indietro la firma del ragionamento di ogni chiamata
          // (28 ottobre: «Function call is missing a thought_signature»). Se il
          // ponte non l'ha vista (sessione di prima di un riavvio), il valore
          // che Google indica per saltare il controllo.
          ...(firmaDi(x.call_id) ? { extra_content: firmaDi(x.call_id) } : variante.firmaGemini ? { extra_content: { google: { thought_signature: "skip_thought_signature_validator" } } } : {}),
          type: "function",
          function: {
            name: nomeChiamata(x),
            arguments: tipo === "custom_tool_call" ? JSON.stringify({ input: String(x.input ?? "") }) : String(x.arguments ?? "{}"),
          },
        },
      ];
    } else if (tipo === "function_call_output" || tipo === "custom_tool_call_output") {
      chiudiAssistente();
      messaggi.push({ role: "tool", tool_call_id: x.call_id, content: testoDi(x.output) || String(x.output ?? "") });
    }
    // reasoning, web_search_call, compaction e altri: si scartano.
  }
  chiudiAssistente();
  if (sistema.length) messaggi.unshift({ role: "system", content: sistema.join("\n\n") });

  const strumenti: any[] = [];
  const aggiungi = (t: any, prefisso?: string, descrizioneSpazio?: string) => {
    if (t?.type === "function") {
      const nome = nomeChat(prefisso ? `${prefisso}${SEPARATORE}${t.name}` : t.name);
      if (prefisso) spazi.set(nome, { namespace: prefisso, name: t.name });
      strumenti.push({
        type: "function",
        function: {
          name: nome,
          description: [descrizioneSpazio, t.description].filter(Boolean).join(" — ").slice(0, 4000),
          parameters: t.parameters ?? { type: "object", properties: {} },
        },
      });
    } else if (t?.type === "custom") {
      const nome = nomeChat(t.name);
      custom.add(nome);
      const grammatica = t.format?.definition ? `\nFormato (grammatica Lark):\n${t.format.definition}` : "";
      strumenti.push({
        type: "function",
        function: {
          name: nome,
          description: `${t.description ?? ""}${grammatica}`.slice(0, 8000),
          parameters: {
            type: "object",
            properties: { input: { type: "string", description: "Il testo completo, per esempio la patch da «*** Begin Patch» a «*** End Patch»." } },
            required: ["input"],
          },
        },
      });
    } else if (t?.type === "namespace" && Array.isArray(t.tools)) {
      for (const dentro of t.tools) aggiungi(dentro, t.name, t.description);
    }
    // web_search, tool_search e altri strumenti del servizio OpenAI: tolti.
  };
  for (const t of corpo.tools ?? []) aggiungi(t);

  const chat: any = { model: modello, messages: messaggi, stream: true };
  if (variante.usageInStream !== false) chat.stream_options = { include_usage: true };
  if (strumenti.length) {
    chat.tools = strumenti;
    const scelta = corpo.tool_choice;
    if (variante.soloAuto) chat.tool_choice = "auto";
    else if (scelta === "required") chat.tool_choice = variante.requiredComeAny ? "any" : "required";
    else if (scelta && typeof scelta === "object" && scelta.name) chat.tool_choice = { type: "function", function: { name: nomeChat(scelta.name) } };
    else if (scelta === "auto" || scelta === "none") chat.tool_choice = scelta;
    if (!variante.senzaParallele && typeof corpo.parallel_tool_calls === "boolean") chat.parallel_tool_calls = corpo.parallel_tool_calls;
  }
  if (typeof corpo.max_output_tokens === "number") chat.max_tokens = corpo.max_output_tokens;
  if (corpo.text?.format?.type === "json_schema")
    chat.response_format = { type: "json_schema", json_schema: { name: corpo.text.format.name ?? "risposta", schema: corpo.text.format.schema } };
  return { chat, custom, spazi };
}

// Un evento SSE della Responses API.
export const evento = (dati: any) => `event: ${dati.type}\ndata: ${JSON.stringify(dati)}\n\n`;

// Lo stream chat → eventi Responses. Si chiama con ogni chunk già letto
// (oggetto JSON) e alla fine; restituisce le righe SSE da mandare a Codex.
export class Traduzione {
  private seq = 0;
  private indice = 0;
  private id = "resp_" + randomUUID().replace(/-/g, "");
  private aperto: "testo" | "ragionamento" | undefined;
  private idItem = "";
  private testo = "";
  private chiamate = new Map<number, { id: string; nome: string; argomenti: string; idItem: string; indice: number }>();
  private finito: string | undefined;
  private usage: any;
  // Un errore mandato dal servizio dentro lo stream (Groq lo fa, per esempio
  // con una chiamata a uno strumento scritta male: «tool_use_failed»).
  erroreNelFlusso: string | undefined;
  // Per il registro: solo il codice dell'errore, non il testo.
  codiceNelFlusso: string | undefined;
  // Le firme dei ragionamenti di Gemini 3 per chiamata (extra_content).
  private firme = new Map<number, any>();
  get concluso() {
    return Boolean(this.finito);
  }
  private iniziato = false;
  constructor(
    private modello: string,
    private custom: Set<string>,
    private spazi: Map<string, { namespace: string; name: string }>,
    // La chiave del servizio: un errore dentro la risposta non la ripete a Codex.
    private chiavi: string[] = [],
  ) {}
  private e(dati: any) {
    return evento({ ...dati, sequence_number: this.seq++ });
  }
  inizio(): string {
    if (this.iniziato) return "";
    this.iniziato = true;
    return this.e({ type: "response.created", response: { id: this.id, object: "response", status: "in_progress", model: this.modello, output: [] } });
  }
  private chiudi(): string {
    let fuori = "";
    if (this.aperto === "testo") {
      fuori += this.e({ type: "response.output_text.done", item_id: this.idItem, output_index: this.indice, content_index: 0, text: this.testo });
      fuori += this.e({ type: "response.content_part.done", item_id: this.idItem, output_index: this.indice, content_index: 0, part: { type: "output_text", text: this.testo, annotations: [] } });
      fuori += this.e({
        type: "response.output_item.done",
        output_index: this.indice,
        item: { type: "message", id: this.idItem, role: "assistant", status: "completed", content: [{ type: "output_text", text: this.testo, annotations: [] }] },
      });
      this.indice++;
    } else if (this.aperto === "ragionamento") {
      fuori += this.e({
        type: "response.output_item.done",
        output_index: this.indice,
        item: { type: "reasoning", id: this.idItem, summary: [], content: [{ type: "reasoning_text", text: this.testo }] },
      });
      this.indice++;
    }
    this.aperto = undefined;
    this.testo = "";
    return fuori;
  }
  chunk(c: any): string {
    let fuori = this.inizio();
    if (c?.usage) this.usage = c.usage;
    if (c?.x_groq?.usage) this.usage = c.x_groq.usage;
    if (c?.error) {
      this.erroreNelFlusso = senzaChiavi(spiegazione(JSON.stringify(c)), this.chiavi);
      this.codiceNelFlusso = motivoPerIlRegistro(JSON.stringify(c));
      return fuori;
    }
    const scelta = c?.choices?.[0];
    if (!scelta) return fuori;
    const d = scelta.delta ?? scelta.message ?? {};
    const ragionamento = d.reasoning_content ?? d.reasoning;
    if (typeof ragionamento === "string" && ragionamento) {
      if (this.aperto !== "ragionamento") {
        fuori += this.chiudi();
        this.aperto = "ragionamento";
        this.idItem = "rs_" + randomUUID().replace(/-/g, "");
        fuori += this.e({ type: "response.output_item.added", output_index: this.indice, item: { type: "reasoning", id: this.idItem, summary: [] } });
      }
      this.testo += ragionamento;
      fuori += this.e({ type: "response.reasoning_text.delta", item_id: this.idItem, output_index: this.indice, content_index: 0, delta: ragionamento });
    }
    if (typeof d.content === "string" && d.content) {
      if (this.aperto !== "testo") {
        fuori += this.chiudi();
        this.aperto = "testo";
        this.idItem = "msg_" + randomUUID().replace(/-/g, "");
        fuori += this.e({ type: "response.output_item.added", output_index: this.indice, item: { type: "message", id: this.idItem, role: "assistant", status: "in_progress", content: [] } });
        fuori += this.e({ type: "response.content_part.added", item_id: this.idItem, output_index: this.indice, content_index: 0, part: { type: "output_text", text: "", annotations: [] } });
      }
      this.testo += d.content;
      fuori += this.e({ type: "response.output_text.delta", item_id: this.idItem, output_index: this.indice, content_index: 0, delta: d.content });
    }
    for (const t of d.tool_calls ?? []) {
      const k = typeof t.index === "number" ? t.index : this.chiamate.size;
      let ch = this.chiamate.get(k);
      if (!ch) {
        fuori += this.chiudi();
        ch = { id: t.id || "call_" + randomUUID().replace(/-/g, ""), nome: "", argomenti: "", idItem: "fc_" + randomUUID().replace(/-/g, ""), indice: this.indice++ };
        this.chiamate.set(k, ch);
      }
      if (t.id && !ch.id.startsWith("call_")) ch.id = t.id;
      if (t.function?.name) ch.nome += t.function.name;
      if (t.function?.arguments) ch.argomenti += t.function.arguments;
      if (t.extra_content) this.firme.set(k, t.extra_content);
    }
    if (scelta.finish_reason) this.finito = scelta.finish_reason;
    return fuori;
  }
  // La fine dello stream: chiamate chiuse, poi completed o incomplete.
  fine(): string {
    let fuori = this.inizio() + this.chiudi();
    for (const [k, ch] of [...this.chiamate.entries()].sort((a, b) => a[1].indice - b[1].indice)) {
      const nome = ch.nome;
      const firma = this.firme.get(k);
      if (firma) ricordaFirma(ch.id, firma);
      let item: any;
      if (this.custom.has(nome)) {
        let input = ch.argomenti;
        try {
          input = String(JSON.parse(ch.argomenti).input ?? ch.argomenti);
        } catch {
          // Argomenti non JSON: se c'è una patch si usa il testo così com'è.
        }
        item = { type: "custom_tool_call", id: "ctc_" + ch.idItem.slice(3), call_id: ch.id, name: nome, input, status: "completed" };
      } else {
        const spazio = this.spazi.get(nome);
        item = {
          type: "function_call",
          id: ch.idItem,
          call_id: ch.id,
          name: spazio ? spazio.name : nome,
          ...(spazio ? { namespace: spazio.namespace } : {}),
          arguments: ch.argomenti || "{}",
          status: "completed",
        };
      }
      fuori += this.e({ type: "response.output_item.done", output_index: ch.indice, item });
    }
    const u = this.usage;
    const usage = {
      input_tokens: u?.prompt_tokens ?? 0,
      input_tokens_details: { cached_tokens: u?.prompt_tokens_details?.cached_tokens ?? 0 },
      output_tokens: u?.completion_tokens ?? 0,
      output_tokens_details: { reasoning_tokens: u?.completion_tokens_details?.reasoning_tokens ?? 0 },
      total_tokens: u?.total_tokens ?? (u?.prompt_tokens ?? 0) + (u?.completion_tokens ?? 0),
    };
    if (!this.finito)
      return fuori + this.e({ type: "response.failed", response: { id: this.id, status: "failed", error: { code: "server_error", message: this.erroreNelFlusso ?? "Il servizio ha chiuso la risposta a metà" } } });
    if (this.finito === "length" || this.finito === "content_filter")
      return (
        fuori +
        this.e({
          type: "response.incomplete",
          response: { id: this.id, status: "incomplete", incomplete_details: { reason: this.finito === "length" ? "max_output_tokens" : "content_filter" }, usage },
        })
      );
    return fuori + this.e({ type: "response.completed", response: { id: this.id, object: "response", status: "completed", model: this.modello, usage } });
  }
}

// Un errore del servizio → che cosa mandare a Codex, perché riprovi quando ha
// senso e perché Continuity riconosca la quota finita (tabella in
// docs/ponte/RICERCA_FASE4.md, «Errori»).
// Quanti secondi aspettare per un limite al minuto (429 non giornaliero), o
// undefined se non è un limite al minuto.
export function attesaAlMinuto(stato: number, testo: string, intestazioni: { get(n: string): string | null }): number | undefined {
  if (stato !== 429) return undefined;
  const attesa = Number(intestazioni.get("retry-after") ?? "");
  const daMinuti = /per (minute|min)|RPM|TPM|tokens per minute|requests per minute/i.test(testo);
  const daGiorni = /per day|daily|RPD|TPD|per month|monthly|neurons|quota/i.test(testo);
  if (daGiorni || !(daMinuti || (Number.isFinite(attesa) && attesa > 0 && attesa <= 60))) return undefined;
  const scritto = Number(/try again in ([\d.]+)s/i.exec(testo)?.[1] ?? "");
  const secondi = Number.isFinite(attesa) && attesa > 0 ? attesa : Number.isFinite(scritto) && scritto > 0 ? scritto : 10;
  return Math.min(60, Math.ceil(secondi));
}

export function erroreVersoCodex(
  servizio: string,
  stato: number,
  testo: string,
  intestazioni: { get(n: string): string | null },
  modello?: string,
): { stato: number; corpo: string; tipo: "sse" | "json" } {
  // Il motivo in chiaro, non il JSON del servizio (28 ottobre).
  const breve = spiegazione(testo);
  const attesa = Number(intestazioni.get("retry-after") ?? "");
  const daMinuti = /per (minute|min)|RPM|TPM|tokens per minute|requests per minute/i.test(testo);
  const daGiorni = /per day|daily|RPD|TPD|per month|monthly|neurons|quota/i.test(testo);
  if (stato === 429) {
    // Al minuto: Codex aspetta e riprova. Al giorno o al mese: quota finita.
    if (!daGiorni && (daMinuti || (Number.isFinite(attesa) && attesa > 0 && attesa <= 60))) {
      const secondi = Number.isFinite(attesa) && attesa > 0 ? attesa : 10;
      return {
        stato: 200,
        tipo: "sse",
        corpo:
          evento({ type: "response.created", sequence_number: 0, response: { id: "resp_x", status: "in_progress" } }) +
          evento({
            type: "response.failed",
            sequence_number: 1,
            response: { id: "resp_x", status: "failed", error: { code: "rate_limit_exceeded", message: `${servizio}: limite al minuto. Please try again in ${secondi}s.` } },
          }),
      };
    }
    return {
      stato: 429,
      tipo: "json",
      corpo: JSON.stringify({ error: { type: "usage_limit_reached", message: `${servizio}: limite del piano gratuito raggiunto. You've hit your usage limit. ${breve}` } }),
    };
  }
  if (stato === 413 || /too large|reduce your message|context length|context_length|maximum context/i.test(testo)) {
    if (/TPM|tokens per minute/i.test(testo))
    {
      const numeri = /Limit (\d+), Requested (\d+)/i.exec(testo);
      const quanto = numeri ? ` (accetta ${numeri[1]} token al minuto, questa richiesta ne chiede ${numeri[2]})` : "";
      return {
        stato: 400,
        tipo: "json",
        corpo: JSON.stringify({ error: { type: "invalid_request_error", code: "request_too_large", message: `${servizio}: anche accorciata, la richiesta supera il limite al minuto del piano gratuito${quanto}. Riprova fra un minuto con un messaggio più breve, oppure affida questo pezzo a un'altra AI.` } }),
      };
    }
    return {
      stato: 200,
      tipo: "sse",
      corpo:
        evento({ type: "response.created", sequence_number: 0, response: { id: "resp_x", status: "in_progress" } }) +
        evento({ type: "response.failed", sequence_number: 1, response: { id: "resp_x", status: "failed", error: { code: "context_length_exceeded", message: `${servizio}: ${breve}` } } }),
    };
  }
  // Il testo del servizio non serve e può ripetere la chiave (CT-2.0-602).
  if (stato === 401 || stato === 403)
    return { stato: 401, tipo: "json", corpo: JSON.stringify({ error: { type: "invalid_api_key", message: `${servizio}: chiave rifiutata (HTTP ${stato}). Ricollegala con /collega.` } }) };
  if (stato >= 500) return { stato: 503, tipo: "json", corpo: JSON.stringify({ error: { type: "server_error", message: `${servizio}: ${breve}` } }) };
  if (stato === 404)
    return { stato: 400, tipo: "json", corpo: JSON.stringify({ error: { type: "invalid_request_error", message: `${servizio}: il modello${modello ? ` ${modello}` : ""} non è disponibile per il tuo account. Scegline un altro con /modello.` } }) };
  return { stato: 400, tipo: "json", corpo: JSON.stringify({ error: { type: "invalid_request_error", message: `${servizio}: ${breve}` } }) };
}

// Il messaggio dentro la risposta d'errore di un servizio: OpenAI e simili
// usano error.message, NVIDIA detail/title; altrimenti il testo, accorciato.
export function spiegazione(testo: string): string {
  let dentro: any;
  try {
    dentro = JSON.parse(testo);
  } catch {}
  const e = Array.isArray(dentro) ? dentro[0] : dentro;
  const frase = [e?.error?.message, e?.error, e?.detail, e?.message, e?.title].find((x) => typeof x === "string" && x.trim());
  return redact(String(frase ?? testo).replace(/\s+/g, " ").trim()).slice(0, 300);
}

// Ciò che resta nel registro del ponte di un errore del servizio: il codice e
// i numeri dei limiti, non il testo. Il testo può ripetere la chiave o la
// richiesta della persona, e il registro è «senza testi» (CT-2.0-602).
export function motivoPerIlRegistro(testo: string): string | undefined {
  let dentro: any;
  try {
    dentro = JSON.parse(testo);
  } catch {}
  const e = Array.isArray(dentro) ? dentro[0] : dentro;
  const err = typeof e?.error === "object" && e.error ? e.error : e;
  // Solo codici fatti come codici (minuscole e trattini bassi, «rate_limit_exceeded»)
  // o numeri: un campo «code» che contiene la chiave o un testo non passa
  // (ottavo collaudo, CT-2.0-602).
  const parti = [err?.code, err?.type, err?.status, e?.title]
    .filter((x) => (typeof x === "string" && /^[a-z][a-z_]{1,39}$/.test(x)) || (typeof x === "number" && Number.isInteger(x)))
    .map(String);
  const numeri = /Limit (\d+), Used (\d+), Requested (\d+)/i.exec(testo) ?? /Limit (\d+), Requested (\d+)/i.exec(testo);
  if (numeri) parti.push(`limite ${numeri[1]}, chiesti ${numeri[numeri.length - 1]}`);
  const attesa = /try again in ([\d.]+m?s|[\d.]+m[\d.]+s)/i.exec(testo);
  if (attesa) parti.push(`riprovare fra ${attesa[1]}`);
  if (/per day|daily|RPD|TPD/i.test(testo)) parti.push("al giorno");
  else if (/per minute|RPM|TPM/i.test(testo)) parti.push("al minuto");
  return parti.length ? [...new Set(parti)].join(" · ") : undefined;
}
