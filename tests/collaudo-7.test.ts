// I difetti del settimo collaudo (29 ottobre 2026), uno per prova: chiave nel
// ponte, richiesta troppo lunga per Groq, Portachiavi per percorso, prova
// della chiave NVIDIA, installatore, traduzioni. Niente rete, niente chiavi vere.
import { it, expect, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Ponte, type EsitoPonte } from "../src/ponte/server.js";
import { stringiPerIlLimite } from "../src/ponte/limite.js";
import { motivoPerIlRegistro } from "../src/ponte/traduttore.js";
import { senzaChiavi } from "../src/persistence/redact.js";
import { servizioPortachiavi } from "../src/core/portachiavi.js";
import { provaCollegamento } from "../src/core/collega.js";
import { providerNoto } from "../src/core/provider.js";
import { impostaLingua, traduci } from "../src/tui/lingua.js";
import { cartellaBaseDati } from "../src/piattaforma.js";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
const temp = (n: string) => {
  const d = mkdtempSync(join(tmpdir(), n));
  dirs.push(d);
  return d;
};

const CHIAVE = "gsk_FAKE_COLLAUDO7_SENTINELLA_123456";

it("CT-2.0-602: un servizio che ripete la chiave nell'errore non la fa arrivare a Codex né al registro", async () => {
  const registro: EsitoPonte[] = [];
  const ponte = new Ponte({
    chiave: () => CHIAVE,
    registra: (e) => registro.push(e),
    scarica: (async () =>
      new Response(
        JSON.stringify({ error: { type: "invalid_request_error", code: "invalid_api_key", message: `Invalid API Key ${CHIAVE} TESTO_DELLA_PERSONA` } }),
        { status: 401 },
      )) as any,
  });
  try {
    await ponte.avvia();
    const r = await fetch(`${ponte.indirizzo("groq")}/responses`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${ponte.gettone}` },
      body: JSON.stringify({ model: "openai/gpt-oss-120b", input: "TESTO_DELLA_PERSONA" }),
    });
    const corpo = await r.text();
    expect(r.status).toBe(401);
    expect(corpo).not.toContain(CHIAVE);
    expect(corpo).not.toContain("TESTO_DELLA_PERSONA");
    expect(JSON.parse(corpo).error.message).toBe("Groq: chiave rifiutata (HTTP 401). Ricollegala con /collega.");
    const scritto = JSON.stringify(registro);
    expect(scritto).not.toContain(CHIAVE);
    expect(scritto).not.toContain("TESTO_DELLA_PERSONA");
    // Il codice dell'errore resta: serve a capire che cosa è successo.
    expect(registro.at(-1)).toMatchObject({ stato: 401, dettaglio: "invalid_api_key · invalid_request_error" });
  } finally {
    await ponte.ferma();
  }
});

it("CT-2.0-602: il registro tiene i numeri del limite, non il testo; le chiavi dei gratuiti si riconoscono anche senza saperle", () => {
  expect(
    motivoPerIlRegistro(
      JSON.stringify({ error: { message: "Rate limit reached for model `openai/gpt-oss-120b` on tokens per minute (TPM): Limit 8000, Used 6000, Requested 3100. Please try again in 8.25s. ricetta della persona", type: "tokens", code: "rate_limit_exceeded" } }),
    ),
  ).toBe("rate_limit_exceeded · tokens · limite 8000, chiesti 3100 · riprovare fra 8.25s · al minuto");
  expect(motivoPerIlRegistro("testo libero senza JSON")).toBeUndefined();
  for (const c of ["gsk_abcdefghijklmnop1234", "nvapi-abcdefghijklmnop-1234", "xai-abcdefghijklmnop1234", "hf_abcdefghijklmnop1234"])
    expect(senzaChiavi(`errore con ${c} dentro`, [])).toBe("errore con [REDACTED] dentro");
  // Il valore esatto si toglie anche senza un prefisso noto.
  expect(senzaChiavi("chiave 0123456789abcdef rifiutata", ["0123456789abcdef"])).toBe("chiave [REDACTED] rifiutata");
});

const lunga = (n: number) => ({
  messages: [
    { role: "system", content: "Regole" },
    { role: "user", content: "x".repeat(n) },
  ],
  tools: [],
});

it("CT-2.0-603: una richiesta della persona troppo lunga per Groq non si manda e non si taglia di nascosto", async () => {
  const chat: any = lunga(100_000);
  const stretta = stringiPerIlLimite(chat, 7000);
  expect(stretta.entra).toBe(false);
  // La richiesta della persona resta intera.
  expect(chat.messages[1].content).toHaveLength(100_000);
  expect(stringiPerIlLimite(lunga(2000) as any, 7000).entra).toBe(true);

  let chiamate = 0;
  const registro: EsitoPonte[] = [];
  const ponte = new Ponte({
    chiave: () => CHIAVE,
    registra: (e) => registro.push(e),
    scarica: (async () => {
      chiamate++;
      return new Response("{}");
    }) as any,
  });
  try {
    await ponte.avvia();
    const r = await fetch(`${ponte.indirizzo("groq")}/responses`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${ponte.gettone}` },
      body: JSON.stringify({ model: "openai/gpt-oss-120b", input: "y".repeat(100_000) }),
    });
    expect(r.status).toBe(400);
    const errore = (await r.json()).error;
    expect(errore.code).toBe("request_too_large");
    expect(errore.message).toMatch(/^Groq: il messaggio è troppo lungo per il piano gratuito \(circa [\d.]+ token; ne accetta circa 7\.?000 al minuto, risposta compresa\)\. Accorcialo/);
    expect(chiamate).toBe(0);
    expect(registro.at(-1)?.dettaglio).toMatch(/^richiesta non mandata: ~\d+ token anche stretta, il limite è 7000$/);
  } finally {
    await ponte.ferma();
  }
});

