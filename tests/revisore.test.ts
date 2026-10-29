// Fase 2, passo 1: il motore del revisore (CONTINUITY_2.0.md §5.16). Progetto
// Git vero in una cartella temporanea, servizi gratuiti finti: niente rete.
import { it, expect, afterEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openProject } from "../src/core/project.js";
import { Store } from "../src/persistence/store.js";
import { Engine } from "../src/core/engine.js";
import { portachiaviInMemoria } from "../src/core/portachiavi.js";
import { providerNoto } from "../src/core/provider.js";
import {
  differenze,
  leggiSuggerimenti,
  revisorePredefinito,
  sceltaRevisore,
  serveConsenso,
  NESSUN_SUGGERIMENTO,
} from "../src/core/revisore.js";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
const git = (cwd: string, ...a: string[]) =>
  execFileSync("git", ["-c", "user.name=Prova", "-c", "user.email=prova@example.invalid", ...a], { cwd, stdio: "ignore" });

async function sessione(opzioni: { chiavi?: Record<string, string>; risposte?: string[]; sovraccarichi?: string[] } = {}) {
  const root = mkdtempSync(join(tmpdir(), "continuity-revisore-"));
  const data = mkdtempSync(join(tmpdir(), "continuity-dati-"));
  dirs.push(root, data);
  writeFileSync(join(root, "carrello.js"), "export const totale = (righe) => righe.reduce((s, r) => s + r.prezzo, 0);\n");
  git(root, "init", "-q");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "base");
  const aperto = openProject(root);
  const db = new Store(data);
  const engine = new Engine(db);
  engine.chiavi = portachiaviInMemoria(opzioni.chiavi ?? { groq: "gsk_finta" });
  const domande: any[] = [];
  const risposte = opzioni.risposte ?? [];
  engine.scaricaGratuiti = (async (url: any, init?: any) => {
    if (String(url).endsWith("/models"))
      return new Response(JSON.stringify({ data: [{ id: "openai/gpt-oss-120b" }, { id: "qwen/qwen3.8-27b" }] }));
    const corpo = JSON.parse(init.body);
    domande.push(corpo);
    if ((opzioni.sovraccarichi ?? []).includes(corpo.model)) return new Response("high demand", { status: 503 });
    return new Response(JSON.stringify({ choices: [{ message: { content: risposte.shift() ?? NESSUN_SUGGERIMENTO } }] }), {
      headers: { "content-type": "application/json" },
    });
  }) as any;
  const run = await engine.create(
    "Obiettivo",
    "simulation",
    "claude",
    { root: aperto.root, head: aperto.head, branch: aperto.branch, verify: aperto.config.verify, commandsDigest: aperto.commandsDigest },
    { providers: ["codex", "claude"] },
  );
  await engine.shutdown();
  return { engine, db, run, domande };
}
const fine = async (engine: Engine) => vi.waitFor(() => expect((engine as any).revisioniInCorso.size).toBe(0));

it("le differenze: file cambiati e nuovi, con il loro testo; troppe si tagliano e lo si dice", async () => {
  const { engine, db, run } = await sessione();
  try {
    const r = engine.run(run.id);
    writeFileSync(join(r.work, "carrello.js"), "export const totale = (righe) => righe.reduce((s, r) => s + r.prezzo * r.quantita, 0);\n");
    writeFileSync(join(r.work, "spedizione.js"), "export const spese = (t) => (t < 50 ? 4.9 : 0);\n");
    const d = differenze(r.work);
    expect(d.file.sort()).toEqual(["carrello.js", "spedizione.js"]);
    expect(d.testo).toContain("r.prezzo * r.quantita");
    expect(d.testo).toContain("File nuovo: spedizione.js");
    expect(d.troncato).toBe(false);
    const corto = differenze(r.work, 50);
    expect(corto.troncato).toBe(true);
    expect(corto.testo.length).toBeLessThanOrEqual(50);
  } finally {
    await engine.shutdown();
    db.close();
  }
}, 30000);

it("i suggerimenti si leggono dalle righe con il trattino; «nessun suggerimento» è nessuno", () => {
  expect(leggiSuggerimenti("Ecco:\n- carrello.js:1 — manca la quantità → moltiplica\n* spedizione.js:1 — 50 € esatti? → <=\ntesto")).toEqual([
    "carrello.js:1 — manca la quantità → moltiplica",
    "spedizione.js:1 — 50 € esatti? → <=",
  ]);
  expect(leggiSuggerimenti(NESSUN_SUGGERIMENTO)).toEqual([]);
});

