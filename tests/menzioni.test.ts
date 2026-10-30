// Le AI chiamate con @ nel messaggio (27 ottobre): lettura, flusso al volo,
// e il motore che lo esegue. AI finte, Groq finto.
import { it, expect, afterEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { flussoDaIncarichi, incarichiDalMessaggio, nomeCorto, problemaIncarichi } from "../src/core/menzioni.js";
import { openProject } from "../src/core/project.js";
import { nomeAI } from "../src/core/flussi.js";
import { Store } from "../src/persistence/store.js";
import { Engine } from "../src/core/engine.js";
import { portachiaviInMemoria } from "../src/core/portachiavi.js";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
const temp = (n: string) => {
  const d = mkdtempSync(join(tmpdir(), n));
  dirs.push(d);
  return d;
};

it("l'esempio di Lorenzo: parte comune, Codex lavora, Groq controlla dopo ogni modifica", () => {
  const { comune, incarichi } = incarichiDalMessaggio(
    "Crea un sito web completo.  @codex occupati della gestion del backend. @groq occupati di una revisione totale alla fine di ogni modifica",
  );
  expect(comune).toBe("Crea un sito web completo.");
  expect(incarichi).toEqual([
    { ai: "codex", compito: "occupati della gestion del backend.", tipo: "scrive" },
    { ai: "groq", compito: "occupati di una revisione totale alla fine di ogni modifica", tipo: "legge", quando: "ogni" },
  ]);
});

it("chi lavora e chi controlla, e quando: prima vale ciò che è scritto", () => {
  const leggi = (t: string) => incarichiDalMessaggio(t).incarichi;
  // Un'AI che lavora sui file, chiamata a controllare: controlla.
  expect(leggi("@claude rivedi il codice del carrello")[0]).toMatchObject({ ai: "claude", tipo: "legge", quando: "ogni" });
  expect(leggi("@Claude verifica i test")[0]).toMatchObject({ ai: "claude", tipo: "legge" });
  // Anche i gratuiti fanno il lavoro (28 ottobre): decidono le parole.
  expect(leggi("@google scrivi il frontend")[0]).toMatchObject({ ai: "google", tipo: "scrive" });
  // Quando: «alla fine di tutto» o «alla fine» = una volta; «dopo ogni» = ogni pezzo.
  expect(leggi("@groq fai una revisione alla fine di tutto")[0].quando).toBe("fine");
  expect(leggi("@groq controlla tutto alla fine")[0].quando).toBe("fine");
  expect(leggi("@groq controlla dopo ogni modifica")[0].quando).toBe("ogni");
  expect(leggi("@groq rivedi")[0].quando).toBe("ogni");
  // Anche in inglese, la lingua di serie (28 ottobre).
  expect(leggi("@groq review at the end")[0]).toMatchObject({ tipo: "legge", quando: "fine" });
  expect(leggi("@groq check everything after each change")[0]).toMatchObject({ tipo: "legge", quando: "ogni" });
  expect(leggi("@groq review at the end of every step")[0].quando).toBe("ogni");
  expect(leggi("@codex build the backend")[0].tipo).toBe("scrive");
  // Lo spazio dimenticato dopo il nome (28 ottobre: «@codexaggiungi …»).
  expect(leggi("@codexaggiungi una sezione @google verifica")).toMatchObject([
    { ai: "codex", compito: "aggiungi una sezione", tipo: "scrive" },
    { ai: "google", tipo: "legge" },
  ]);
  expect(leggi("@pippoaggiungi qualcosa")).toEqual([]);
  // La «e» prima della @ seguente non resta nel compito.
  expect(leggi("@groq occupati della revisione e @codex fai l'html").map((x) => x.compito)).toEqual(["occupati della revisione", "fai l'html"]);
  expect(leggi("@groq review it, and then @codex build it")[0].compito).toBe("review it");
  // @qwen è Ollama sul Mac; i nomi alternativi valgono.
  expect(leggi("@qwen scrivi i test")[0]).toMatchObject({ ai: "ollama", tipo: "scrive" });
  expect(leggi("@gemini controlla")[0].ai).toBe("google");
  // Un indirizzo email e un'AI sconosciuta restano testo.
  expect(incarichiDalMessaggio("scrivi a anna@esempio.it e a @pippo")).toEqual({ comune: "scrivi a anna@esempio.it e a @pippo", incarichi: [] });
  // Una @ senza compito: un compito di serie.
  expect(leggi("@codex")[0]).toMatchObject({ compito: "Fai la tua parte del lavoro", tipo: "scrive" });
});

it("il flusso al volo: in ordine; chi controlla dopo ogni pezzo o una volta alla fine", () => {
  const { incarichi } = incarichiDalMessaggio(
    "Sito. @codex il backend @claude il frontend @groq revisione dopo ogni modifica @google controlla la sicurezza alla fine di tutto",
  );
  const { flusso, ruoli, soloUnTurno } = flussoDaIncarichi(incarichi);
  expect(soloUnTurno).toBeUndefined();
  expect(flusso.passi.map((p) => p.ai)).toEqual(["codex", "groq", "claude", "groq", "google"]);
  expect(ruoli.map((r) => [r.tipo, r.esito])).toEqual([
    ["scrive", "lavoro"],
    ["scrive", "lavoro"],
    ["legge", "suggerimenti"],
    ["legge", "suggerimenti"],
  ]);
  // Ognuno sa che cosa fanno gli altri.
  expect(ruoli[0].istruzioni).toMatch(/Il tuo compito in questo lavoro: il backend\..*Claude Code: il frontend.*fai solo la tua/);
  // Una sola AI che lavora: un turno normale.
  expect(flussoDaIncarichi(incarichiDalMessaggio("@claude fai il frontend").incarichi).soloUnTurno?.ai).toBe("claude");
  // Solo chi controlla: risponde con un testo, non ha niente da far correggere.
  const solo = flussoDaIncarichi(incarichiDalMessaggio("@groq rivedi il progetto").incarichi);
  expect(solo.ruoli[0].esito).toBe("testo");
  // Dal 28 ottobre anche i gratuiti fanno il lavoro.
  expect(problemaIncarichi([{ ai: "groq", compito: "x", tipo: "scrive" }])).toBeUndefined();
  expect(["codex", "claude", "groq", "google", "ollama", "openrouter"].map(nomeCorto)).toEqual([
    "Codex", "Claude Code", "Groq", "Google AI Studio", "Qwen sul computer", "OpenRouter",
  ]);
  expect(problemaIncarichi([{ ai: "boh", compito: "x", tipo: "scrive" }])).toMatch(/non conosco/);
  // Il nome dell'AI nei passi del flusso: Qwen non è «Codex» (28 ottobre).
  expect(["ollama", "codex", "claude", "groq"].map(nomeAI)).toEqual(["Qwen sul computer", "Codex", "Claude Code", "Groq (gratuito)"]);
});

async function sessione(risposte = ["- app.js:1 — manca la validazione → aggiungila", "NESSUN SUGGERIMENTO", "NESSUN SUGGERIMENTO"]) {
  const root = temp("continuity-menzioni-");
  writeFileSync(join(root, "app.js"), "export const a = 1;\n");
  const git = (...a: string[]) => execFileSync("git", ["-c", "user.name=P", "-c", "user.email=p@example.invalid", ...a], { cwd: root, stdio: "ignore" });
  git("init", "-q");
  git("add", "-A");
  git("commit", "-qm", "base");
  const aperto = openProject(root);
  const engine = new Engine(new Store(temp("continuity-dati-")));
  engine.chiavi = portachiaviInMemoria({ groq: "gsk_finta" });
  engine.scaricaGratuiti = (async (url: any) => {
    if (String(url).endsWith("/models")) return new Response(JSON.stringify({ data: [{ id: "openai/gpt-oss-120b" }] }));
    return new Response(JSON.stringify({ choices: [{ message: { content: risposte.shift() ?? "NESSUN SUGGERIMENTO" } }] }), { headers: { "content-type": "application/json" } });
  }) as any;
  const run = await engine.create(
    "Obiettivo",
    "simulation",
    "claude",
    { root: aperto.root, head: aperto.head, branch: aperto.branch, verify: aperto.config.verify, commandsDigest: aperto.commandsDigest },
    { providers: ["codex", "claude"] },
  );
  const turni: { testo: string; provider?: string; soloLettura: boolean }[] = [];
  engine.avviaPassoTurno = async (id: string, testo: string, o: { provider?: string; soloLettura: boolean }) => {
    turni.push({ testo, ...o });
    const r = engine.run(id);
    writeFileSync(join(r.work, `${o.provider}-${turni.length}.js`), "x\n");
    engine.event(r, "agent.message", "Fatto.", o.provider ?? "codex");
    setImmediate(() => void engine.dopoTurnoDiFlusso(id, false));
  };
  const eventi = () => engine.store.events(run.id).map((e: any) => ({ tipo: e.type, testo: String(e.payload?.message ?? "") }));
  const domande: string[] = [];
  const scarica = engine.scaricaGratuiti;
  engine.scaricaGratuiti = (async (url: any, init: any) => {
    if (init?.body) domande.push(String(JSON.parse(init.body).messages?.at(-1)?.content ?? ""));
    return scarica(url, init);
  }) as any;
  return { engine, run, turni, eventi, domande };
}

it("nel motore: @codex e @claude lavorano in ordine, @groq controlla ognuno e fa correggere a chi ha appena lavorato", async () => {
  const s = await sessione();
  try {
    await s.engine.turn(s.run.id, "Crea un sito. @codex fai il backend @claude fai il frontend @groq revisione dopo ogni modifica");
    await vi.waitFor(() => expect(s.eventi().some((x) => x.tipo === "flow.completed" || x.tipo === "flow.stopped")).toBe(true), { timeout: 5000 });
    // Codex, la correzione chiesta da Groq (a Codex), poi Claude.
    expect(s.turni.map((t) => t.provider)).toEqual(["codex", "codex", "claude"]);
    expect(s.turni[0].testo).toMatch(/Il tuo compito in questo lavoro: fai il backend/);
    expect(s.turni[0].testo).toMatch(/Richiesta della persona:\nCrea un sito\. @codex/);
    expect(s.turni[1].testo).toMatch(/Correzione, giro 1 di 2[\s\S]*manca la validazione/);
    expect(s.eventi().find((x) => x.tipo === "flow.started")?.testo).toMatch(/Chi fa cosa/);
    expect(s.eventi().at(-1)).toMatchObject({ tipo: "flow.completed" });
    expect(s.eventi().filter((x) => x.tipo === "user.request")).toHaveLength(1);
  } finally {
    await s.engine.shutdown();
  }
});

it("finiti i giri su un pezzo il flusso continua: l'AI dopo lavora e ha i suoi giri; chi rivede non ripete ciò che ha già chiesto", async () => {
  const problema = (n: number) => `- app.js:${n} — problema ${n} → correggilo`;
  const s = await sessione([problema(1), problema(2), problema(3), problema(4), "NESSUN SUGGERIMENTO"]);
  try {
    await s.engine.turn(s.run.id, "Sito. @codex il backend @groq revisione dopo ogni modifica e @claude il frontend");
    await vi.waitFor(() => expect(s.eventi().some((x) => x.tipo === "flow.completed" || x.tipo === "flow.stopped")).toBe(true), { timeout: 8000 });
    // Codex e le sue 2 correzioni, poi Claude (non saltato) e la sua correzione.
    expect(s.turni.map((t) => t.provider)).toEqual(["codex", "codex", "codex", "claude", "claude"]);
    expect(s.turni[3].testo).toMatch(/Il tuo compito in questo lavoro: il frontend/);
    expect(s.turni[4].testo).toMatch(/Correzione, giro 1 di 2[\s\S]*problema 4/);
    expect(s.eventi().some((x) => x.tipo === "flow.correction" && /resta 1 problema.*il flusso continua/.test(x.testo))).toBe(true);
    expect(s.eventi().at(-1)).toMatchObject({ tipo: "flow.completed" });
    // Al secondo giro Groq sa che cosa ha già chiesto; dopo Claude si riparte.
    expect(s.domande[1]).toMatch(/già stati segnalati e corretti[\s\S]*problema 1/);
    expect(s.domande[3]).not.toMatch(/già stati segnalati/);
  } finally {
    await s.engine.shutdown();
  }
});

it("un passo di controllo con un servizio che non risponde passa all'AI dopo nella sequenza, invece di fermare il flusso", async () => {
  const s = await sessione();
  s.engine.scaricaGratuiti = (async (url: any) => {
    if (String(url).endsWith("/models")) return new Response(JSON.stringify({ data: [{ id: "openai/gpt-oss-120b" }] }));
    return new Response("overloaded", { status: 503 });
  }) as any;
  try {
    await s.engine.turn(s.run.id, "@codex fai il backend @groq controlla alla fine");
    await vi.waitFor(() => expect(s.eventi().some((x) => x.tipo === "flow.completed" || x.tipo === "flow.stopped")).toBe(true), { timeout: 8000 });
    expect(s.eventi().some((x) => x.tipo === "switch.started" && /Groq non risponde .*questo passo lo fa Codex/.test(x.testo))).toBe(true);
    // Il controllo lo fa Codex con un turno vero, in sola lettura.
    expect(s.turni.map((t) => [t.provider, t.soloLettura])).toEqual([["codex", false], ["codex", true]]);
    expect(s.eventi().at(-1)).toMatchObject({ tipo: "flow.completed" });
  } finally {
    await s.engine.shutdown();
  }
});

it("chi controlla da solo fa un turno vero in sola lettura, così legge i file del progetto", async () => {
  const s = await sessione();
  try {
    await s.engine.turn(s.run.id, "@groq fai una revisione del lavoro fatto fino ad adesso");
    await vi.waitFor(() => expect(s.eventi().some((x) => x.tipo === "flow.completed" || x.tipo === "flow.stopped")).toBe(true), { timeout: 8000 });
    expect(s.turni.map((t) => [t.provider, t.soloLettura])).toEqual([["groq", true]]);
    expect(s.domande).toHaveLength(0);
  } finally {
    await s.engine.shutdown();
  }
});

it("nel motore: gli incarichi confermati dalla persona valgono più del testo", async () => {
  const s = await sessione();
  try {
    await s.engine.turn(s.run.id, "@codex fai tutto @groq rivedi", {
      incarichi: [
        { ai: "claude", compito: "fai tutto", tipo: "scrive" },
        { ai: "groq", compito: "rivedi", tipo: "legge", quando: "fine" },
      ],
    });
    await vi.waitFor(() => expect(s.eventi().some((x) => x.tipo === "flow.completed" || x.tipo === "flow.stopped")).toBe(true), { timeout: 5000 });
    expect(s.turni[0].provider).toBe("claude");
    await expect(s.engine.turn(s.run.id, "x", { incarichi: [{ ai: "inventata", compito: "x", tipo: "scrive" }] })).rejects.toThrow(/Chi fa cosa: non conosco @inventata/);
  } finally {
    await s.engine.shutdown();
  }
});

it("nel motore: una sola @ che lavora è un turno normale con quell'AI", async () => {
  const s = await sessione();
  try {
    const r = await s.engine.turn(s.run.id, "@codex aggiungi un titolo");
    expect(r.esecuzione).toBeUndefined();
    expect(r.agent).toBe("codex");
    expect(s.turni).toHaveLength(0);
    await vi.waitFor(() => expect(s.eventi().some((x) => x.tipo === "turn.completed")).toBe(true), { timeout: 8000 });
  } finally {
    await s.engine.shutdown();
  }
});

it("chi risponde rimasto su un servizio tolto: torna la sequenza e lo si dice", async () => {
  const s = await sessione();
  try {
    const r = s.engine.run(s.run.id);
    r.risponde = { provider: "zen", modello: "big-pickle" };
    s.engine.event(r, "responder.changed", "prova");
    expect(() => s.engine.chiediDiretto(s.run.id, "ciao")).toThrow(/zen non è più disponibile/);
    expect(s.engine.run(s.run.id).risponde).toBeUndefined();
  } finally {
    await s.engine.shutdown();
  }
});
