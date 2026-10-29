// I modelli gratuiti (Fase 1 del 21 ottobre, docs/MODELLI_GRATUITI.md):
// quali sono, letti dal servizio ogni volta perché cambiano spesso, e la
// chiamata diretta di Continuity con l'API chat/completions, che quasi tutti
// i servizi gratuiti parlano e che Codex e Claude Code non parlano. Serve per
// rispondere e rivedere; sui file lavoreranno con il ponte (Fase 4).
//
// Ogni chiamata usa la chiave della persona, dal Portachiavi: Continuity non
// ha chiavi sue e non aggira i limiti dei piani gratuiti.
import { chiaveVera, conAccount, type ProviderNoto } from "./provider.js";
import type { Catalogo } from "./modelsdev.js";
import { senzaChiavi } from "../persistence/redact.js";

export type ModelloGratuito = { id: string; nome: string };

// Ciò che non è un modello di chat (trascrizione, voce, immagini, vettori,
// filtri): fuori dall'elenco anche quando il piano lo rende gratuito.
const NON_CHAT =
  /whisper|tts|embed|guard|safety|orpheus|transcri|image|imagen|veo|lyria|audio|rerank|bge|safeguard|vision-?only|moderation|robotics|-live\b|native-audio|clip|sdxl|flux|stable-diffusion|nv-?embed|parakeet|riva/i;

// Gli elenchi dei servizi hanno forme diverse: OpenAI ({data: […]}), GitHub
// (un array), Cohere ({models: […]}), Cloudflare ({result: […]}).
function voci(j: any): any[] {
  if (Array.isArray(j)) return j;
  return j?.data ?? j?.models ?? j?.result ?? [];
}

function prezzoZero(m: any) {
  const p = m?.pricing;
  if (!p) return undefined;
  return Number(p.prompt) === 0 && Number(p.completion) === 0;
}

