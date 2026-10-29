// Fase 1 del 21 ottobre: modelli gratuiti collegati (docs/MODELLI_GRATUITI.md).
// Tutto con servizi finti: nessuna chiamata vera, nessuna chiave vera.
import { it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PROVIDER, providerNoto, nuovaSequenza } from "../src/core/provider.js";
import { chiediModello, ErroreGratuito, modelliGratuiti } from "../src/core/gratuiti.js";
import { provaCollegamento } from "../src/core/collega.js";
import { collega } from "../src/cli/collega.js";
import { portachiaviInMemoria } from "../src/core/portachiavi.js";
import { segnaCollegato, sequenzaPredefinita } from "../src/core/collegati.js";

const p = (id: string) => providerNoto(id)!;

// Un fetch finto che registra le richieste e risponde con ciò che si vuole.
function finto(risposte: Record<string, () => Response>) {
  const viste: { url: string; init?: RequestInit }[] = [];
  const scarica = (async (url: any, init?: RequestInit) => {
    viste.push({ url: String(url), init });
    const chiave = Object.keys(risposte).find((k) => String(url).includes(k));
    if (!chiave) return new Response("{}", { status: 404 });
    return risposte[chiave]();
  }) as unknown as typeof fetch;
  return { scarica, viste };
}
const json = (x: unknown, status = 200) =>
  new Response(JSON.stringify(x), { status, headers: { "content-type": "application/json" } });

