// Il ponte della Fase 4: i servizi gratuiti lavorano sui file attraverso
// Codex. Traduttore, server e un turno vero di Codex (se installato) contro un
// servizio gratuito finto: niente rete, niente chiavi vere.
import { it, expect, afterEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { erroreVersoCodex, richiestaChat, Traduzione } from "../src/ponte/traduttore.js";
import { Ponte } from "../src/ponte/server.js";
import { stimaToken } from "../src/ponte/limite.js";
import { resolveProvider } from "../src/adapters/resolve.js";
import { argomentiPonte, ambienteProvider, motivoLeggibile, normalizedLiveEvent } from "../src/adapters/live.js";
import { providerNoto } from "../src/core/provider.js";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
const temp = (n: string) => {
  const d = mkdtempSync(join(tmpdir(), n));
  dirs.push(d);
  return d;
};
const eventi = (sse: string) =>
  sse
    .split("\n\n")
    .map((b) => b.split("\n").find((r) => r.startsWith("data: ")))
    .filter(Boolean)
    .map((r) => JSON.parse(r!.slice(6)));

it("richiesta: istruzioni in testa, chiamate fuse, apply_patch e namespace diventano funzioni", () => {
  const { chat, custom, spazi } = richiestaChat(
    {
      model: "m",
      instructions: "",
      input: [
        { type: "message", role: "developer", content: [{ type: "input_text", text: "Regole base" }] },
        { type: "message", role: "user", content: [{ type: "input_text", text: "Crea a.txt" }] },
        { type: "reasoning", summary: [] },
        { type: "function_call", call_id: "c1", name: "exec_command", arguments: '{"cmd":"ls"}' },
        { type: "custom_tool_call", call_id: "c2", name: "apply_patch", input: "*** Begin Patch\n*** End Patch\n" },
        { type: "function_call_output", call_id: "c1", output: "a.txt" },
        { type: "custom_tool_call_output", call_id: "c2", output: [{ type: "input_text", text: "Success" }] },
        { type: "message", role: "developer", content: "Nota a metà" },
      ],
      tools: [
        { type: "function", name: "exec_command", description: "esegue", parameters: { type: "object" } },
        { type: "custom", name: "apply_patch", description: "patch", format: { type: "grammar", syntax: "lark", definition: "start: x" } },
        { type: "namespace", name: "multi", description: "agenti", tools: [{ type: "function", name: "spawn", parameters: {} }] },
        { type: "web_search" },
      ],
      tool_choice: "auto",
      parallel_tool_calls: true,
      store: false,
      include: ["reasoning.encrypted_content"],
      prompt_cache_key: "x",
      client_metadata: { installation_id: "segreto" },
    },
    "openai/gpt-oss-120b",
  );
  expect(chat.messages[0]).toEqual({ role: "system", content: "Regole base" });
  expect(chat.messages[1]).toEqual({ role: "user", content: "Crea a.txt" });
  // Le due chiamate in un solo messaggio dell'assistente.
  expect(chat.messages[2].tool_calls.map((t: any) => t.function.name)).toEqual(["exec_command", "apply_patch"]);
  expect(JSON.parse(chat.messages[2].tool_calls[1].function.arguments)).toEqual({ input: "*** Begin Patch\n*** End Patch\n" });
  expect(chat.messages[3]).toEqual({ role: "tool", tool_call_id: "c1", content: "a.txt" });
  expect(chat.messages[4]).toEqual({ role: "tool", tool_call_id: "c2", content: "Success" });
  expect(chat.messages[5]).toEqual({ role: "user", content: "[istruzioni] Nota a metà" });
  expect(chat.tools.map((t: any) => t.function.name)).toEqual(["exec_command", "apply_patch", "multi__spawn"]);
  expect(chat.tools[1].function.parameters.required).toEqual(["input"]);
  expect([...custom]).toEqual(["apply_patch"]);
  expect(spazi.get("multi__spawn")).toEqual({ namespace: "multi", name: "spawn" });
  // Niente dati di Codex verso il servizio.
  expect(JSON.stringify(chat)).not.toMatch(/installation_id|prompt_cache_key|encrypted_content/);
  expect(chat).toMatchObject({ model: "openai/gpt-oss-120b", stream: true, tool_choice: "auto", parallel_tool_calls: true });
  // Cohere: niente parallel_tool_calls, solo «auto».
  const cohere = richiestaChat({ input: "x", tools: [{ type: "function", name: "f" }], tool_choice: "required", parallel_tool_calls: true }, "m", { senzaParallele: true, soloAuto: true });
  expect(cohere.chat.parallel_tool_calls).toBeUndefined();
  expect(cohere.chat.tool_choice).toBe("auto");
});

it("risposta: testo, chiamate spezzate in pezzi, apply_patch come custom_tool_call, usage", () => {
  const t = new Traduzione("m", new Set(["apply_patch"]), new Map());
  let sse = t.chunk({ choices: [{ index: 0, delta: { content: "Ciao" } }] });
  sse += t.chunk({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "exec_", arguments: '{"cm' } }] } }] });
  sse += t.chunk({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { name: "command", arguments: 'd":"ls"}' } }, { index: 1, id: "call_2", function: { name: "apply_patch", arguments: '{"input":"*** Begin Patch\\n"}' } }] } }] });
  sse += t.chunk({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } });
  sse += t.fine();
  const e = eventi(sse);
  expect(e[0].type).toBe("response.created");
  expect(e.filter((x) => x.type === "response.output_text.delta").map((x) => x.delta)).toEqual(["Ciao"]);
  const fatti = e.filter((x) => x.type === "response.output_item.done").map((x) => x.item);
  expect(fatti[0]).toMatchObject({ type: "message", content: [{ type: "output_text", text: "Ciao" }] });
  expect(fatti[1]).toMatchObject({ type: "function_call", call_id: "call_1", name: "exec_command", arguments: '{"cmd":"ls"}' });
  expect(fatti[2]).toMatchObject({ type: "custom_tool_call", call_id: "call_2", name: "apply_patch", input: "*** Begin Patch\n" });
  expect(e.at(-1)).toMatchObject({ type: "response.completed", response: { usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } } });
  // Numeri di sequenza crescenti.
  expect(e.map((x) => x.sequence_number)).toEqual(e.map((_, i) => i));
  // Troppo lunga: incompleta. Interrotta senza fine: fallita (Codex riprova).
  const lunga = new Traduzione("m", new Set(), new Map());
  lunga.chunk({ choices: [{ index: 0, delta: { content: "x" }, finish_reason: "length" }] });
  expect(eventi(lunga.fine()).at(-1)).toMatchObject({ type: "response.incomplete", response: { incomplete_details: { reason: "max_output_tokens" } } });
  const rotta = new Traduzione("m", new Set(), new Map());
  rotta.chunk({ choices: [{ index: 0, delta: { content: "x" } }] });
  expect(eventi(rotta.fine()).at(-1)).toMatchObject({ type: "response.failed", response: { error: { code: "server_error" } } });
});

