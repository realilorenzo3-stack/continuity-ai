// Chi risponde (prova di Lorenzo del 25 ottobre: «ho scelto groq, ha risposto
// una volta, poi ha risposto codex»). Con /ai un modello gratuito resta scelto
// finché non se ne sceglie un altro; il modello consigliato si sceglie da sé;
// le richieste sui file lo dicono. Servizi finti, niente rete.
import { it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openProject } from "../src/core/project.js";
import { Store } from "../src/persistence/store.js";
import { Engine, modelloConsigliato, SEGNO_FILE } from "../src/core/engine.js";
import { portachiaviInMemoria } from "../src/core/portachiavi.js";
import { providerNoto } from "../src/core/provider.js";
import { COMANDI_TUI } from "../src/tui/comandi.js";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

// «sovraccarichi»: modelli che rispondono 503, come Google il 25 ottobre.
async function sessione(risposte: string[], sovraccarichi: string[] = []) {
  const root = mkdtempSync(join(tmpdir(), "continuity-risponde-"));
  const data = mkdtempSync(join(tmpdir(), "continuity-dati-"));
  dirs.push(root, data);
  writeFileSync(join(root, "index.html"), "<h1>ciao</h1>\n");
  const aperto = openProject(root);
  const db = new Store(data);
  const engine = new Engine(db);
  engine.chiavi = portachiaviInMemoria({ groq: "gsk_finta" });
  const chiamate: any[] = [];
  engine.scaricaGratuiti = (async (url: any, init?: any) => {
    chiamate.push({ url: String(url), corpo: init?.body ? JSON.parse(init.body) : undefined });
    if (String(url).endsWith("/models"))
      return new Response(JSON.stringify({ data: [{ id: "qwen/qwen3.8-27b" }, { id: "openai/gpt-oss-120b" }, { id: "whisper-large-v3" }] }));
    const corpo = init?.body ? JSON.parse(init.body) : {};
    if (sovraccarichi.includes(corpo.model))
      return new Response(JSON.stringify({ error: { code: 503, message: "This model is currently experiencing high demand." } }), { status: 503 });
    // La domanda minima con cui si sceglie un modello che risponde.
    if (corpo.messages?.[0]?.content === "Rispondi solo: ok")
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify({ choices: [{ message: { content: risposte.shift() ?? "" } }] }), {
      headers: { "content-type": "application/json" },
    });
  }) as any;
  const run = await engine.create(
    "Obiettivo",
    "simulation",
    "claude",
    { root: aperto.root, head: aperto.head, branch: aperto.branch, verify: aperto.config.verify, commandsDigest: aperto.commandsDigest, senzaGit: true },
    { providers: ["codex", "claude"] },
  );
  await engine.shutdown();
  return { engine, db, run, chiamate };
}

it("il modello consigliato si sceglie da solo", () => {
  expect(modelloConsigliato(providerNoto("groq")!, ["qwen/qwen3.8-27b", "openai/gpt-oss-120b"])).toBe("openai/gpt-oss-120b");
  expect(modelloConsigliato(providerNoto("google")!, ["gemini-2.5-flash", "gemini-3.8-flash", "gemini-3.6-flash"])).toBe("gemini-3.6-flash");
  expect(modelloConsigliato({}, ["a", "b"])).toBe("a");
});

it("scelto Groq, risponde Groq a ogni messaggio finché non si torna alla sequenza", async () => {
  const { engine, db, run, chiamate } = await sessione(["Prima risposta", "Seconda risposta"]);
  try {
    const r = await engine.impostaRisponde(run.id, "groq");
    expect(r.risponde).toEqual({ provider: "groq", modello: "openai/gpt-oss-120b" });
    for (const domanda of ["Che cos'è questo progetto?", "E il file index.html?"]) {
      engine.chiediDiretto(run.id, domanda);
      await vi.waitFor(() => expect(engine.locali.size).toBe(0));
    }
    const tipi = engine.store.events(run.id).map((e: any) => [e.type, e.payload?.message]);
    expect(tipi.filter(([t]: any) => t === "direct.message").map(([, m]: any) => m)).toEqual(["Prima risposta", "Seconda risposta"]);
    // Due domande, due risposte di Groq: nessun turno di Codex.
    expect(tipi.some(([t]: any) => t === "turn.started")).toBe(false);
    const domande = chiamate.filter(
      (c) => c.url.endsWith("/chat/completions") && c.corpo.messages[0].content !== "Rispondi solo: ok",
    );
    expect(domande).toHaveLength(2);
    expect(domande[1].corpo.model).toBe("openai/gpt-oss-120b");
    // Il contesto: i nomi dei file e la conversazione precedente.
    expect(domande[1].corpo.messages[0].content).toContain("index.html");
    expect(domande[1].corpo.messages[0].content).toContain("Prima risposta");
    // Si torna alla sequenza.
    expect((await engine.impostaRisponde(run.id, null)).risponde).toBeUndefined();
    expect(() => engine.chiediDiretto(run.id, "x")).toThrow(/Nessun modello scelto/);
  } finally {
    await engine.shutdown();
    db.close();
  }
}, 30000);