it("ogni servizio gratuito chiamato direttamente ha indirizzo, regola dei gratuiti e pagina della chiave", () => {
  const diretti = PROVIDER.filter((x) => x.motore === "diretto");
  expect(diretti.map((x) => x.id)).toEqual(
    expect.arrayContaining(["google", "groq", "mistral", "nvidia", "cloudflare", "cohere"]),
  );
  // Tolti il 28 ottobre (ricerca legale): Zen gratuito «richiede OpenCode»,
  // GitHub Models è chiuso dal 30 luglio 2026.
  expect(diretti.map((x) => x.id)).not.toContain("zen");
  expect(diretti.map((x) => x.id)).not.toContain("github");
  for (const x of diretti) {
    expect(x.diretto?.indirizzo).toMatch(/^https:\/\//);
    expect(x.gratis).toBeDefined();
    expect(x.console).toMatch(/^https:\/\//);
    expect(x.accesso).toBe("chiave");
  }
});

it("i servizi gratuiti collegati entrano nella sequenza e lavorano sui file (ponte, 28 ottobre)", () => {
  expect(nuovaSequenza(["codex", "claude"], "groq")).toEqual(["groq", "codex", "claude"]);
  const dati = mkdtempSync(join(tmpdir(), "continuity-gratuiti-"));
  segnaCollegato(dati, "groq", true);
  segnaCollegato(dati, "openrouter", true);
  expect(sequenzaPredefinita(dati)).toEqual(["codex", "claude", "openrouter", "groq"]);
});

it("OpenRouter: gratuiti quelli a prezzo zero nell'elenco del servizio", async () => {
  const { scarica } = finto({
    "openrouter.ai/api/v1/models": () =>
      json({
        data: [
          { id: "a/libero:free", name: "Libero", pricing: { prompt: "0", completion: "0" } },
          { id: "b/pagato", name: "Pagato", pricing: { prompt: "0.000001", completion: "0.000002" } },
        ],
      }),
  });
  expect(await modelliGratuiti(p("openrouter"), undefined, undefined, scarica)).toEqual([
    { id: "a/libero:free", nome: "Libero" },
  ]);
});

// Un servizio di prova con le regole che Zen usava (prezzo zero dal catalogo,
// elenco pubblico): servono ancora ad altri (Z.ai) e ai servizi futuri.
const comeZen = () => ({
  ...p("groq"),
  id: "finto",
  gratis: "prezzo-zero" as const,
  catalogo: "opencode",
  massimoToken: undefined,
  diretto: { indirizzo: "https://opencode.ai/inference/openai/v1", modelli: "https://opencode.ai/inference/v1/models" },
  prova: { url: "https://opencode.ai/inference/v1/models", intestazioni: (k: string) => ({ authorization: `Bearer ${k}` }), pubblica: true },
});

it("prezzo zero da models.dev, e senza catalogo dal nome «-free»", async () => {
  const elenco = { data: [{ id: "big-pickle" }, { id: "deepseek-v4.1-flash-free" }, { id: "muse-spark-1.3" }] };
  const { scarica, viste } = finto({ "opencode.ai/inference/v1/models": () => json(elenco) });
  const catalogo = {
    opencode: {
      "big-pickle": { id: "big-pickle", nome: "Big Pickle", gratuito: true },
      "deepseek-v4.1-flash-free": { id: "deepseek-v4.1-flash-free", nome: "DeepSeek V4.1 Flash Free", gratuito: true },
      "muse-spark-1.3": { id: "muse-spark-1.3", nome: "Muse Spark 1.3", gratuito: false },
    },
  };
  expect((await modelliGratuiti(comeZen(), "k", catalogo, scarica)).map((m) => m.id)).toEqual([
    "big-pickle",
    "deepseek-v4.1-flash-free",
  ]);
  expect(viste[0].url).toBe("https://opencode.ai/inference/v1/models");
  // Senza catalogo vale il nome: «big-pickle» non si può riconoscere.
  expect((await modelliGratuiti(comeZen(), "k", undefined, scarica)).map((m) => m.id)).toEqual([
    "deepseek-v4.1-flash-free",
  ]);
});

it("Google: solo i modelli del piano gratuito, senza voce, immagini e tempo reale", async () => {
  const { scarica } = finto({
    "generativelanguage.googleapis.com": () =>
      json({
        data: [
          { id: "models/gemini-3.8-flash" },
          { id: "models/gemini-3.5-flash-lite" },
          { id: "models/gemini-3-flash-preview" },
          { id: "models/gemini-2.5-pro" },
          { id: "models/gemma-4-31b-it" },
          { id: "models/gemini-3.1-pro-preview" },
          { id: "models/gemini-2.5-flash-preview-tts" },
          { id: "models/gemini-2.5-flash-image" },
          { id: "models/gemini-3.8-flash-live" },
          { id: "models/gemini-embedding-2" },
        ],
      }),
  });
  expect((await modelliGratuiti(p("google"), "k", undefined, scarica)).map((m) => m.id)).toEqual([
    "gemini-2.5-pro",
    "gemini-3-flash-preview",
    "gemini-3.5-flash-lite",
    "gemini-3.8-flash",
    "gemma-4-31b-it",
  ]);
});

it("Groq, Cohere e Cloudflare: forme diverse dell'elenco, solo modelli di chat", async () => {
  const { scarica, viste } = finto({
    "api.groq.com": () => json({ data: [{ id: "openai/gpt-oss-120b" }, { id: "whisper-large-v3" }] }),
    "api.cohere.com": () => json({ models: [{ name: "command-a" }] }),
    "api.cloudflare.com": () => json({ result: [{ name: "@cf/openai/gpt-oss-120b" }] }),
  });
  expect((await modelliGratuiti(p("groq"), "k", undefined, scarica)).map((m) => m.id)).toEqual(["openai/gpt-oss-120b"]);
  expect((await modelliGratuiti(p("cohere"), "k", undefined, scarica)).map((m) => m.id)).toEqual(["command-a"]);
  expect((await modelliGratuiti(p("cloudflare"), "acct123:tok", undefined, scarica)).map((m) => m.id)).toEqual([
    "@cf/openai/gpt-oss-120b",
  ]);
  const cf = viste.find((v) => v.url.includes("cloudflare"))!;
  // L'account va nell'indirizzo, solo il token nell'intestazione.
  expect(cf.url).toContain("/accounts/acct123/");
  expect((cf.init?.headers as any).authorization).toBe("Bearer tok");
});

it("una chiave rifiutata nell'elenco dei modelli lo dice", async () => {
  const { scarica } = finto({ "api.groq.com": () => json({}, 401) });
  await expect(modelliGratuiti(p("groq"), "k", undefined, scarica)).rejects.toThrow(/rifiutato la chiave/);
});

it("la risposta arriva a pezzi (streaming) e si ricompone", async () => {
  const flusso = [
    'data: {"choices":[{"delta":{"content":"Cia"}}]}',
    'data: {"choices":[{"delta":{"content":"o!"}}]}',
    "data: [DONE]",
    "",
  ].join("\n");
  const { scarica, viste } = finto({
    "chat/completions": () => new Response(flusso, { headers: { "content-type": "text/event-stream" } }),
  });
  const pezzi: string[] = [];
  const r = await chiediModello(
    { provider: p("groq"), chiave: "k", modello: "openai/gpt-oss-20b", messaggi: [{ role: "user", content: "ciao" }], ogniPezzo: (x) => pezzi.push(x) },
    scarica,
  );
  expect(r).toBe("Ciao!");
  expect(pezzi).toEqual(["Cia", "o!"]);
  expect(viste[0].url).toBe("https://api.groq.com/openai/v1/chat/completions");
  const corpo = JSON.parse(String(viste[0].init?.body));
  expect(corpo).toMatchObject({ model: "openai/gpt-oss-20b", stream: true });
});

it("limite del piano gratuito, chiave rifiutata e modello assente sono errori distinti", async () => {
  const domanda = (scarica: typeof fetch) =>
    chiediModello({ provider: p("groq"), chiave: "k", modello: "m", messaggi: [{ role: "user", content: "x" }] }, scarica);
  const quota = finto({ "chat/completions": () => new Response("troppo", { status: 429, headers: { "retry-after": "30" } }) });
  const e1 = await domanda(quota.scarica).catch((e) => e);
  expect(e1).toBeInstanceOf(ErroreGratuito);
  expect(e1.tipo).toBe("quota");
  expect(e1.riprova).toBe(30);
  expect(e1.message).toMatch(/limite del piano gratuito.*30 s/);
  const chiave = finto({ "chat/completions": () => new Response("no", { status: 401 }) });
  expect((await domanda(chiave.scarica).catch((e) => e)).tipo).toBe("chiave");
  const modello = finto({ "chat/completions": () => new Response("model not found", { status: 404 }) });
  expect((await domanda(modello.scarica).catch((e) => e)).tipo).toBe("modello");
  // Un servizio che risponde senza streaming va bene lo stesso.
  const intera = finto({ "chat/completions": () => json({ choices: [{ message: { content: "intera" } }] }) });
  expect(await domanda(intera.scarica)).toBe("intera");
});

it("Cloudflare si collega con ID dell'account e token; la prova usa l'account", async () => {
  const dati = mkdtempSync(join(tmpdir(), "continuity-gratuiti-"));
  const chiavi = portachiaviInMemoria();
  const risposte = ["acct123", "tok-segreto"];
  const scritto: string[] = [];
  let provato = "";
  const esito = await collega(
    dati,
    chiavi,
    {
      chiedi: async () => risposte.shift() ?? null,
      chiediNascosto: async () => risposte.shift() ?? null,
      scrivi: (t) => void scritto.push(t),
    },
    "cloudflare",
    async (_p, chiave) => {
      provato = chiave!;
      return { ok: true, dettaglio: "collegamento riuscito" };
    },
  );
  expect(esito.stato).toBe("collegato");
  expect(provato).toBe("acct123:tok-segreto");
  expect(chiavi.leggi("cloudflare")).toBe("acct123:tok-segreto");
  expect(scritto.join("")).not.toContain("tok-segreto");
  const { scarica, viste } = finto({ "api.cloudflare.com": () => json({ result: [] }) });
  await provaCollegamento(p("cloudflare"), "acct123:tok-segreto", scarica);
  expect(viste[0].url).toContain("/accounts/acct123/ai/models/search");
  expect((viste[0].init?.headers as any).authorization).toBe("Bearer tok-segreto");
});

it("collegando un servizio gratuito si dice che cosa fa dei dati", async () => {
  const scritto: string[] = [];
  await collega(
    mkdtempSync(join(tmpdir(), "continuity-gratuiti-")),
    portachiaviInMemoria(),
    { chiedi: async () => null, chiediNascosto: async () => null, scrivi: (t) => void scritto.push(t) },
    "mistral",
  );
  expect(scritto.join("")).toMatch(/Dati: .*addestramento/);
  expect(scritto.join("")).toContain("https://console.mistral.ai/api-keys");
});

it("una prova su un elenco pubblico non dice che la chiave è buona", async () => {
  const { scarica } = finto({ "opencode.ai": () => json({ data: [] }) });
  const esito = await provaCollegamento(comeZen(), "qualunque", scarica);
  expect(esito.ok).toBe(true);
  expect(esito.dettaglio).toMatch(/si verifica alla prima richiesta/);
});

it("nessun consenso da chiedere: il servizio lo dice una volta al collegamento; la scelta automatica usa tutti i gratuiti", async () => {
  const { serveConsenso, PREFERITI_REVISORE, revisorePredefinito } = await import("../src/core/revisore.js");
  for (const id of ["google", "mistral", "nvidia", "cohere", "groq"]) expect(serveConsenso(p(id), revisorePredefinito())).toBe(false);
  // Che cosa fanno dei dati resta scritto, per /collega.
  expect(p("google").dati).toMatch(/Human reviewers may read/);
  expect(p("nvidia").dati).toMatch(/not in production/);
  expect(p("nvidia").nome).not.toMatch(/solo prova/);
  expect(PREFERITI_REVISORE).toEqual(["groq", "cloudflare", "google", "mistral", "nvidia", "cohere"]);
});
