// Regressioni del quarto collaudo della 2.0 (26–27 ottobre 2026,
// ~/Desktop/Collaudo_4_Continuity_2.0/rapporto_codex). Ognuna rifà la prova
// del collaudatore; servizi finti, niente rete.
import { it, expect, afterEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openProject } from "../src/core/project.js";
import { Store } from "../src/persistence/store.js";
import { Engine } from "../src/core/engine.js";
import { portachiaviInMemoria } from "../src/core/portachiavi.js";
import { aCapo } from "../src/tui/acapo.js";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
const temp = (n: string) => {
  const d = mkdtempSync(join(tmpdir(), n));
  dirs.push(d);
  return d;
};

// Un servizio gratuito che trattiene le risposte finché la prova non le libera.
async function sessione() {
  const root = temp("continuity-ct4-");
  writeFileSync(join(root, "a.js"), "export const a = 1;\n");
  const git = (...a: string[]) => execFileSync("git", ["-c", "user.name=P", "-c", "user.email=p@example.invalid", ...a], { cwd: root, stdio: "ignore" });
  git("init", "-q");
  git("add", "-A");
  git("commit", "-qm", "base");
  const aperto = openProject(root);
  const store = new Store(temp("continuity-dati-"));
  const engine = new Engine(store);
  engine.chiavi = portachiaviInMemoria({ groq: "gsk_finta" });
  const trattenute: ((testo: string) => void)[] = [];
  engine.scaricaGratuiti = (async (url: any, init?: any) => {
    if (String(url).endsWith("/models")) return new Response(JSON.stringify({ data: [{ id: "openai/gpt-oss-120b" }] }));
    return new Promise((ok, no) => {
      init.signal?.addEventListener("abort", () => no(new Error("annullata")));
      trattenute.push((testo) =>
        ok(new Response(JSON.stringify({ choices: [{ message: { content: testo } }] }), { headers: { "content-type": "application/json" } })),
      );
    });
  }) as any;
  const run = await engine.create(
    "Obiettivo",
    "simulation",
    "claude",
    { root: aperto.root, head: aperto.head, branch: aperto.branch, verify: aperto.config.verify, commandsDigest: aperto.commandsDigest },
    { providers: ["codex", "claude"] },
  );
  return { engine, store, run, trattenute };
}

it("CT-2.0-301: un controllo tolto mentre rivede non porta più suggerimenti", async () => {
  const { engine, run, trattenute } = await sessione();
  try {
    const chiave = engine.aggiungiControllo(run.id, "Security audit", "Controlla la sicurezza").controlli[0].id;
    engine.impostaRevisore(run.id, { attivo: true }, chiave);
    writeFileSync(join(engine.run(run.id).work, "a.js"), "export const a = eval('2');\n");
    expect(engine.avviaRevisione(run.id, "fine", undefined, chiave)).toBe("avviata");
    await vi.waitFor(() => expect(trattenute).toHaveLength(1));
    engine.impostaRevisore(run.id, { togli: true }, chiave);
    // La risposta arriva lo stesso (la richiesta era partita): non conta.
    trattenute[0]("- a:1 REMOVED_CONTROL_LATE → togli eval");
    await vi.waitFor(() => expect(engine.revisioniInCorso.size).toBe(0));
    await new Promise((ok) => setTimeout(ok, 50));
    expect(engine.run(run.id).suggerimenti ?? []).toEqual([]);
    expect(JSON.stringify(engine.store.events(run.id))).not.toContain("REMOVED_CONTROL_LATE");
  } finally {
    await engine.shutdown();
  }
});

it("CT-2.0-302: un piano lungo si divide in righe intere, senza perdere la fine", () => {
  const piano = Array.from({ length: 80 }, (_, i) => `${i + 1}. Passo numero ${i + 1} con un testo abbastanza lungo da andare a capo nel riquadro`).join("\n") + "\nFINAL_MARKER_80";
  const righe = aCapo(piano, 52);
  expect(righe.every((r) => r.length <= 52)).toBe(true);
  expect(righe.at(-1)).toBe("FINAL_MARKER_80");
  expect(righe.join(" ").replace(/\s+/g, " ")).toBe(piano.replace(/\s+/g, " "));
  // Una parola più lunga della riga si spezza, non si perde.
  expect(aCapo("x".repeat(120), 52)).toEqual(["x".repeat(52), "x".repeat(52), "x".repeat(16)]);
});

it("CT-2.0-303: spento durante la domanda a un gratuito, il flusso si chiude e la sessione accetta messaggi", async () => {
  const { engine, run, trattenute } = await sessione();
  engine.avviaPassoTurno = async (id: string) => {
    const r = engine.run(id);
    writeFileSync(join(r.work, "a.js"), "export const a = 3;\n");
    engine.event(r, "agent.message", "Fatto.", "codex");
    setImmediate(() => void engine.dopoTurnoDiFlusso(id, false));
  };
  engine.impostaFlusso(run.id, "revisione");
  await engine.turn(run.id, "cambia a");
  await vi.waitFor(() => expect(trattenute).toHaveLength(1));
  await engine.shutdown();
  expect(engine.run(run.id).esecuzione).toBeUndefined();
  const ultimo = engine.store.events(run.id).at(-1);
  expect(ultimo).toMatchObject({ type: "flow.stopped" });
  expect(ultimo.payload.message).toMatch(/servizio si è spento durante il passo/);
});