it("CT-2.0-608: due cartelle dati con lo stesso nome hanno chiavi separate; quelle in Application Support tengono il nome di sempre", () => {
  const casa = "/Users/prova";
  const a = servizioPortachiavi("/tmp/a/dati", casa);
  const b = servizioPortachiavi("/tmp/b/dati", casa);
  expect(a).toMatch(/^Continuity · dati · [0-9a-f]{8}$/);
  expect(b).toMatch(/^Continuity · dati · [0-9a-f]{8}$/);
  expect(a).not.toBe(b);
  // Lo stesso percorso scritto in modi diversi è la stessa cartella.
  expect(servizioPortachiavi("/tmp/a/dati/", casa)).toBe(a);
  expect(servizioPortachiavi("/tmp/a/x/../dati", casa)).toBe(a);
  // «Application Support» sul Mac, ~/.local/share su Linux.
  expect(servizioPortachiavi(join(cartellaBaseDati(casa), "Continuity_2.0"), casa)).toBe("Continuity · Continuity_2.0");
  expect(servizioPortachiavi(join(cartellaBaseDati(casa), "Continuity"), casa)).toBe("Continuity · Continuity");
});

// Il confronto vero fra programma e uninstall.sh è in tests/collaudo-8.test.ts (CT-2.0-702).

it("CT-2.0-610: NVIDIA, l'elenco dei modelli è pubblico: la chiave si prova con una risposta di un token", async () => {
  const nvidia = providerNoto("nvidia")!;
  const viste: { url: string; corpo?: any }[] = [];
  const finto = (stato: number) =>
    (async (url: any, init: any) => {
      viste.push({ url: String(url), corpo: init?.body ? JSON.parse(init.body) : undefined });
      if (String(url).endsWith("/models"))
        return new Response(JSON.stringify({ data: [{ id: "meta/llama-3.1-8b-instruct" }, { id: "nvidia/nemotron-3.5-super-vl-120b-a12b" }] }));
      return new Response(stato === 200 ? '{"choices":[]}' : '{"status":403,"title":"Forbidden","detail":"Authorization failed"}', { status: stato });
    }) as any;

  const inventata = await provaCollegamento(nvidia, "nvapi-INVENTATA", finto(403));
  expect(inventata).toEqual({ ok: false, chiaveRifiutata: true, dettaglio: "il servizio ha rifiutato la chiave (HTTP 403)" });
  // Il primo modello consigliato, una parola, un token di risposta.
  expect(viste[1]).toEqual({
    url: "https://integrate.api.nvidia.com/v1/chat/completions",
    corpo: { model: "nvidia/nemotron-3.5-super-vl-120b-a12b", messages: [{ role: "user", content: "ok" }], max_tokens: 1 },
  });
  expect(await provaCollegamento(nvidia, "nvapi-buona", finto(200))).toEqual({ ok: true, dettaglio: "chiave valida" });
  // Il limite al minuto vuol dire che la chiave è stata accettata.
  expect((await provaCollegamento(nvidia, "nvapi-buona", finto(429))).ok).toBe(true);
});

// L'installatore eseguito davvero, con un pnpm finto: tests/collaudo-8.test.ts (CT-2.0-703).

it("CT-2.0-606: in inglese anche i nomi predefiniti dentro titoli e passi, l'attesa di Groq e i problemi rimasti", () => {
  const dati = temp("lingua-c7-");
  impostaLingua(dati, "en");
  try {
    expect(traduci("Tema")).toBe("Theme");
    expect(traduci("Flusso «Pianifica, lavora e ricontrolla»")).toBe("Workflow ‘Plan, work and review’");
    expect(traduci("Nome: Pianifica, lavora e ricontrolla")).toBe("Name: Plan, work and review");
    expect(traduci("1. Pianifica")).toBe("1. Plan");
    expect(traduci("Passo 1: Pianifica")).toBe("Step 1: Plan");
    expect(traduci("Chi fa «Pianifica»")).toBe("Who handles ‘Plan’");
    expect(traduci("approva sempre")).toBe("always approve");
    expect(traduci("Chi rivede: nessun gratuito collegato")).toBe("Reviewer: no free provider connected");
    expect(traduci("Flusso «Pianifica, lavora e ricontrolla». Esc lo lascia in attesa: invio lo riapre.")).toBe(
      "Workflow ‘Plan, work and review’. Esc leaves it waiting; enter opens it again.",
    );
    expect(traduci("Groq: limite al minuto del piano gratuito, aspetto 1 s e riprovo")).toBe("Groq: free plan per-minute limit, waiting 1 s and retrying");
    expect(
      traduci("Flusso «Lavora» concluso con problemi: Dopo 2 giri di correzione resta 1 problema: lo passo all'AI con il prossimo messaggio (puoi scartarlo in /revisore)"),
    ).toBe("Workflow ‘Work’ completed with issues: After 2 review rounds 1 issue remains: it goes to the AI with your next message (you can discard it in /reviewer)");
    expect(traduci("Flusso «Lavora» fermato: Rivede non è partito: nessuna AI")).toBe("Workflow ‘Work’ stopped: Review did not start: nessuna AI");
    expect(traduci("NVIDIA build connected · chiave valida")).toBe("NVIDIA build connected · key is valid");
    // Un nome scelto dalla persona resta com'è.
    expect(traduci("Flusso «Il mio giro»")).toBe("Workflow ‘Il mio giro’");
  } finally {
    impostaLingua(dati, "it");
  }
});