it("il revisore di serie è il primo gratuito collegato: prima chi non usa i dati (Groq, Cloudflare), poi gli altri; nessun consenso", () => {
  const config = revisorePredefinito();
  expect(config).toEqual({ attivo: false, ogniTurni: 1, istruzioni: expect.any(String), consensi: [] });
  expect(sceltaRevisore(config, (id) => ["google", "groq"].includes(id))?.id).toBe("groq");
  expect(sceltaRevisore(config, (id) => ["google", "cloudflare"].includes(id))?.id).toBe("cloudflare");
  expect(sceltaRevisore(config, (id) => id === "google")?.id).toBe("google");
  expect(sceltaRevisore(config, () => false)).toBeUndefined();
  // Un servizio tolto da Continuity vale come automatico.
  expect(sceltaRevisore({ ...config, provider: "zen" }, (id) => ["zen", "groq"].includes(id))?.id).toBe("groq");
  expect(serveConsenso(providerNoto("google")!, config)).toBe(false);
});

it("a fine turno il revisore guarda le modifiche e i suggerimenti restano sulla sessione", async () => {
  const { engine, db, run, domande } = await sessione({
    risposte: ["- carrello.js:1 — il totale ignora la quantità → moltiplica per r.quantita"],
  });
  try {
    engine.impostaRevisore(run.id, { attivo: true });
    const r = engine.run(run.id);
    writeFileSync(join(r.work, "carrello.js"), "export const totale = (righe) => righe.length;\n");
    expect(engine.avviaRevisione(run.id, "fine")).toBe("avviata");
    await fine(engine);
    const dopo = engine.run(run.id);
    expect(dopo.suggerimenti).toHaveLength(1);
    expect(dopo.suggerimenti[0]).toMatchObject({
      testo: "carrello.js:1 — il totale ignora la quantità → moltiplica per r.quantita",
      da: "Groq · openai/gpt-oss-120b",
      stato: "nuovo",
      motivo: "fine",
    });
    // Il revisore ha ricevuto le modifiche, non i file interi.
    expect(domande[0].messages[1].content).toContain("righe.length");
    expect(domande[0].messages[0].content).toMatch(/Non modifichi nulla/);
    const tipi = engine.store.events(run.id).map((e: any) => e.type);
    expect(tipi).toEqual(expect.arrayContaining(["review.settings", "review.started", "review.completed"]));
    // Le stesse modifiche non si rivedono due volte.
    expect(engine.avviaRevisione(run.id, "fine")).toBe("già vista");
  } finally {
    await engine.shutdown();
    db.close();
  }
}, 30000);

it("non parte se è spento, se non c'è niente da guardare, o prima del suo turno", async () => {
  const { engine, db, run } = await sessione();
  try {
    expect(engine.avviaRevisione(run.id, "fine")).toBe("spento");
    engine.impostaRevisore(run.id, { attivo: true });
    expect(engine.avviaRevisione(run.id, "fine")).toBe("niente da guardare");
    engine.impostaRevisore(run.id, { ogniTurni: 3 });
    writeFileSync(join(engine.run(run.id).work, "carrello.js"), "z\n");
    expect(engine.avviaRevisione(run.id, "fine")).toBe("fra 2 turni");
    expect(engine.avviaRevisione(run.id, "fine")).toBe("fra 1 turni");
    expect(engine.avviaRevisione(run.id, "fine")).toBe("avviata");
    await fine(engine);
  } finally {
    await engine.shutdown();
    db.close();
  }
}, 30000);

it("con Google il revisore manda le modifiche senza chiedere (28 ottobre: l'avviso è solo al collegamento)", async () => {
  const { engine, db, run } = await sessione({ chiavi: { google: "k" } });
  try {
    engine.impostaRevisore(run.id, { attivo: true, provider: "google" });
    writeFileSync(join(engine.run(run.id).work, "carrello.js"), "x\n");
    expect(engine.avviaRevisione(run.id, "fine")).toBe("avviata");
    await fine(engine);
    expect(engine.store.events(run.id).some((e: any) => e.type === "review.consent_needed")).toBe(false);
  } finally {
    await engine.shutdown();
    db.close();
  }
}, 30000);