// I modelli gratuiti di un servizio. «catalogo» è models.dev (modelsdev.ts),
// usato per «prezzo-zero» quando il servizio non dà i prezzi nell'elenco.
export async function modelliGratuiti(
  p: ProviderNoto,
  chiave: string | undefined,
  catalogo?: Catalogo,
  scarica: typeof fetch = fetch,
): Promise<ModelloGratuito[]> {
  if (!p.diretto || !p.gratis) return [];
  const indirizzo = conAccount(
    p.diretto.modelli ?? `${p.diretto.indirizzo}/models`,
    chiave,
  );
  const r = await scarica(indirizzo, {
    headers: chiave ? { authorization: `Bearer ${chiaveVera(p, chiave)}` } : {},
    signal: AbortSignal.timeout(15000),
  });
  if (r.status === 401 || r.status === 403)
    throw new ErroreGratuito("chiave", `${p.nome} ha rifiutato la chiave: ricollegala con /collega ${p.id}`);
  if (!r.ok) throw new ErroreGratuito("servizio", `${p.nome} non ha dato l'elenco dei modelli (HTTP ${r.status})`);
  const elenco = voci(await r.json().catch(() => ({})));
  const dalCatalogo = p.catalogo ? catalogo?.[p.catalogo] : undefined;
  const fuori: ModelloGratuito[] = [];
  for (const m of elenco) {
    const id = String(m?.id ?? m?.name ?? "").replace(/^models\//, "");
    if (!id || NON_CHAT.test(id)) continue;
    // Cloudflare e Mistral dicono che cosa sa fare il modello.
    if (m?.capabilities?.completion_chat === false) continue;
    let gratis = false;
    if (p.gratis === "tutti") gratis = true;
    else if (p.gratis instanceof RegExp) gratis = p.gratis.test(id);
    else {
      // Prezzo zero: dall'elenco stesso (OpenRouter), poi da models.dev, poi
      // dal nome («…-free», «…:free») se il catalogo non c'è.
      const zero = prezzoZero(m);
      gratis =
        zero ??
        (dalCatalogo?.[id] ? dalCatalogo[id].gratuito : /(?:[-:]free)$/.test(id));
    }
    if (gratis)
      fuori.push({ id, nome: String(m?.name && m.name !== id ? m.name : (dalCatalogo?.[id]?.nome ?? id)) });
  }
  return fuori.sort((a, b) => a.id.localeCompare(b.id));
}

export class ErroreGratuito extends Error {
  constructor(
    // «quota»: limite del piano gratuito; «chiave»: rifiutata; «modello»: non
    // esiste o non è disponibile; «servizio»: altro.
    // «sovraccarico»: il servizio dice di riprovare più tardi (503);
    // «lento»: nessuna risposta entro il tempo massimo.
    // «troppo»: la richiesta è più grande di quanto il piano accetti.
    // «vuota»: il servizio ha risposto senza testo (CT-2.0-105).
    readonly tipo: "quota" | "chiave" | "modello" | "servizio" | "sovraccarico" | "lento" | "interrotta" | "troppo" | "vuota",
    messaggio: string,
    // Fra quanti secondi riprovare, se il servizio lo dice.
    readonly riprova?: number,
  ) {
    super(messaggio);
  }
}

export type Messaggio = { role: "system" | "user" | "assistant"; content: string };

// Una domanda a un modello, con la risposta in arrivo a pezzi. Nessuno
// strumento: il modello legge ciò che Continuity gli manda e risponde.
export async function chiediModello(
  opzioni: {
    provider: ProviderNoto;
    chiave?: string;
    modello: string;
    messaggi: Messaggio[];
    ogniPezzo?: (pezzo: string) => void;
    segnale?: AbortSignal;
    massimo?: number;
    // Tempo massimo per la prima parola e fra un pezzo e l'altro: un modello
    // sovraccarico a volte non risponde affatto, e senza limite si aspettava
    // per sempre (Google, 25 ottobre).
    attesaPrimo?: number;
    attesaPezzi?: number;
  },
  scarica: typeof fetch = fetch,
): Promise<string> {
  const p = opzioni.provider;
  const controllo = new AbortController();
  let scaduto = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const aspetta = (ms: number, perché: string) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      scaduto = perché;
      controllo.abort();
    }, ms);
  };
  const esterno = opzioni.segnale;
  if (esterno?.aborted) throw new ErroreGratuito("interrotta", "Risposta interrotta");
  esterno?.addEventListener("abort", () => controllo.abort(), { once: true });
  const attesaPrimo = opzioni.attesaPrimo ?? 30_000;
  const attesaPezzi = opzioni.attesaPezzi ?? 60_000;
  aspetta(attesaPrimo, `${opzioni.modello} non risponde da ${Math.round(attesaPrimo / 1000)} secondi`);
  const perduto = () =>
    esterno?.aborted
      ? new ErroreGratuito("interrotta", "Risposta interrotta")
      : new ErroreGratuito("lento", `${p.nome}: ${scaduto || "nessuna risposta"}`);
  try {
    return await chiedi(opzioni, scarica, controllo.signal, () => aspetta(attesaPezzi, `${opzioni.modello} si è fermato a metà risposta`), perduto);
  } catch (e) {
    // Ogni errore esce senza la chiave: dalla risposta del servizio, dallo
    // stream, dalla rete (ottavo collaudo, CT-2.0-602).
    const chiavi = [opzioni.chiave, ...(opzioni.chiave?.split(":") ?? [])];
    if (e instanceof ErroreGratuito) throw new ErroreGratuito(e.tipo, senzaChiavi(e.message, chiavi), e.riprova);
    if (e instanceof Error) {
      const pulito = new Error(senzaChiavi(e.message, chiavi));
      pulito.name = e.name;
      throw pulito;
    }
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function chiedi(
  opzioni: Parameters<typeof chiediModello>[0],
  scarica: typeof fetch,
  segnale: AbortSignal,
  vivo: () => void,
  perduto: () => ErroreGratuito,
): Promise<string> {
  const p = opzioni.provider;
  if (!p.diretto) throw new ErroreGratuito("servizio", `${p.nome} non si chiama direttamente`);
  const indirizzo = conAccount(p.diretto.indirizzo, opzioni.chiave) + "/chat/completions";
  let r: Response;
  try {
    r = await scarica(indirizzo, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(opzioni.chiave ? { authorization: `Bearer ${chiaveVera(p, opzioni.chiave)}` } : {}),
      },
      body: JSON.stringify({
        model: opzioni.modello,
        messages: opzioni.messaggi,
        stream: true,
        ...(opzioni.massimo ? { max_tokens: opzioni.massimo } : {}),
      }),
      signal: segnale,
    });
  } catch (e: any) {
    if (segnale.aborted) throw perduto();
    throw new ErroreGratuito("servizio", `${p.nome} non raggiungibile: ${e?.message ?? e}`);
  }
  if (!r.ok) {
    // Prima si toglie la chiave (il servizio può ripeterla), poi si taglia:
    // tagliando prima ne resterebbe un pezzo (CT-2.0-602).
    const testo = senzaChiavi(await r.text().catch(() => ""), [opzioni.chiave, ...(opzioni.chiave?.split(":") ?? [])]).slice(0, 300);
    if (r.status === 413 || /too large|reduce your message|context length|maximum context|context window/i.test(testo))
      throw new ErroreGratuito(
        "troppo",
        `${p.nome}: la richiesta è troppo grande per il piano gratuito di ${opzioni.modello}`,
      );
    if (r.status === 429) {
      const dopo = Number(r.headers.get("retry-after"));
      throw new ErroreGratuito(
        "quota",
        `${p.nome}: limite del piano gratuito raggiunto${Number.isFinite(dopo) && dopo > 0 ? `, riprova fra ${Math.ceil(dopo)} s` : ""}`,
        Number.isFinite(dopo) && dopo > 0 ? dopo : undefined,
      );
    }
    if (r.status === 401 || r.status === 403)
      throw new ErroreGratuito("chiave", `${p.nome} ha rifiutato la chiave (HTTP ${r.status}): ricollegala con /collega ${p.id}`);
    if (r.status === 503 || r.status === 529 || /overload|high demand|unavailable/i.test(testo))
      throw new ErroreGratuito(
        "sovraccarico",
        `${p.nome}: ${opzioni.modello} è sovraccarico in questo momento`,
      );
    if (r.status === 402)
      throw new ErroreGratuito("quota", `${p.nome}: questo modello non è gratuito o il credito gratuito è finito`);
    if (r.status === 404 || r.status === 400)
      throw new ErroreGratuito("modello", `${p.nome}: il modello ${opzioni.modello} non è disponibile per il tuo account (HTTP ${r.status})`);
    throw new ErroreGratuito("servizio", `${p.nome} ha risposto con errore (HTTP ${r.status}) ${testo}`.trim());
  }
  // Risposta intera, se il servizio ignora lo streaming.
  if (!(r.headers.get("content-type") ?? "").includes("event-stream")) {
    const j: any = await r.json().catch(() => {
      if (segnale.aborted) throw perduto();
      return {};
    });
    const testo = String(j?.choices?.[0]?.message?.content ?? "");
    if (!testo.trim()) throw new ErroreGratuito("vuota", `${p.nome}: ${opzioni.modello} ha risposto senza testo`);
    opzioni.ogniPezzo?.(testo);
    return testo;
  }
  let risposta = "";
  let resto = "";
  const decodifica = new TextDecoder();
  try {
  for await (const blocco of r.body as any as AsyncIterable<Uint8Array>) {
    // Il tempo si rinnova solo con testo vero: commenti «: ping» e metadati
    // non sono una risposta (CT-2.0-103, prima ogni blocco di rete bastava).
    resto += decodifica.decode(blocco, { stream: true });
    const righe = resto.split("\n");
    resto = righe.pop() ?? "";
    for (const riga of righe) {
      const dato = riga.replace(/^data:\s*/, "").trim();
      if (!riga.startsWith("data:") || !dato || dato === "[DONE]") continue;
      try {
        const j = JSON.parse(dato);
        if (j?.error) {
          const msg = String(j.error.message ?? "errore nel flusso");
          throw new ErroreGratuito(
            Number(j.error.code) === 503 || /overload|high demand|unavailable/i.test(msg) ? "sovraccarico" : Number(j.error.code) === 429 ? "quota" : "servizio",
            `${p.nome}: ${msg}`,
          );
        }
        const pezzo = String(j?.choices?.[0]?.delta?.content ?? "");
        if (pezzo) {
          vivo();
          risposta += pezzo;
          opzioni.ogniPezzo?.(pezzo);
        }
      } catch (e) {
        if (e instanceof ErroreGratuito) throw e;
      }
    }
  }
  } catch (e) {
    if (e instanceof ErroreGratuito) throw e;
    if (segnale.aborted) throw perduto();
    throw e;
  }
  if (!risposta.trim()) throw new ErroreGratuito("vuota", `${p.nome}: ${opzioni.modello} ha risposto senza testo`);
  return risposta;
}