it("CT-2.0-303: un flusso rimasto a metà da un servizio caduto si chiude all'avvio; il piano in attesa no", async () => {
  const { engine, store, run, trattenute } = await sessione();
  engine.avviaPassoTurno = async (id: string) => {
    const r = engine.run(id);
    writeFileSync(join(r.work, "a.js"), "export const a = 4;\n");
    engine.event(r, "agent.message", "Fatto.", "codex");
    setImmediate(() => void engine.dopoTurnoDiFlusso(id, false));
  };
  try {
    engine.impostaFlusso(run.id, "revisione");
  await engine.turn(run.id, "cambia a");
    await vi.waitFor(() => expect(trattenute).toHaveLength(1));
    // Il servizio «cade»: un motore nuovo sugli stessi dati, senza spegnimento.
    const dopo = new Engine(store);
    expect(dopo.riconciliaFlussi()).toEqual([run.id]);
    expect(dopo.run(run.id).esecuzione).toBeUndefined();
    expect(dopo.store.events(run.id).at(-1).payload.message).toMatch(/servizio si è fermato a metà flusso/);
    // Un piano che aspetta il sì resta: la persona può ancora rispondere.
    const r = dopo.run(run.id);
    r.esecuzione = { flusso: { nome: "Completo", passi: [{ ruolo: "pianifica", ai: "sequenza" }], giri: 0 }, ruoli: [], richiesta: "x", passo: 0, giro: 0, uscite: [], attesa: "piano", piano: "1. x" };
    dopo.event(r, "flow.plan_ready", "1. x");
    expect(dopo.riconciliaFlussi()).toEqual([]);
    expect(dopo.run(run.id).esecuzione?.attesa).toBe("piano");
  } finally {
    await engine.shutdown();
  }
});

// Ricollaudo del 27–28 ottobre (~/Desktop/Collaudo_5_Continuity_2.0).
it("CT-2.0-401: servizio caduto mentre un'AI lavora in un flusso: al riavvio il processo rimasto si ferma e la sessione accetta messaggi", async () => {
  const { spawn } = await import("node:child_process");
  const { engine, store, run } = await sessione();
  // Node invece di sleep: c'è su ogni sistema, anche su Windows.
  const orfano = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { detached: true, stdio: "ignore" });
  orfano.unref();
  const vivo = () => {
    try {
      process.kill(orfano.pid!, 0);
      return true;
    } catch {
      return false;
    }
  };
  let dopo: Engine | undefined;
  try {
    engine.impostaFlusso(run.id, "revisione");
    const r = engine.run(run.id);
    // Un flusso al passo «Scrive», con l'AI al lavoro (la sua ricevuta).
    r.esecuzione = {
      flusso: { id: "revisione", nome: "Lavora e ricontrolla", passi: [{ ruolo: "scrive", ai: "sequenza" }, { ruolo: "rivede", ai: "gratuito" }], giri: 2 },
      ruoli: [],
      richiesta: "x",
      passo: 0,
      giro: 0,
      uscite: [],
    };
    r.attemptId = "orfano";
    writeFileSync(join(r.dir, "attempt-orfano.json"), JSON.stringify({ pid: orfano.pid, binary: process.execPath, status: "spawned" }));
    r.pid = orfano.pid;
    r.state = "STARTING";
    engine.event(r, "audit.setup", "avvio");
    r.state = "RUNNING";
    engine.event(r, "audit.setup", "al lavoro");
    await engine.shutdown().catch(() => {});
    // Il servizio riparte (prima: flusso chiuso, ma BLOCKED, orfano vivo, 409).
    dopo = new Engine(store);
    expect(dopo.run(run.id).state).toBe("BLOCKED");
    expect(dopo.riconciliaFlussi()).toEqual([run.id]);
    await vi.waitFor(() => expect(vivo()).toBe(false), { timeout: 8000 });
    await vi.waitFor(() => expect(dopo!.run(run.id).state).toBe("PAUSED"));
    const tipi = store.eventiRecenti(run.id, 20).map((e: any) => e.type);
    expect(tipi).toEqual(expect.arrayContaining(["flow.stopped", "recovery.orphan_stopped", "recovery.completed"]));
    // Un messaggio nuovo parte (con il flusso in uso).
    dopo.avviaPassoTurno = async () => {};
    const r2 = await dopo.turn(run.id, "riprova");
    expect(r2.esecuzione?.flusso.id).toBe("revisione");
  } finally {
    try {
      process.kill(-orfano.pid!, "SIGKILL");
    } catch {}
    await dopo?.shutdown().catch(() => {});
  }
}, 30000);

it("CT-2.0-401: anche senza il riavvio, un messaggio su una sessione bloccata la recupera e fa partire il flusso", async () => {
  const { engine, store, run } = await sessione();
  try {
    engine.impostaFlusso(run.id, "revisione");
    const r = engine.run(run.id);
    r.state = "STARTING";
    engine.event(r, "audit.setup", "avvio");
    r.state = "RUNNING";
    engine.event(r, "audit.setup", "al lavoro");
    await engine.shutdown().catch(() => {});
    const dopo = new Engine(store);
    expect(dopo.run(run.id).state).toBe("BLOCKED");
    dopo.avviaPassoTurno = async () => {};
    const r2 = await dopo.turn(run.id, "riprova");
    expect(r2.esecuzione?.flusso.id).toBe("revisione");
    expect(store.eventiRecenti(run.id, 10).map((e: any) => e.type)).toContain("recovery.completed");
    await dopo.shutdown();
  } finally {
    await engine.shutdown().catch(() => {});
  }
});