it("Gemini 3: la firma del ragionamento di ogni chiamata torna indietro; senza firma vista, il valore che salta il controllo (28 ottobre)", () => {
  const t = new Traduzione("gemini", new Set(), new Map());
  t.chunk({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_g1", extra_content: { google: { thought_signature: "FIRMA-A" } }, function: { name: "exec_command", arguments: '{"cmd":"ls"}' } }] } }] });
  t.chunk({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] });
  t.fine();
  const corpo = {
    input: [
      { type: "message", role: "user", content: [{ type: "input_text", text: "ciao" }] },
      { type: "function_call", call_id: "call_g1", name: "exec_command", arguments: '{"cmd":"ls"}' },
      { type: "function_call_output", call_id: "call_g1", output: "a.txt" },
      { type: "function_call", call_id: "call_vecchia", name: "exec_command", arguments: "{}" },
      { type: "function_call_output", call_id: "call_vecchia", output: "" },
    ],
  };
  const chiamate = (v: any) => richiestaChat(corpo, "gemini", v).chat.messages.filter((m: any) => m.tool_calls).flatMap((m: any) => m.tool_calls);
  const google = chiamate({ firmaGemini: true });
  expect(google[0].extra_content).toEqual({ google: { thought_signature: "FIRMA-A" } });
  expect(google[1].extra_content).toEqual({ google: { thought_signature: "skip_thought_signature_validator" } });
  // Un altro servizio non riceve il valore finto.
  expect(chiamate({})[1].extra_content).toBeUndefined();
});

it("un errore mandato dentro lo stream (Groq, «tool_use_failed») arriva a Codex con il suo motivo, non come «chiuso a metà»", () => {
  const t = new Traduzione("m", new Set(), new Map());
  t.chunk({ choices: [{ index: 0, delta: { content: "x" } }] });
  t.chunk({ error: { message: "Failed to call a function. Please adjust your prompt.", type: "invalid_request_error", code: "tool_use_failed" } });
  expect(t.concluso).toBe(false);
  expect(eventi(t.fine()).at(-1)).toMatchObject({ type: "response.failed", response: { error: { message: "Failed to call a function. Please adjust your prompt." } } });
});

it("l'ultima riga dello stream senza a capo non si perde", async () => {
  const ponte = new Ponte({
    chiave: () => "gsk_finta",
    scarica: (async () =>
      new Response('data: {"choices":[{"index":0,"delta":{"content":"ok"}}]}\n\ndata: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}', { headers: { "content-type": "text/event-stream" } })) as any,
  });
  try {
    await ponte.avvia();
    const r = await fetch(`${ponte.indirizzo("groq")}/responses`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${ponte.gettone}` },
      body: JSON.stringify({ model: "openai/gpt-oss-120b", input: "ciao" }),
    });
    expect(eventi(await r.text()).at(-1).type).toBe("response.completed");
  } finally {
    await ponte.ferma();
  }
});

it("errori: limite al minuto si aspetta, limite del giorno è quota finita, troppo grande e chiave rifiutata si distinguono", () => {
  const h = (x: Record<string, string> = {}) => ({ get: (n: string) => x[n] ?? null });
  const minuto = erroreVersoCodex("Groq", 429, "Rate limit reached for model in organization on tokens per minute (TPM)", h({ "retry-after": "7" }));
  expect(minuto).toMatchObject({ stato: 200, tipo: "sse" });
  expect(eventi(minuto.corpo).at(-1)).toMatchObject({ type: "response.failed", response: { error: { code: "rate_limit_exceeded", message: expect.stringMatching(/Please try again in 7s/) } } });
  const giorno = erroreVersoCodex("Groq", 429, "Rate limit reached on requests per day (RPD)", h());
  expect(giorno.stato).toBe(429);
  // La frase che Continuity riconosce come quota finita (FRASI_QUOTA).
  expect(JSON.parse(giorno.corpo).error).toMatchObject({ type: "usage_limit_reached", message: expect.stringMatching(/You've hit your usage limit/) });
  expect(JSON.parse(erroreVersoCodex("Groq", 413, "Request too large ... tokens per minute (TPM): Limit 8000", h()).corpo).error.code).toBe("request_too_large");
  expect(eventi(erroreVersoCodex("Google", 400, "maximum context length exceeded", h()).corpo).at(-1).response.error.code).toBe("context_length_exceeded");
  expect(erroreVersoCodex("Groq", 401, "Invalid API Key", h()).stato).toBe(401);
  expect(erroreVersoCodex("Groq", 503, "overloaded", h()).stato).toBe(503);
});

it("server: serve il gettone; la chiave vera va solo al servizio; le intestazioni di Codex non passano", async () => {
  const viste: any[] = [];
  const ponte = new Ponte({
    chiave: (id) => (id === "groq" ? "gsk_vera_finta" : undefined),
    scarica: (async (url: any, init: any) => {
      viste.push({ url: String(url), init });
      return new Response('data: {"choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } });
    }) as any,
  });
  try {
    await ponte.avvia();
    const manda = (servizio: string, gettone?: string) =>
      fetch(`${ponte.indirizzo(servizio)}/responses`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-codex-turn-metadata": '{"installation_id":"segreto"}', ...(gettone ? { authorization: `Bearer ${gettone}` } : {}) },
        body: JSON.stringify({ model: "openai/gpt-oss-120b", input: "ciao" }),
      });
    expect((await manda("groq")).status).toBe(401);
    expect((await manda("groq", "sbagliato")).status).toBe(401);
    expect((await manda("inventato", ponte.gettone)).status).toBe(404);
    expect((await manda("google", ponte.gettone)).status).toBe(401);
    const r = await manda("groq", ponte.gettone);
    expect(r.status).toBe(200);
    expect(eventi(await r.text()).at(-1).type).toBe("response.completed");
    expect(viste).toHaveLength(1);
    expect(viste[0].url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(viste[0].init.headers.authorization).toBe("Bearer gsk_vera_finta");
    expect(JSON.stringify(viste[0].init.headers)).not.toMatch(/codex|installation/i);
  } finally {
    await ponte.ferma();
  }
});

it("un modello che non c'è per l'account: il ponte passa al seguente, lo ricorda e lo scarta (NVIDIA, 28 ottobre)", async () => {
  const modelli: string[] = [];
  const scartati: string[] = [];
  const ponte = new Ponte({
    chiave: () => "nvapi-finta",
    candidati: () => ["nvidia/nemotron-super", "deepseek-ai/deepseek-v3", "qwen/qwen3"],
    scarta: (_, m) => scartati.push(m),
    scarica: (async (_url: any, init: any) => {
      const m = JSON.parse(init.body).model;
      modelli.push(m);
      if (m === "nvidia/nemotron-super")
        return new Response(JSON.stringify({ status: 404, title: "Not Found", detail: "Function 'ac74': Not found for account 'J29G'" }), { status: 404 });
      return new Response('data: {"choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } });
    }) as any,
  });
  try {
    await ponte.avvia();
    const manda = () =>
      fetch(`${ponte.indirizzo("nvidia")}/responses`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${ponte.gettone}` },
        body: JSON.stringify({ model: "nvidia/nemotron-super", input: "ciao" }),
      });
    const r = await manda();
    expect(r.status).toBe(200);
    expect(eventi(await r.text()).at(-1).type).toBe("response.completed");
    expect(modelli).toEqual(["nvidia/nemotron-super", "deepseek-ai/deepseek-v3"]);
    expect(scartati).toEqual(["nvidia/nemotron-super"]);
    // La richiesta dopo va diretta al sostituto.
    await (await manda()).text();
    expect(modelli.at(-1)).toBe("deepseek-ai/deepseek-v3");
    expect(modelli).toHaveLength(3);
  } finally {
    await ponte.ferma();
  }
});

