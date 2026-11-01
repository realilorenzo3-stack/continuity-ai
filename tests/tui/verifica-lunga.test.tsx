// Collaudo della 2.0.0-beta.18 su Windows (31 ottobre): con una verifica di
// più di un secondo («npm test») l'interfaccia smetteva di seguire il turno
// mentre Continuity verificava, e il lavoro non arrivava nella cartella.
import { it, expect } from "vitest";
import { testRender } from "@opentui/solid";
import { App } from "../../src/tui/app.js";

const aspetta = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

it("un turno con una verifica lunga viene seguito fino alla fine e consegnato", async () => {
  const eventi: any[] = [];
  const chiamate: string[] = [];
  const run: any = { id: "x", agent: "codex", state: "PAUSED", turnNumber: 0, providers: ["codex", "claude"], checks: [] };
  let seq = 0;
  const metti = (type: string, message: string, source = "continuity") =>
    eventi.push({ seq: ++seq, type, payload: { message }, source, recordedAt: new Date().toISOString() });
  const api = async (percorso: string, corpo?: any) => {
    chiamate.push(percorso);
    if (percorso.startsWith("/runs/x/events")) {
      const dopo = Number(/afterSeq=(\d+)/.exec(percorso)?.[1] ?? 0);
      return { events: eventi.filter((e) => e.seq > dopo) };
    }
    if (percorso === "/runs/x/turn") {
      run.state = "RUNNING";
      metti("user.request", corpo.text);
      metti("turn.started", "");
      setTimeout(() => {
        // L'AI ha finito: ora verifica Continuity, per due secondi e mezzo.
        metti("agent.message", "Fatto.", "codex");
        run.state = "VERIFYING";
      }, 300);
      setTimeout(() => {
        metti("verification.completed", "1/1 criteri verificati · test:ok");
        metti("turn.completed", "Turno 1 concluso da codex · 1/1 criteri");
        run.state = "PAUSED";
        run.turnNumber = 1;
      }, 2800);
      return { ok: true };
    }
    if (percorso === "/runs/x/live") return { parziale: "" };
    if (percorso.startsWith("/runs/x/changed")) return { files: ["prezzi.mjs"] };
    if (percorso === "/runs/x/apply") {
      metti("work.applied", "nella tua cartella: prezzi.mjs");
      return { applicati: ["prezzi.mjs"] };
    }
    if (percorso === "/runs/x/github") return { automatica: false };
    if (percorso === "/runs/x") return run;
    return {};
  };
  const { renderer, mockInput, renderOnce, captureCharFrame } = await testRender(
    () => <App api={api} id="x" cartella="/Users/prova/progetto" cartellaDati="/tmp/nessuna" onEsci={() => {}} />,
    { width: 100, height: 44, exitOnCtrlC: false },
  );
  await aspetta(300);
  await mockInput.typeText("Correggi lo sconto");
  mockInput.pressEnter();
  await aspetta(4500);
  await renderOnce();
  expect(chiamate).toContain("/runs/x/apply");
  expect(captureCharFrame()).toMatch(/nella tua cartella: prezzi\.mjs/);
  renderer.destroy();
}, 20000);