it("un modello sovraccarico: il revisore passa al prossimo dello stesso servizio", async () => {
  const { engine, db, run } = await sessione({ sovraccarichi: ["openai/gpt-oss-120b"], risposte: ["- a.js:1 — x → y"] });
  try {
    engine.impostaRevisore(run.id, { attivo: true });
    writeFileSync(join(engine.run(run.id).work, "carrello.js"), "y\n");
    engine.avviaRevisione(run.id, "fine");
    await fine(engine);
    expect(engine.run(run.id).suggerimenti[0].da).toBe("Groq · qwen/qwen3.8-27b");
  } finally {
    await engine.shutdown();
    db.close();
  }
}, 30000);

it("chi rivede si sceglie fra tutte le AI (28 ottobre); un'AI sconosciuta e un numero di turni sbagliato no", async () => {
  const { engine, db, run } = await sessione();
  try {
    expect(engine.impostaRevisore(run.id, { provider: "claude" }).revisore.provider).toBe("claude");
    expect(() => engine.impostaRevisore(run.id, { provider: "inventata" })).toThrow(/Non conosco/);
    expect(() => engine.impostaRevisore(run.id, { ogniTurni: 0 })).toThrow(/Ogni quanti turni/);
    expect(() => engine.impostaRevisore(run.id, { ogniTurni: 11 })).toThrow(/Ogni quanti turni/);
    expect(engine.impostaRevisore(run.id, { ogniTurni: 4 }).revisore.ogniTurni).toBe(4);
    // Le impostazioni salvate prima del 28 ottobre diventano «a ogni turno».
    const r = engine.run(run.id);
    r.revisore = { attivo: true, quando: "entrambi", minuti: 10, istruzioni: "x", consensi: [] };
    expect(engine.configRevisore(r)).toEqual({ attivo: true, ogniTurni: 1, istruzioni: "x", consensi: [] });
  } finally {
    await engine.shutdown();
    db.close();
  }
}, 30000);

it("a fine turno il revisore viene chiamato da solo, con le modifiche di quel turno", async () => {
  const { engine, db, run } = await sessione();
  try {
    engine.impostaRevisore(run.id, { attivo: true });
    const chiamate: any[] = [];
    const vero = engine.avviaRevisione.bind(engine);
    (engine as any).avviaRevisione = (id: string, motivo: any, diff: any) => {
      chiamate.push({ motivo, diff });
      return vero(id, motivo, diff);
    };
    await engine.turn(run.id, "Modifica qualcosa");
    await vi.waitFor(
      () => expect(engine.store.events(run.id).some((e: any) => e.type === "turn.completed")).toBe(true),
      { timeout: 20000 },
    );
    expect(chiamate).toHaveLength(1);
    expect(chiamate[0].motivo).toBe("fine");
    expect(chiamate[0].diff).toHaveProperty("impronta");
    await fine(engine);
  } finally {
    await engine.shutdown();
    db.close();
  }
}, 40000);

// Passo 2: i suggerimenti vanno all'AI del turno dopo, una volta sola, e
// quelli scartati no.
it("i suggerimenti non scartati vanno all'AI del turno dopo, una volta sola", async () => {
  const { engine, db, run } = await sessione({
    risposte: ["- carrello.js:1 — manca la quantità → moltiplica\n- carrello.js:1 — totale vuoto → 0"],
  });
  try {
    engine.impostaRevisore(run.id, { attivo: true });
    writeFileSync(join(engine.run(run.id).work, "carrello.js"), "z\n");
    engine.avviaRevisione(run.id, "fine");
    await fine(engine);
    const [primo, secondo] = engine.run(run.id).suggerimenti;
    engine.segnaSuggerimento(run.id, secondo.id, true);
    await engine.turn(run.id, "Continua");
    const r = engine.run(run.id);
    expect(r.suggerimentiTurno).toEqual([{ testo: primo.testo, da: "Groq · openai/gpt-oss-120b" }]);
    expect(r.suggerimenti.find((x: any) => x.id === primo.id).stato).toBe("inviato");
    expect(r.suggerimenti.find((x: any) => x.id === secondo.id).stato).toBe("scartato");
    expect(engine.store.events(run.id).some((e: any) => e.type === "review.sent" && /1 suggerimento/.test(e.payload.message))).toBe(true);
    expect(() => engine.segnaSuggerimento(run.id, primo.id, true)).toThrow(/già stato passato/);
    await vi.waitFor(() => expect(["PAUSED", "READY"]).toContain(engine.run(run.id).state), { timeout: 20000 });
    await engine.turn(run.id, "Ancora");
    expect(engine.run(run.id).suggerimentiTurno).toEqual([]);
  } finally {
    await engine.shutdown();
    db.close();
  }
}, 60000);