it("limite al minuto: il ponte aspetta quanto dice il servizio e riprova da sé, e lo fa sapere; dopo 4 attese lo passa a Codex", async () => {
  const attese: number[] = [];
  const dormite: number[] = [];
  let rifiuti = 2;
  const risposta429 = () =>
    new Response('{"error":{"message":"Rate limit reached for model `openai/gpt-oss-120b` on tokens per minute (TPM): Limit 8000, Used 6100, Requested 5600. Please try again in 27.3s."}}', { status: 429, headers: { "retry-after": "28" } });
  const ponte = new Ponte({
    chiave: () => "gsk_finta",
    attesa: (_, s) => attese.push(s),
    dormi: async (ms) => void dormite.push(ms),
    scarica: (async () =>
      rifiuti-- > 0 ? risposta429() : new Response('data: {"choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } })) as any,
  });
  try {
    await ponte.avvia();
    const manda = () =>
      fetch(`${ponte.indirizzo("groq")}/responses`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${ponte.gettone}` },
        body: JSON.stringify({ model: "openai/gpt-oss-120b", input: "ciao" }),
      });
    const r = await manda();
    expect(eventi(await r.text()).at(-1).type).toBe("response.completed");
    expect(attese).toEqual([28, 28]);
    expect(dormite).toEqual([29_000, 29_000]);
    // Sempre rifiutato: dopo 4 attese Codex riceve il limite al minuto.
    rifiuti = 99;
    const r2 = await manda();
    expect(eventi(await r2.text()).at(-1)).toMatchObject({ type: "response.failed", response: { error: { code: "rate_limit_exceeded" } } });
    expect(attese).toHaveLength(6);
  } finally {
    await ponte.ferma();
  }
});

it("«Reconnecting... 1/3» di Codex non è un errore", () => {
  expect(normalizedLiveEvent("codex", { type: "error", message: "Reconnecting... 1/3 (rate limit exceeded: Groq: limite al minuto. Please try again in 27s.)" })).toEqual({
    type: "reported",
    text: "Riprovo: Groq: limite al minuto. Please try again in 27s.",
  });
});

it("errori in chiaro: il modello mancante, la richiesta troppo grande per Groq, senza JSON né «Codex ha risposto»", () => {
  const h = { get: () => null };
  const nonCe = JSON.parse(erroreVersoCodex("NVIDIA build", 404, JSON.stringify({ status: 404, title: "Not Found", detail: "Function 'x': Not found for account 'y'" }), h, "nvidia/nemotron").corpo).error.message;
  expect(nonCe).toBe("NVIDIA build: il modello nvidia/nemotron non è disponibile per il tuo account. Scegline un altro con /modello.");
  const grande = JSON.parse(erroreVersoCodex("Groq", 413, '{"error":{"message":"Request too large for model `openai/gpt-oss-120b` on tokens per minute (TPM): Limit 8000, Requested 21500"}}', h).corpo).error.message;
  expect(grande).toMatch(/^Groq: anche accorciata.*accetta 8000 token al minuto, questa richiesta ne chiede 21500.*a un'altra AI\.$/);
  expect(grande).not.toMatch(/Codex/);
  // Come lo mostra Continuity: il messaggio del ponte, così com'è.
  const daCodex = `unexpected status 400: ${JSON.stringify({ error: { type: "invalid_request_error", message: nonCe } })}`;
  expect(motivoLeggibile("Codex", daCodex)).toBe(nonCe);
  expect(motivoLeggibile("Codex", "boh")).toMatch(/^Codex ha risposto con un errore: boh/);
});

it("Codex con il ponte: provider del ponte, catalogo, configurazione snella; la chiave vera non è nell'ambiente", () => {
  const groq = providerNoto("groq")!;
  const args = argomentiPonte(groq, { indirizzo: "http://127.0.0.1:1234/groq/v1", catalogo: "/x/catalogo-ponte.json" });
  expect(args.join(" ")).toMatch(/model_provider="continuity_ponte"/);
  expect(args.join(" ")).toMatch(/base_url="http:\/\/127\.0\.0\.1:1234\/groq\/v1", env_key="CONTINUITY_PONTE_TOKEN", wire_api="responses"/);
  expect(args.join(" ")).toMatch(/model_catalog_json="\/x\/catalogo-ponte\.json"/);
  expect(args).toEqual(expect.arrayContaining(["--disable", "multi_agent"]));
  const dati = temp("continuity-dati-");
  const env = ambienteProvider(groq, "gsk_vera_finta", dati, "gettone123");
  expect(env.CONTINUITY_PONTE_TOKEN).toBe("gettone123");
  expect(env.CODEX_HOME).toBe(join(dati, "codex", "groq"));
  expect(JSON.stringify(env)).not.toContain("gsk_vera_finta");
});

// Il turno vero: Codex installato, servizio Groq finto. Si salta senza Codex.
const codexInstallato = (() => {
  // La CLI finta di tests/cli-finte.ts non è Codex vero.
  if (process.env.CONTINUITY_CLI_FINTE?.split(",").includes("codex")) return undefined;
  try {
    return resolveProvider("codex", mkdtempSync(join(tmpdir(), "continuity-risolvi-"))).path;
  } catch {
    return undefined;
  }
})();

it.skipIf(!codexInstallato)("un turno di Groq (finto) attraverso Codex vero e il ponte crea davvero il file", async () => {
  const { openProject } = await import("../src/core/project.js");
  const { Store } = await import("../src/persistence/store.js");
  const { Engine } = await import("../src/core/engine.js");
  const { portachiaviInMemoria } = await import("../src/core/portachiavi.js");
  const root = temp("continuity-ponte-progetto-");
  writeFileSync(join(root, "README.md"), "# prova\n");
  const git = (...a: string[]) => execFileSync("git", ["-c", "user.name=P", "-c", "user.email=p@example.invalid", ...a], { cwd: root, stdio: "ignore" });
  git("init", "-q");
  git("add", "-A");
  git("commit", "-qm", "base");
  const aperto = openProject(root);
  const store = new Store(temp("continuity-dati-"));
  const engine = new Engine(store);
  engine.chiavi = portachiaviInMemoria({ groq: "gsk_vera_finta" });
  const richieste: any[] = [];
  const sse = (chunks: any[]) =>
    new Response(chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
  engine.scaricaGratuiti = (async (url: any, init?: any) => {
    if (String(url).endsWith("/models")) return new Response(JSON.stringify({ data: [{ id: "openai/gpt-oss-120b" }] }));
    const corpo = JSON.parse(init.body);
    richieste.push({ corpo, chiave: init.headers.authorization });
    if (corpo.messages.at(-1).role !== "tool")
      return sse([
        { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_a", function: { name: "apply_patch", arguments: JSON.stringify({ input: "*** Begin Patch\n*** Add File: ciao.txt\n+ciao dal ponte\n*** End Patch\n" }) } }] } }] },
        { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
      ]);
    return sse([{ choices: [{ index: 0, delta: { content: "Ho creato ciao.txt." }, finish_reason: "stop" }], usage: { prompt_tokens: 50, completion_tokens: 5, total_tokens: 55 } }]);
  }) as any;
  try {
    const run = await engine.create(
      "Obiettivo",
      "live",
      "claude",
      { root: aperto.root, head: aperto.head, branch: aperto.branch, verify: aperto.config.verify, commandsDigest: aperto.commandsDigest },
      { providers: ["groq"] },
    );
    // Una sessione già lunga, come quella di Lorenzo del 28 ottobre (17
    // turni): la prima richiesta a Groq superava il suo limite.
    const lunga = engine.run(run.id);
    lunga.transcript = Array.from({ length: 40 }, (_, i) => ({ role: i % 2 ? "ai" : "utente", agent: "nvidia", text: `messaggio ${i} ` + "parole ".repeat(120) }));
    engine.event(lunga, "sequence.changed", "prova");
    await engine.turn(run.id, "Crea il file ciao.txt con dentro «ciao dal ponte»");
    await vi.waitFor(
      () => expect(store.events(run.id).some((e: any) => ["turn.completed", "turn.failed", "turn.blocked"].includes(e.type))).toBe(true),
      { timeout: 90_000, interval: 300 },
    );
    const tipi = store.events(run.id).map((e: any) => `${e.type}: ${String(e.payload?.message ?? "").slice(0, 120)}`);
    if (process.env.CONTINUITY_ANTEPRIMA) console.log(tipi.join("\n"), "\nRICHIESTE", richieste.length, JSON.stringify(richieste.map((r) => ({ ultimi: r.corpo.messages.slice(-2).map((m: any) => [m.role, String(m.content ?? "").slice(0, 200), m.tool_calls?.map((t: any) => t.function.name)]), strumenti: r.corpo.tools?.map((t: any) => t.function.name) })), null, 1));
    expect(tipi.find((t) => /^turn\.(completed|failed|blocked)/.test(t))).toMatch(/^turn\.completed/);
    expect(readFileSync(join(engine.run(run.id).work, "ciao.txt"), "utf8")).toBe("ciao dal ponte\n");
    // Il servizio ha ricevuto la chiave vera, la richiesta è snella.
    expect(richieste[0].chiave).toBe("Bearer gsk_vera_finta");
    expect(JSON.stringify(richieste[0].corpo).length).toBeLessThan(20_000);
    // Ogni richiesta sta nel limite di Groq gratuito, risposta compresa.
    for (const x of richieste) expect(stimaToken(x.corpo) + x.corpo.max_tokens).toBeLessThanOrEqual(7000);
    expect(richieste[0].corpo.tools.map((t: any) => t.function.name)).toContain("apply_patch");
    expect(store.events(run.id).some((e: any) => e.type === "agent.message" && /Ho creato ciao\.txt/.test(e.payload.message))).toBe(true);
    expect(existsSync(join(root, "ciao.txt"))).toBe(false);
  } finally {
    await engine.shutdown();
  }
}, 120_000);
