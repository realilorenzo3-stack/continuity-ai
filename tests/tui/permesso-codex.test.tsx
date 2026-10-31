// Prova di Lorenzo del 31 ottobre: «codex voleva usare app:
// vercel.create_deployment: bloccato finché non lo consenti», e nessun modo
// di consentirlo. Codex non può chiedere a metà turno: lo strumento viene
// bloccato e Continuity deve chiedere a fine turno.
import { it, expect } from "vitest";
import { testRender } from "@opentui/solid";
import { App } from "../../src/tui/app.js";

const aspetta = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const ora = () => new Date().toISOString();

it("Codex bloccato su un'app: a fine turno si chiede se consentirla, e il sì la consente per il turno dopo", async () => {
  const eventi: any[] = [];
  const chiamate: [string, any][] = [];
  let run: any = { id: "x", agent: "codex", state: "PAUSED", session: true, providers: ["codex"], modelli: {} };
  const ev = (type: string, message = "", source = "continuity") =>
    eventi.push({ seq: eventi.length + 1, type, payload: { message }, source, recordedAt: ora() });
  const api = async (p: string, c?: any) => {
    chiamate.push([p, c]);
    if (p.startsWith("/runs/x/events")) {
      const dopo = Number(/afterSeq=(\d+)/.exec(p)?.[1] ?? 0);
      return { events: eventi.filter((e) => e.seq > dopo) };
    }
    if (p === "/runs/x") return run;
    if (p === "/runs/x/live") return { parziale: "", attivita: "" };
    if (p === "/runs/x/turn") {
      ev("user.request", c.text);
      ev("turn.started");
      run = { ...run, state: "RUNNING" };
      setTimeout(() => {
        ev("permission.blocked", "codex voleva usare app: vercel.create_deployment: bloccato finché non lo consenti (a fine turno, o con /permessi)", "codex");
        ev("agent.message", "Il deploy richiede il tuo permesso.", "codex");
        run = { ...run, state: "PAUSED", permessiNegati: ["app: vercel.create_deployment"] };
        ev("turn.completed", "Turno 1 concluso da codex · nessun file modificato");
      }, 300);
      return {};
    }
    return {};
  };
  const t = await testRender(
    () => <App api={api} id="x" cartella="/Users/prova/test1" cartellaDati="/tmp/n" onEsci={() => {}} />,
    { width: 120, height: 36, exitOnCtrlC: false },
  );
  await aspetta(500);
  await t.mockInput.typeText("fai il deploy");
  t.mockInput.pressEnter();
  await aspetta(3000);
  await t.renderOnce();
  const s = t.captureCharFrame();
  if (process.env.CONTINUITY_ANTEPRIMA) console.log(s);
  expect(s).toMatch(/voleva fare un'azione fuori dal progetto/);
  // Anche scrivendo subito, il tasto invio risponde al riquadro.
  t.mockInput.pressEnter();
  await aspetta(500);
  expect(chiamate.filter(([p]) => p === "/runs/x/permessi-turno")).toEqual([["/runs/x/permessi-turno", { consenti: true }]]);
  t.renderer.destroy();
}, 20000);
