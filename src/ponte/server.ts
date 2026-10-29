// Il ponte (Fase 4): un server su 127.0.0.1, dentro il servizio di
// Continuity, che fa lavorare Codex con i servizi gratuiti. Codex gli manda
// richieste Responses (`POST /<servizio>/v1/responses`) con un gettone del
// ponte; il ponte le traduce in Chat Completions con la chiave vera della
// persona, che Codex non vede mai, e toglie i dati di Codex
// (installation_id, intestazioni x-codex-*). docs/ponte/RICERCA_FASE4.md.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { chiaveVera, conAccount, providerNoto } from "../core/provider.js";
import { attesaAlMinuto, erroreVersoCodex, motivoPerIlRegistro, richiestaChat, Traduzione, type Variante } from "./traduttore.js";
import { senzaChiavi } from "../persistence/redact.js";
import { stimaToken, stringiPerIlLimite } from "./limite.js";

export const VARIABILE_GETTONE = "CONTINUITY_PONTE_TOKEN";

// Le particolarità note dei servizi verso Chat Completions.
const VARIANTI: Record<string, Variante> = {
  cohere: { senzaParallele: true, soloAuto: true, usageInStream: false },
  mistral: { requiredComeAny: true },
  cloudflare: { usageInStream: false },
  google: { firmaGemini: true },
};

export type EsitoPonte = {
  servizio: string;
  stato: number;
  dettaglio?: string;
  modello?: string;
  // Token stimati della richiesta e risposta massima chiesta.
  stima?: number;
  massimo?: number;
  // Ciò che il servizio dice dei suoi limiti (intestazioni x-ratelimit-*).
  limiti?: Record<string, string>;
};

export class Ponte {
  private server?: Server;
  porta = 0;
  readonly gettone = randomBytes(24).toString("hex");
  // Il modello che ha preso il posto di uno non disponibile (servizio:modello).
  private sostituti = new Map<string, string>();
  constructor(
    private opzioni: {
      // La chiave del servizio, dal Portachiavi (letta solo quando serve).
      chiave: (servizio: string) => string | undefined;
      scarica?: typeof fetch;
      // Ogni risposta del servizio, per il registro di Continuity.
      registra?: (e: EsitoPonte) => void;
      // I modelli gratuiti del servizio, nell'ordine consigliato: se quello
      // scelto non esiste per l'account della persona, si prova il seguente.
      candidati?: (servizio: string) => string[];
      // Un modello che il servizio dice di non avere per questo account.
      scarta?: (servizio: string, modello: string) => void;
      // Il ponte aspetta il limite al minuto del servizio: per dirlo alla persona.
      attesa?: (servizio: string, secondi: number) => void;
      // Quanto aspettare davvero (le prove lo accorciano).
      dormi?: (ms: number, segnale: AbortSignal) => Promise<void>;
    },
  ) {}

  async avvia(): Promise<number> {
    if (this.server) return this.porta;
    const server = createServer((req, res) => void this.gestisci(req, res));
    await new Promise<void>((ok, no) => {
      server.once("error", no);
      server.listen(0, "127.0.0.1", () => ok());
    });
    this.server = server;
    this.porta = (server.address() as any).port;
    return this.porta;
  }
  indirizzo(servizio: string) {
    return `http://127.0.0.1:${this.porta}/${servizio}/v1`;
  }
  async ferma() {
    const s = this.server;
    this.server = undefined;
    if (s) await new Promise((ok) => s.close(() => ok(undefined)));
  }

