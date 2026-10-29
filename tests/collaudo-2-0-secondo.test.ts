// Regressioni del secondo collaudo della 2.0 (25–26 ottobre 2026,
// ~/Desktop/Collaudo_Continuity_2.0_2026-10-25). Ognuna rifà la prova del
// collaudatore; servizi finti, niente rete, segreti inventati.
import { it, expect, afterEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openProject } from "../src/core/project.js";
import { Store } from "../src/persistence/store.js";
import { Engine } from "../src/core/engine.js";
import { portachiaviInMemoria } from "../src/core/portachiavi.js";
import { providerNoto } from "../src/core/provider.js";
import { differenze, NESSUN_SUGGERIMENTO } from "../src/core/revisore.js";
import { chiediModello, ErroreGratuito, primoCheFunziona } from "../src/core/gratuiti.js";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
const git = (cwd: string, ...a: string[]) =>
  execFileSync("git", ["-c", "user.name=Prova", "-c", "user.email=prova@example.invalid", ...a], { cwd, stdio: "ignore" });
const temp = (n: string) => {
  const d = mkdtempSync(join(tmpdir(), n));
  dirs.push(d);
  return d;
};

async function sessione(scarica?: (url: string, init: any) => Promise<Response>) {
  const root = temp("continuity-ct2-");
  const data = temp("continuity-dati-");
  writeFileSync(join(root, "app.js"), "export const a = 1;\n");
  writeFileSync(join(root, ".env.local"), "TOKEN=vecchio\n");
  git(root, "init", "-q");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "base");
  const aperto = openProject(root);
  const db = new Store(data);
  const engine = new Engine(db);
  engine.chiavi = portachiaviInMemoria({ groq: "gsk_finta" });
  const corpi: string[] = [];
  engine.scaricaGratuiti = (async (url: any, init?: any) => {
    if (String(url).endsWith("/models")) return new Response(JSON.stringify({ data: [{ id: "openai/gpt-oss-120b" }, { id: "qwen/qwen3.8-27b" }] }));
    corpi.push(init.body);
    if (scarica) return scarica(String(url), init);
    return new Response(JSON.stringify({ choices: [{ message: { content: NESSUN_SUGGERIMENTO } }] }), { headers: { "content-type": "application/json" } });
  }) as any;
  const run = await engine.create(
    "Obiettivo",
    "simulation",
    "claude",
    { root: aperto.root, head: aperto.head, branch: aperto.branch, verify: aperto.config.verify, commandsDigest: aperto.commandsDigest },
    { providers: ["codex", "claude"] },
  );
  await engine.shutdown();
  return { engine, db, run, corpi };
}
const finite = (engine: Engine) => vi.waitFor(() => expect(engine.revisioniInCorso.size).toBe(0));

it("CT-2.0-101: al revisore non vanno credenziali (anche tracciate) né file raggiunti con un collegamento", async () => {
  const { engine, db, run, corpi } = await sessione();
  try {
    const work = engine.run(run.id).work;
    const fuori = temp("continuity-fuori-");
    writeFileSync(join(fuori, "segreto.txt"), "FAKE_OUTSIDE_SECRET_20261025\n");
    mkdirSync(join(fuori, "cartella"));
    writeFileSync(join(fuori, "cartella", "dentro.txt"), "FAKE_DIR_SECRET_20261025\n");
    writeFileSync(join(work, ".env"), "API_KEY=FAKE_ENV_SECRET_20261025\n");
    writeFileSync(join(work, ".env.local"), "TOKEN=FAKE_TRACKED_SECRET_20261025\n");
    symlinkSync(join(fuori, "segreto.txt"), join(work, "linked.txt"));
    symlinkSync(join(fuori, "cartella"), join(work, "linkdir"));
    writeFileSync(join(work, "app.js"), "export const a = 2;\n");
    const d = differenze(work);
    expect(d.testo).toContain("export const a = 2;");
    for (const segreto of ["FAKE_ENV_SECRET", "FAKE_TRACKED_SECRET", "FAKE_OUTSIDE_SECRET", "FAKE_DIR_SECRET"])
      expect(d.testo).not.toContain(segreto);
    expect(d.esclusi).toEqual(expect.arrayContaining([".env", ".env.local", "linked.txt"]));
    engine.impostaRevisore(run.id, { attivo: true });
    expect(engine.avviaRevisione(run.id, "fine")).toBe("avviata");
    await finite(engine);
    expect(corpi.join("\n")).not.toMatch(/FAKE_(ENV|TRACKED|OUTSIDE|DIR)_SECRET/);
    const avvio = engine.store.events(run.id).find((e: any) => e.type === "review.started");
    expect(avvio.payload.message).toMatch(/non gli mando \d+ file di credenziali o collegamenti/);
  } finally {
    await engine.shutdown();
    db.close();
  }
}, 30000);