// Gli errori dopo i quali conviene provare un altro modello dello stesso
// servizio: sovraccarico, troppo lento, limite del modello, modello assente.
export function siPassaAlProssimo(e: unknown) {
  return e instanceof ErroreGratuito && ["sovraccarico", "lento", "quota", "modello", "vuota"].includes(e.tipo);
}

// Il primo modello che risponde davvero a una domanda minima («ok»), nell'ordine
// dato. Si usa scegliendo il servizio con /ai: si sceglie solo ciò che funziona.
export async function primoCheFunziona(
  p: ProviderNoto,
  chiave: string | undefined,
  candidati: string[],
  scarica: typeof fetch = fetch,
  massimo = 4,
): Promise<{ modello: string; saltati: string[] }> {
  const saltati: string[] = [];
  let ultimo: unknown;
  for (const modello of candidati.slice(0, massimo)) {
    try {
      await chiediModello(
        { provider: p, chiave, modello, messaggi: [{ role: "user", content: "Rispondi solo: ok" }], massimo: 5, attesaPrimo: 20_000 },
        scarica,
      );
      return { modello, saltati };
    } catch (e) {
      if (!siPassaAlProssimo(e)) throw e;
      ultimo = e;
      saltati.push(modello);
    }
  }
  throw ultimo instanceof Error ? ultimo : new ErroreGratuito("servizio", `${p.nome}: nessun modello gratuito risponde in questo momento`);
}

// L'ordine in cui provare i modelli: i consigliati del servizio, poi gli altri.
export function inOrdine(p: { consigliati?: RegExp[] }, elenco: string[]) {
  const primi: string[] = [];
  for (const r of p.consigliati ?? []) for (const m of elenco) if (r.test(m) && !primi.includes(m)) primi.push(m);
  return [...primi, ...elenco.filter((m) => !primi.includes(m))];
}