it("le istruzioni dell'AI al lavoro contengono i suggerimenti, da valutare", async () => {
  const { projectPrompt } = await import("../src/adapters/live.js");
  const prompt = projectPrompt({
    role: "writer",
    goal: "g",
    work: "/w",
    criteria: [],
    request: "Fai il carrello",
    suggerimenti: [{ testo: "carrello.js:1 — manca la quantità → moltiplica", da: "Groq · gpt-oss-120b" }],
  } as any);
  expect(prompt).toContain("Il revisore di Continuity");
  expect(prompt).toContain("- carrello.js:1 — manca la quantità → moltiplica (Groq · gpt-oss-120b)");
  expect(prompt).toMatch(/applica quelli giusti, ignora quelli sbagliati/);
  expect(prompt).toMatch(/La richiesta della persona viene prima dei suggerimenti/);
  expect(projectPrompt({ role: "writer", goal: "g", work: "/w", criteria: [] } as any)).not.toContain("Il revisore di Continuity");
});

// Errore del 25 ottobre: Groq gratuito accetta 8.000 token al minuto, il
// revisore ne chiedeva 9.059 (HTTP 413).
it("ogni servizio ha la sua misura: Groq riceve meno modifiche degli altri", async () => {
  const { caratteriPer } = await import("../src/core/revisore.js");
  expect(caratteriPer(providerNoto("groq")!)).toBe(Math.floor((7000 - 1200 - 900) * 2.8));
  expect(caratteriPer(providerNoto("groq")!)).toBeLessThan(15_000);
  expect(caratteriPer(providerNoto("google")!)).toBe(24_000);
});

it("accorciando, ogni file conserva la sua parte: si vedono tutti", async () => {
  const { accorcia } = await import("../src/core/revisore.js");
  const pezzi = [
    { file: "grande.js", testo: "x".repeat(20_000) },
    { file: "piccolo.js", testo: "piccolo\n" },
    { file: "medio.js", testo: "m".repeat(3_000) },
  ];
  const d = accorcia(pezzi, 6_000);
  expect(d.troncato).toBe(true);
  expect(d.testo.length).toBeLessThanOrEqual(6_000);
  expect(d.testo).toContain("piccolo");
  expect(d.testo).toContain("mmmm");
  expect(d.testo).toContain("… (file accorciato)");
  expect(d.file).toEqual(["grande.js", "piccolo.js", "medio.js"]);
  // L'impronta non dipende da quanto si accorcia.
  expect(accorcia(pezzi, 1_000).impronta).toBe(d.impronta);
});

it("una richiesta troppo grande (413): il revisore dimezza le modifiche e riprova da solo", async () => {
  const { engine, db, run, domande } = await sessione({ risposte: ["- grande.js:1 — x → y"] });
  try {
    const vero = engine.scaricaGratuiti;
    engine.scaricaGratuiti = (async (url: any, init?: any) => {
      if (init?.body && JSON.parse(init.body).messages?.[1]?.content?.length > 7_000)
        return new Response(
          JSON.stringify({ error: { message: "Request too large for model `openai/gpt-oss-120b` … Limit 8000, Requested 9059, please reduce your message size" } }),
          { status: 413 },
        );
      return vero(url, init);
    }) as any;
    engine.impostaRevisore(run.id, { attivo: true });
    writeFileSync(join(engine.run(run.id).work, "carrello.js"), "y".repeat(30_000) + "\n");
    engine.avviaRevisione(run.id, "fine");
    await fine(engine);
    const ev = engine.store.events(run.id);
    expect(ev.some((e: any) => e.type === "review.failed")).toBe(false);
    const fatta = ev.find((e: any) => e.type === "review.completed");
    expect(fatta.payload.message).toContain("grande.js:1 — x → y");
    expect(fatta.payload.message).toMatch(/Ha guardato solo una parte delle modifiche/);
    expect(domande.length).toBeGreaterThanOrEqual(1);
  } finally {
    await engine.shutdown();
    db.close();
  }
}, 30000);