it("CT-2.0-102: con una risposta locale, una revisione o un permesso in corso il servizio è occupato", async () => {
  const { engine, db } = await sessione();
  try {
    expect(engine.occupato()).toBe(false);
    engine.locali.set("x", new AbortController());
    expect(engine.occupato()).toBe(true);
    engine.locali.clear();
    engine.revisioniInCorso.set("x", { controllo: new AbortController(), fatta: Promise.resolve() });
    expect(engine.occupato()).toBe(true);
    engine.revisioniInCorso.clear();
    engine.permessiInAttesa.set("p", { run: "x", ai: "claude", strumento: "s", dettaglio: "", risolvi: () => {} });
    expect(engine.occupato()).toBe(true);
    engine.permessiInAttesa.clear();
  } finally {
    await engine.shutdown();
    db.close();
  }
}, 30000);

// Uno stream che manda solo commenti «: ping» e nessuna parola.
function soloPing(ogniMs: number) {
  return (async (_u: any, init?: any) => {
    const stream = new ReadableStream({
      start(c) {
        const t = setInterval(() => c.enqueue(new TextEncoder().encode(": ping\n\n")), ogniMs);
        init?.signal?.addEventListener("abort", () => {
          clearInterval(t);
          c.error(new Error("aborted"));
        });
      },
    });
    return new Response(stream, { headers: { "content-type": "text/event-stream" } });
  }) as any;
}

it("CT-2.0-103: i ping dello stream non allungano l'attesa della prima parola", async () => {
  const inizio = Date.now();
  const e = await chiediModello(
    { provider: providerNoto("groq")!, chiave: "k", modello: "m", messaggi: [{ role: "user", content: "x" }], attesaPrimo: 300, attesaPezzi: 5_000 },
    soloPing(50),
  ).catch((x) => x);
  expect(e).toBeInstanceOf(ErroreGratuito);
  expect(e.tipo).toBe("lento");
  expect(Date.now() - inizio).toBeLessThan(2_000);
});

it("CT-2.0-104: dopo una revisione fallita la stessa fotografia si può rivedere", async () => {
  let fallisci = true;
  const { engine, db, run } = await sessione(async () =>
    fallisci
      ? new Response("errore interno", { status: 500 })
      : new Response(JSON.stringify({ choices: [{ message: { content: "- app.js:1 — a → b" } }] }), { headers: { "content-type": "application/json" } }),
  );
  try {
    engine.impostaRevisore(run.id, { attivo: true });
    writeFileSync(join(engine.run(run.id).work, "app.js"), "export const a = 3;\n");
    engine.avviaRevisione(run.id, "fine");
    await finite(engine);
    expect(engine.store.events(run.id).some((e: any) => e.type === "review.failed")).toBe(true);
    fallisci = false;
    expect(engine.avviaRevisione(run.id, "fine")).toBe("avviata");
    await finite(engine);
    expect(engine.run(run.id).suggerimenti).toHaveLength(1);
    // Riuscita: ora sì che è già vista.
    expect(engine.avviaRevisione(run.id, "fine")).toBe("già vista");
  } finally {
    await engine.shutdown();
    db.close();
  }
}, 30000);

it("CT-2.0-105: una risposta vuota non è un modello che funziona", async () => {
  const scarica = (async (_u: any, init?: any) => {
    const modello = JSON.parse(init.body).model;
    const content = modello === "empty" ? "" : "ok";
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { headers: { "content-type": "application/json" } });
  }) as any;
  const p = providerNoto("groq")!;
  expect(await primoCheFunziona(p, "k", ["empty", "working"], scarica)).toEqual({ modello: "working", saltati: ["empty"] });
  const e = await chiediModello({ provider: p, chiave: "k", modello: "empty", messaggi: [{ role: "user", content: "x" }] }, scarica).catch((x) => x);
  expect(e.tipo).toBe("vuota");
  // Anche uno stream senza testo.
  const vuoto = (async () => new Response("data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } })) as any;
  expect((await chiediModello({ provider: p, chiave: "k", modello: "m", messaggi: [{ role: "user", content: "x" }] }, vuoto).catch((x) => x)).tipo).toBe("vuota");
});

it("CT-2.0-106: con Groq un messaggio troppo lungo si ferma subito, e un 413 del contesto si ritenta più corto", async () => {
  let rifiuta = 1;
  const { engine, db, run, corpi } = await sessione(async (_u, init) => {
    const corpo = JSON.parse(init.body);
    if (corpo.messages?.[0]?.content === "Rispondi solo: ok")
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { headers: { "content-type": "application/json" } });
    if (rifiuta-- > 0) return new Response(JSON.stringify({ error: { message: "Request too large … please reduce your message size" } }), { status: 413 });
    return new Response(JSON.stringify({ choices: [{ message: { content: "Risposta corta" } }] }), { headers: { "content-type": "application/json" } });
  });
  try {
    await engine.impostaRisponde(run.id, "groq", "openai/gpt-oss-120b");
    expect(() => engine.chiediDiretto(run.id, "a".repeat(40_000))).toThrow(/troppo lungo per il piano gratuito di Groq/);
    // Contesto lungo: la conversazione precedente.
    const r = engine.run(run.id);
    r.transcript = Array.from({ length: 12 }, (_, i) => ({ role: i % 2 ? "ai" : "utente", text: "x".repeat(800) }));
    engine.event(r, "engine.warning", "prova");
    engine.chiediDiretto(run.id, "Domanda breve");
    await vi.waitFor(() => expect(engine.locali.size).toBe(0));
    const msg = engine.store.events(run.id).find((e: any) => e.type === "direct.message");
    expect(msg.payload.message).toBe("Risposta corta");
    const domande = corpi.filter((c) => !c.includes("Rispondi solo: ok"));
    expect(domande.length).toBe(2);
    expect(domande[1].length).toBeLessThan(domande[0].length);
  } finally {
    await engine.shutdown();
    db.close();
  }
}, 30000);

