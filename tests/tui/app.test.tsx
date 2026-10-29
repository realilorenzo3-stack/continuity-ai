import { it, expect } from "vitest";
import { testRender } from "@opentui/solid";
import { App } from "../../src/tui/app.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Un servizio finto con lo stato di una sessione: alla richiesta di un turno
// produce gli eventi di un turno concluso, come farebbe il motore.
function servizio() {
  const eventi: any[] = [];
  const chiamate: { percorso: string; corpo?: any }[] = [];
  const run: any = {
    id: "x",
    agent: "codex",
    state: "PAUSED",
    turnNumber: 0,
    providers: ["codex", "claude"],
    checks: [{ id: "test", passed: true }],
  };
  let seq = 0;
  const metti = (type: string, message: string, source = "continuity") =>
    eventi.push({ seq: ++seq, type, payload: { message }, source, recordedAt: new Date().toISOString() });
  const api = async (percorso: string, corpo?: any) => {
    chiamate.push({ percorso, corpo });
    if (percorso.startsWith("/runs/x/events")) {
      const dopo = Number(/afterSeq=(\d+)/.exec(percorso)?.[1] ?? 0);
      return { events: eventi.filter((e) => e.seq > dopo) };
    }
    if (percorso === "/runs/x/turn") {
      run.state = "RUNNING";
      metti("user.request", corpo.text);
      metti("turn.started", "");
      metti("attempt.started", "codex reale avviato");
      setTimeout(() => {
        metti("agent.action", "↳ legge cart.mjs", "codex");
        metti(
          "agent.message",
          "**Ho sistemato** il `carrello`.\n\n| File | Esito |\n|---|---|\n| cart.mjs | ok |",
          "codex",
        );
        metti("verification.completed", "1/1 criteri verificati · test:ok");
        metti("turn.completed", "Turno 1 concluso da codex · 1 file");
        run.state = "PAUSED";
        run.turnNumber = 1;
      }, 300);
      return { ok: true };
    }
    if (percorso === "/runs/x/live") return { parziale: "" };
    if (percorso.startsWith("/runs/x/changed")) return { files: ["cart.mjs"] };
    if (percorso === "/runs/x/apply") {
      metti("work.applied", "nella tua cartella: cart.mjs");
      return { applicati: ["cart.mjs"] };
    }
    if (percorso === "/runs/x/github") return { automatica: false };
    if (percorso === "/runs/x") return run;
    return {};
  };
  return { api, chiamate, run };
}

const aspetta = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

it("la nuova interfaccia: si scrive, il turno arriva, i file vengono consegnati", async () => {
  const s = servizio();
  let uscito = false;
  const { renderer, mockInput, renderOnce, captureCharFrame } = await testRender(
    () => (
      <App
        api={s.api}
        id="x"
        cartella="/Users/prova/progetto"
        cartellaDati="/tmp/nessuna"
        onEsci={() => (uscito = true)}
      />
    ),
    { width: 100, height: 44, exitOnCtrlC: false },
  );
  const schermo = async (ms = 50) => {
    await aspetta(ms);
    await renderOnce();
    return captureCharFrame();
  };
  let s1 = await schermo(300);
  // La schermata iniziale: logo, campo con l'AI attiva, sequenza in basso.
  expect(s1).toMatch(/█▀▀ █▀█ █▀▄/);
  // Il modello viene dalla configurazione del CLI della macchina: non lo si fissa.
  expect(s1).toMatch(/Codex( · \S+)? abbonamento ChatGPT/);
  expect(s1).toMatch(/Codex → Claude/);
  expect(s1).toMatch(/Chiedi qualcosa/);
  expect(s1).toMatch(/ctrl\+p comandi/);

  await mockInput.typeText("Sistema il carrello");
  mockInput.pressEnter();
  s1 = await schermo(2500);
  expect(s.chiamate.find((c) => c.percorso === "/runs/x/turn")?.corpo).toEqual({
    text: "Sistema il carrello",
  });
  expect(s1).toMatch(/Sistema il carrello/);
  // La riga di fine turno: «Codex · modello · durata».
  expect(s1).toMatch(/^\s+Codex( · \S+)? · \d+s\s*$/m);
  expect(s1).toMatch(/legge cart\.mjs/);
  // Markdown: i segni spariscono, la tabella diventa una griglia.
  expect(s1).toMatch(/Ho sistemato il carrello\./);
  expect(s1).not.toMatch(/\*\*Ho sistemato/);
  expect(s1).toMatch(/│ cart\.mjs\s*│ ok\s*│/);
  expect(s1).toMatch(/✓ 1\/1 criteri verificati/);
  expect(s.chiamate.some((c) => c.percorso === "/runs/x/apply")).toBe(true);
  expect(s1).toMatch(/nella tua cartella: cart\.mjs/);

  mockInput.pressKey("p", { ctrl: true });
  s1 = await schermo(200);
  expect(s1).toMatch(/Comandi/);
  expect(s1).toMatch(/\/flusso/);
  mockInput.pressEscape();
  s1 = await schermo(200);
  expect(s1).not.toMatch(/Cerca…/);

  // ctrl+c a campo vuoto avvisa; la seconda volta esce, la sessione resta.
  mockInput.pressKey("c", { ctrl: true });
  s1 = await schermo(100);
  expect(s1).toMatch(/Premi di nuovo ctrl\+c per uscire/);
  mockInput.pressKey("c", { ctrl: true });
  await schermo(100);
  expect(uscito).toBe(true);
  renderer.destroy();
});