it("una richiesta che cambia i file: la risposta lo dice e la conversazione lo segna", async () => {
  const { engine, db, run } = await sessione([`${SEGNO_FILE}\nServe modificare index.html per aggiungere il titolo.`]);
  try {
    await engine.impostaRisponde(run.id, "groq", "openai/gpt-oss-120b");
    engine.chiediDiretto(run.id, "Aggiungi un titolo alla pagina");
    await vi.waitFor(() => expect(engine.locali.size).toBe(0));
    const ev = engine.store.events(run.id);
    const msg = ev.find((e: any) => e.type === "direct.message");
    expect(msg.payload.message).toBe("Serve modificare index.html per aggiungere il titolo.");
    expect(ev.find((e: any) => e.type === "direct.files").payload.message).toBe("Aggiungi un titolo alla pagina");
  } finally {
    await engine.shutdown();
    db.close();
  }
}, 30000);

it("un servizio che lavora sui file non si sceglie come «risponde soltanto», uno non collegato nemmeno", async () => {
  const { engine, db, run } = await sessione([]);
  try {
    await expect(engine.impostaRisponde(run.id, "claude")).rejects.toThrow(/lavora sui file/);
    await expect(engine.impostaRisponde(run.id, "google")).rejects.toThrow(/^Google AI Studio · Gemini non è collegato: collegalo con \/collega google$/);
  } finally {
    await engine.shutdown();
    db.close();
  }
}, 30000);

it("i comandi sono in quattro gruppi, nell'ordine deciso con Lorenzo", () => {
  const gruppi = [...new Set(COMANDI_TUI.map((c) => c.gruppo))];
  expect(gruppi).toEqual(["Le AI", "Il lavoro", "La sessione", "Altro"]);
  expect(COMANDI_TUI.map((c) => c.nome)).toEqual([
    "/ai", "/collega", "/modello", "/ibrida", "/revisore", "/flusso", "/connettori",
    "/allega", "/file", "/applica", "/annulla", "/pubblica",
    "/stato", "/chiudi", "/esci",
    "/tema", "/linguaggio", "/configura", "/aiuto",
  ]);
});

it("si sceglie solo un modello che risponde: il sovraccarico si salta e lo si dice", async () => {
  const { engine, db, run } = await sessione([], ["openai/gpt-oss-120b"]);
  try {
    const r = await engine.impostaRisponde(run.id, "groq");
    expect(r.risponde.modello).toBe("qwen/qwen3.8-27b");
    const ev = engine.store.events(run.id).filter((e: any) => e.type === "responder.changed");
    expect(ev.at(-1).payload.message).toMatch(/openai\/gpt-oss-120b non rispondevano/);
  } finally {
    await engine.shutdown();
    db.close();
  }
}, 30000);

it("a metà conversazione un modello sovraccarico passa al prossimo, e resta quello", async () => {
  const sovraccarichi: string[] = [];
  const { engine, db, run } = await sessione(["Risposta dal secondo"], sovraccarichi);
  try {
    await engine.impostaRisponde(run.id, "groq");
    sovraccarichi.push("openai/gpt-oss-120b");
    engine.chiediDiretto(run.id, "Ciao");
    await vi.waitFor(() => expect(engine.locali.size).toBe(0));
    const ev = engine.store.events(run.id);
    expect(ev.find((e: any) => e.type === "direct.message").payload.message).toBe("Risposta dal secondo");
    expect(ev.find((e: any) => e.type === "direct.message").source).toBe("Groq · qwen/qwen3.8-27b");
    expect(engine.run(run.id).risponde.modello).toBe("qwen/qwen3.8-27b");
  } finally {
    await engine.shutdown();
    db.close();
  }
}, 30000);

it("un servizio che non risponde scade e dice l'errore vero; «interrotta» solo se la fermi tu", async () => {
  const { chiediModello, ErroreGratuito } = await import("../src/core/gratuiti.js");
  const muto = (async (_u: any, init?: any) =>
    new Promise((_ok, ko) => init?.signal?.addEventListener("abort", () => ko(new Error("aborted"))))) as any;
  const p = providerNoto("google")!;
  const e1 = await chiediModello(
    { provider: p, chiave: "k", modello: "gemini-3.8-flash", messaggi: [{ role: "user", content: "x" }], attesaPrimo: 100 },
    muto,
  ).catch((e) => e);
  expect(e1).toBeInstanceOf(ErroreGratuito);
  expect(e1.tipo).toBe("lento");
  expect(e1.message).toMatch(/gemini-3\.8-flash non risponde/);
  const fermo = new AbortController();
  setTimeout(() => fermo.abort(), 50);
  const e2 = await chiediModello(
    { provider: p, chiave: "k", modello: "m", messaggi: [{ role: "user", content: "x" }], segnale: fermo.signal },
    muto,
  ).catch((e) => e);
  expect(e2.tipo).toBe("interrotta");
});