it("CT-2.0-107: lo spegnimento ferma il revisore e lo aspetta; dopo non scrive più", async () => {
  let rispondi!: () => void;
  const { engine, db, run } = await sessione(
    (_u, init) =>
      new Promise((ok, ko) => {
        init.signal?.addEventListener("abort", () => ko(new Error("aborted")));
        rispondi = () => ok(new Response(JSON.stringify({ choices: [{ message: { content: "- a → b" } }] }), { headers: { "content-type": "application/json" } }));
      }),
  );
  try {
    engine.impostaRevisore(run.id, { attivo: true });
    writeFileSync(join(engine.run(run.id).work, "app.js"), "export const a = 4;\n");
    engine.avviaRevisione(run.id, "fine");
    await vi.waitFor(() => expect(rispondi).toBeTypeOf("function"));
    const prima = engine.store.events(run.id).length;
    await engine.shutdown();
    expect(engine.revisioniInCorso.size).toBe(0);
    rispondi?.();
    await new Promise((ok) => setTimeout(ok, 100));
    const dopo = engine.store.events(run.id).slice(prima).map((e: any) => e.type);
    expect(dopo).not.toContain("review.completed");
    expect(dopo).not.toContain("review.failed");
  } finally {
    db.close();
  }
}, 30000);

it("CT-2.0-003: i sotto-agenti contano la cache e non il ragionamento due volte; una sessione ripresa conta la differenza", async () => {
  const { FigliCodex } = await import("../src/adapters/codex-figli.js");
  const casa = temp("codexhome-");
  const d = new Date();
  const giorno = join(casa, String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0"));
  mkdirSync(giorno, { recursive: true });
  const conto = (input: number, cached: number, output: number, reasoning: number) =>
    JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output, reasoning_output_tokens: reasoning } } } }) + "\n";
  const meta = JSON.stringify({ type: "session_meta", payload: { source: { subagent: { thread_spawn: { parent_thread_id: "P", agent_path: "/root/a" } } } } }) + "\n";
  writeFileSync(join(giorno, "figlio.jsonl"), meta + conto(60_000, 53_888, 100, 30));
  const f = new FigliCodex(Date.now() - 1000, () => {}, casa);
  f.padre = "P";
  f.scansiona();
  expect(f.consumoFigli()).toMatchObject({ entrata: 6_112, uscita: 100, cache: 53_888, figli: 1 });
});

// Prova di Lorenzo del 26 ottobre: la cartella del progetto svuotata (senza
// .git) e la sessione vecchia che andava avanti con la copia guasta.
it("una sessione con il repository del progetto sparito non continua, e il revisore lo dice", async () => {
  const { engine, db, run } = await sessione();
  try {
    expect(engine.copiaInutilizzabile(engine.run(run.id))).toBeUndefined();
    engine.impostaRevisore(run.id, { attivo: true });
    writeFileSync(join(engine.run(run.id).work, "app.js"), "export const a = 9;\n");
    rmSync(join(engine.run(run.id).project.root, ".git"), { recursive: true, force: true });
    expect(engine.copiaInutilizzabile(engine.run(run.id))).toMatch(/repository Git .* non c'è più/);
    await expect(engine.turn(run.id, "continua")).rejects.toThrow(/Questa sessione non può continuare.*riapri Continuity/);
    expect(engine.avviaRevisione(run.id, "fine")).toBe("modifiche illeggibili");
    expect(engine.store.events(run.id).some((e: any) => e.type === "review.failed" && /non può leggere le modifiche/.test(e.payload.message))).toBe(true);
  } finally {
    await engine.shutdown();
    db.close();
  }
}, 30000);