it("a 50 colonne l'interfaccia resta leggibile", async () => {
  const s = servizio();
  const { renderer, renderOnce, captureCharFrame } = await testRender(
    () => (
      <App api={s.api} id="x" cartella="/Users/prova/un-progetto-dal-nome-lungo" cartellaDati="/tmp/n" onEsci={() => {}} />
    ),
    { width: 50, height: 16 },
  );
  await aspetta(300);
  await renderOnce();
  const s1 = captureCharFrame();
  expect(s1).toMatch(/Chiedi qualcosa/);
  expect(s1).toMatch(/Codex/);
  expect(s1).toMatch(/ctrl\+p comandi/);
  renderer.destroy();
});

it("la barra laterale cambia lingua subito e resta inglese alla riapertura", async () => {
  const dati = mkdtempSync(join(tmpdir(), "continuity-sidebar-"));
  const s = servizio();
  s.run.turnNumber = 1;
  s.run.flusso = "revisione";
  s.run.flussoNome = "Revisione";
  s.run.revisore = { attivo: true, ogniTurni: 1 };
  s.run.controlli = [];
  let ollama = { config: { attiva: true, modello: "qwen3.5:4b", riserva: true, aComando: true, compiti: [] }, ollama: { acceso: true } };
  const api = async (path: string, body?: any) => path === "/ibrida" ? ollama : s.api(path, body);
  try {
    const vista = await testRender(
      () => <App api={api} id="x" cartella="/Users/prova/progetto" cartellaDati={dati} onEsci={() => {}} />,
      { width: 160, height: 44, exitOnCtrlC: false },
    );
    await aspetta(350);
    await vista.mockInput.typeText("Hello");
    vista.mockInput.pressEnter();
    await aspetta(900);
    await vista.renderOnce();
    expect(vista.captureCharFrame()).toContain("Consumo");
    await vista.mockInput.typeText("/language english");
    vista.mockInput.pressEnter();
    await aspetta(5200);
    await vista.renderOnce();
    const schermo = vista.captureCharFrame();
    expect(schermo).toContain("AI sequence");
    expect(schermo).toContain("Usage");
    expect(schermo).toContain("Workflow");
    expect(schermo).toContain("Reviewer");
    expect(schermo).toContain("Hybrid AI");
    expect(schermo).not.toContain("Sequenza delle AI");
    expect(schermo).not.toContain("Consumo");
    expect(schermo).not.toContain("AI ibrida");
    vista.renderer.destroy();
    const riaperta = await testRender(
      () => <App api={api} id="x" cartella="/Users/prova/progetto" cartellaDati={dati} onEsci={() => {}} />,
      { width: 160, height: 44, exitOnCtrlC: false },
    );
    await aspetta(350);
    await riaperta.renderOnce();
    expect(riaperta.captureCharFrame()).toContain("AI sequence");
    expect(riaperta.captureCharFrame()).toContain("Usage");
    riaperta.renderer.destroy();
  } finally {
    rmSync(dati, { recursive: true, force: true });
  }
});

it("un messaggio scritto mentre l'AI lavora va in coda e parte da solo a fine turno", async () => {
  const s = servizio();
  const { renderer, mockInput, renderOnce, captureCharFrame } = await testRender(
    () => <App api={s.api} id="x" cartella="/p" cartellaDati="/tmp/n" onEsci={() => {}} />,
    { width: 100, height: 30, exitOnCtrlC: false },
  );
  await aspetta(300);
  await mockInput.typeText("Primo");
  mockInput.pressEnter();
  await aspetta(100);
  await mockInput.typeText("Secondo");
  mockInput.pressEnter();
  await aspetta(100);
  await renderOnce();
  expect(captureCharFrame()).toMatch(/1 in coda/);
  await aspetta(4000);
  await renderOnce();
  const turni = s.chiamate.filter((c) => c.percorso === "/runs/x/turn").map((c) => c.corpo.text);
  expect(turni).toEqual(["Primo", "Secondo"]);
  expect(captureCharFrame()).not.toMatch(/in coda/);
  renderer.destroy();
}, 20000);