  private async gestisci(req: IncomingMessage, res: ServerResponse) {
    const rispondi = (stato: number, corpo: string, tipo = "application/json") => {
      if (!res.headersSent) res.writeHead(stato, { "content-type": tipo });
      res.end(corpo);
    };
    // Solo dal Mac stesso e con il gettone: nessun altro programma lo usa.
    const da = req.socket.remoteAddress ?? "";
    if (!/^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/.test(da)) return rispondi(403, '{"error":{"message":"solo locale"}}');
    if (req.headers.authorization !== `Bearer ${this.gettone}`)
      return rispondi(401, '{"error":{"type":"invalid_api_key","message":"gettone del ponte non valido"}}');
    const m = /^\/([a-z0-9-]+)\/v1\/responses\/?$/.exec(req.url ?? "");
    if (req.method !== "POST" || !m) return rispondi(404, '{"error":{"message":"non trovato"}}');
    const servizio = m[1];
    const p = providerNoto(servizio);
    if (!p?.diretto) return rispondi(404, `{"error":{"message":"servizio sconosciuto: ${servizio}"}}`);
    const chiave = this.opzioni.chiave(p.id);
    if (!chiave) return rispondi(401, JSON.stringify({ error: { type: "invalid_api_key", message: `${p.nome}: nessuna chiave collegata (/collega ${p.id})` } }));
    // Ciò che esce dal ponte verso Codex o verso il registro non contiene la
    // chiave, nemmeno se il servizio la ripete in un errore (CT-2.0-602).
    const chiavi = [chiave, chiaveVera(p, chiave), ...chiave.split(":")];
    const pulito = (t: string) => senzaChiavi(t, chiavi);
    let corpo: any;
    try {
      corpo = JSON.parse(await leggi(req));
    } catch {
      return rispondi(400, '{"error":{"message":"richiesta non valida"}}');
    }
    const modello = String(corpo.model ?? "");
    const { chat, custom, spazi } = richiestaChat(corpo, modello, VARIANTI[p.id]);
    // Un servizio con un limite piccolo (Groq gratuito): la richiesta si
    // stringe per starci, invece di essere rifiutata (src/ponte/limite.ts).
    if (p.massimoToken) {
      const stretta = stringiPerIlLimite(chat, p.massimoToken);
      if (stretta.dopo < stretta.prima)
        this.opzioni.registra?.({ servizio: p.id, stato: 0, dettaglio: `richiesta stretta da ~${stretta.prima} a ~${stretta.dopo} token` });
      if (!stretta.entra) {
        this.opzioni.registra?.({ servizio: p.id, stato: 0, dettaglio: `richiesta non mandata: ~${stretta.dopo} token anche stretta, il limite è ${p.massimoToken}` });
        return rispondi(400, JSON.stringify({ error: { type: "invalid_request_error", code: "request_too_large", message: `${nomeBreve(p.nome)}: il messaggio è troppo lungo per il piano gratuito (circa ${stretta.dopo.toLocaleString("it-IT")} token; ne accetta circa ${p.massimoToken.toLocaleString("it-IT")} al minuto, risposta compresa). Accorcialo o dividi l'allegato, oppure affida questo lavoro a un'altra AI.` } }));
      }
    }
    const controllo = new AbortController();
    res.on("close", () => controllo.abort());
    // Un modello che il servizio non ha per questo account (NVIDIA risponde
    // 404 «Function … Not found for account», 28 ottobre): si passa al
    // seguente dell'elenco, al massimo 4 volte, e lo si ricorda.
    const provati = new Set<string>();
    let usato = this.sostituti.get(`${p.id}:${modello}`) ?? modello;
    let r: Response;
    // Il limite al minuto (Groq gratuito: 8.000 token): il ponte aspetta e
    // riprova da sé, fino a 4 volte, invece di far fallire Codex dopo i suoi
    // tre tentativi (28 ottobre).
    let attese = 0;
    const stima = stimaToken(chat);
    for (;;) {
      provati.add(usato);
      try {
        r = await (this.opzioni.scarica ?? fetch)(conAccount(p.diretto.indirizzo, chiave) + "/chat/completions", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${chiaveVera(p, chiave)}` },
          body: JSON.stringify({ ...chat, model: usato }),
          signal: controllo.signal,
        });
      } catch (e: any) {
        // Nel registro il tipo dell'errore di rete, non il testo.
        this.opzioni.registra?.({ servizio: p.id, stato: 0, dettaglio: `non raggiungibile${/^[A-Z_]{3,30}$/.test(String(e?.cause?.code ?? e?.code ?? "")) ? ` · ${e?.cause?.code ?? e?.code}` : ""}` });
        return rispondi(503, JSON.stringify({ error: { type: "server_error", message: pulito(`${nomeBreve(p.nome)}: non raggiungibile (${e?.message ?? e})`) } }));
      }
      const limiti = Object.fromEntries([...r.headers].filter(([k]) => k.startsWith("x-ratelimit") || k === "retry-after"));
      if (r.ok) {
        this.opzioni.registra?.({ servizio: p.id, stato: r.status, modello: usato, stima, massimo: chat.max_tokens, limiti });
        break;
      }
      const testo = await r.text().catch(() => "");
      this.opzioni.registra?.({ servizio: p.id, stato: r.status, modello: usato, stima, massimo: chat.max_tokens, limiti, dettaglio: ((m) => (m ? pulito(m) : undefined))(motivoPerIlRegistro(testo)) });
      const secondi = attesaAlMinuto(r.status, testo, r.headers);
      if (secondi !== undefined && attese < 4) {
        attese++;
        this.opzioni.attesa?.(p.id, secondi);
        try {
          await (this.opzioni.dormi ?? dormi)((secondi + 1) * 1000, controllo.signal);
        } catch {
          return;
        }
        continue;
      }
      const altro = modelloNonDisponibile(r.status, testo)
        ? (this.opzioni.candidati?.(p.id) ?? []).find((m) => !provati.has(m))
        : undefined;
      if (altro && provati.size < 4) {
        this.opzioni.scarta?.(p.id, usato);
        this.sostituti.set(`${p.id}:${modello}`, altro);
        usato = altro;
        continue;
      }
      const e = erroreVersoCodex(nomeBreve(p.nome), r.status, testo, r.headers, usato);
      return rispondi(e.stato, pulito(e.corpo), e.tipo === "sse" ? "text/event-stream" : "application/json");
    }
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    const t = new Traduzione(modello, custom, spazi, chiavi.filter(Boolean) as string[]);
    res.write(t.inizio());
    // Un servizio che risponde senza streaming: un oggetto solo.
    if (!/event-stream/.test(r.headers.get("content-type") ?? "")) {
      try {
        const intero = await r.json();
        res.write(t.chunk({ ...intero, choices: (intero.choices ?? []).map((c: any) => ({ ...c, delta: c.message })) }));
      } catch {}
      res.end(t.fine());
      return;
    }
    const lettore = r.body!.getReader();
    const decodifica = new TextDecoder();
    let resto = "";
    try {
      for (;;) {
        const { value, done } = await lettore.read();
        if (done) break;
        resto += decodifica.decode(value, { stream: true });
        const righe = resto.split("\n");
        resto = righe.pop() ?? "";
        for (const riga of righe) {
          const dati = riga.startsWith("data:") ? riga.slice(5).trim() : "";
          if (!dati || dati === "[DONE]") continue;
          try {
            res.write(t.chunk(JSON.parse(dati)));
          } catch {}
        }
      }
      // L'ultima riga può arrivare senza a capo.
      const dati = resto.startsWith("data:") ? resto.slice(5).trim() : "";
      if (dati && dati !== "[DONE]")
        try {
          res.write(t.chunk(JSON.parse(dati)));
        } catch {}
    } catch {
      // Interrotto: fine() lo dice a Codex (response.failed), che riprova.
    }
    if (!t.concluso)
      this.opzioni.registra?.({ servizio: p.id, stato: 200, modello: usato, dettaglio: `risposta senza fine${t.erroreNelFlusso ? `: errore nello stream${t.codiceNelFlusso ? ` · ${t.codiceNelFlusso}` : ""}` : ": lo stream si è chiuso prima"}` });
    res.end(t.fine());
  }
}

// «NVIDIA build (gratuito)» → «NVIDIA build»: il nome nei messaggi.
export function nomeBreve(nome: string) {
  return nome.split(" · ")[0].replace(/\s*\(.*\)\s*$/, "").trim();
}

// «Questo modello non c'è per te»: 404, o un errore che parla del modello.
export function modelloNonDisponibile(stato: number, testo: string) {
  if (stato === 404) return true;
  return (stato === 400 || stato === 403) && /model.{0,40}(not found|does not exist|not available|unknown|not supported|no access)|unknown model|invalid model/i.test(testo);
}

function dormi(ms: number, segnale: AbortSignal): Promise<void> {
  return new Promise((ok, no) => {
    if (segnale.aborted) return no(Error("annullato"));
    const t = setTimeout(ok, ms);
    segnale.addEventListener("abort", () => {
      clearTimeout(t);
      no(Error("annullato"));
    }, { once: true });
  });
}

function leggi(req: IncomingMessage): Promise<string> {
  return new Promise((ok, no) => {
    let dati = "";
    req.setEncoding("utf8");
    req.on("data", (x) => {
      dati += x;
      if (dati.length > 20_000_000) req.destroy();
    });
    req.on("end", () => ok(dati));
    req.on("error", no);
  });
}
