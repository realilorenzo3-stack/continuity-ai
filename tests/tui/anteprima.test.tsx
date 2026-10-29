// Anteprima delle schermate della nuova interfaccia, per guardarle durante il
// lavoro: CONTINUITY_ANTEPRIMA=1 pnpm vitest run tests/tui/anteprima.test.tsx
// Senza la variabile controlla soltanto che si disegnino.
import { it, expect } from "vitest";
import { testRender } from "@opentui/solid";
import { App } from "../../src/tui/app.js";

const aspetta = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const ora = () => new Date().toISOString();

function servizio(eventi: any[], run: any) {
  return async (percorso: string) => {
    if (percorso.startsWith("/runs/x/events")) {
      const dopo = Number(/afterSeq=(\d+)/.exec(percorso)?.[1] ?? 0);
      return { events: eventi.filter((e) => e.seq > dopo) };
    }
    if (percorso === "/runs/x") return run;
    if (percorso === "/runs/x/live") return { parziale: "", attivita: "esegue  npm test" };
    return {};
  };
}

const conversazione = [
  ["user.request", "Crea 5 minigiochi semplici nella cartella, con un menu iniziale"],
  ["turn.started", ""],
  ["attempt.started", "codex reale avviato"],
  ["agent.thinking", "Pianifico la struttura dei giochi"],
  ["agent.message", "Controllo la cartella e poi creo i giochi."],
  ["agent.action", "esegue  ls -la"],
  ["agent.action", "modifica  index.html, giochi.js"],
  ["agent.message", "## Fatto\n\nHo creato **5 giochi**:\n\n| Gioco | File |\n|---|---|\n| Memory | memory.js |\n| Snake | snake.js |"],
  ["usage.reported", "12.400 token in ingresso · 1.900 in uscita"],
  ["verification.completed", "2/2 criteri verificati · test:ok build:ok"],
  ["turn.completed", "Turno 1 concluso da codex · 3 file"],
  ["work.applied", "Nella tua cartella: index.html, giochi.js, stile.css"],
  ["user.request", "Aggiungi i punteggi migliori"],
  ["turn.started", ""],
  ["attempt.started", "codex reale avviato"],
  ["switch.started", "Quota del provider esaurita · passaggio a claude"],
  ["attempt.started", "claude reale avviato"],
  ["agent.message", "Riprendo dal lavoro di Codex e aggiungo i punteggi."],
].map(([type, message], i) => ({ seq: i + 1, type, payload: { message }, source: type.startsWith("agent") ? "codex" : "continuity", recordedAt: ora() }));

const run = {
  id: "x",
  agent: "claude",
  state: "PAUSED",
  providers: ["codex", "claude", "openrouter"],
  modelli: { claude: "opus" },
  esauriti: { codex: { riprendi: new Date(Date.now() + 3 * 3600_000).toISOString() } },
  consumi: { codex: { entrata: 12400, uscita: 1900, cache: 0 } },
  checks: [{ id: "test", label: "Test del progetto", passed: true }, { id: "build", label: "Build", passed: true }],
};

async function schermata(eventi: any[], larghezza: number, altezza: number) {
  const t = await testRender(
    () => <App api={servizio(eventi, run)} id="x" cartella="/Users/prova/Desktop/test1" cartellaDati="/tmp/n" onEsci={() => {}} />,
    { width: larghezza, height: altezza, exitOnCtrlC: false },
  );
  await aspetta(400);
  await t.renderOnce();
  const s = t.captureCharFrame();
  t.renderer.destroy();
  return s;
}

it("anteprima delle schermate", async () => {
  const casa = await schermata([], 120, 36);
  const sessione = await schermata(conversazione, 150, 44);
  const media = await schermata(conversazione, 120, 36);
  const stretta = await schermata(conversazione, 80, 30);
  if (process.env.CONTINUITY_ANTEPRIMA)
    for (const [nome, s] of [["casa 120x36", casa], ["sessione 150x44", sessione], ["sessione 120x36", media], ["sessione 80x30", stretta]])
      console.log(`\n===== ${nome} =====\n${s}`);
  expect(casa).toMatch(/█▀▀ █▀█/);
  expect(sessione).toMatch(/Sequenza delle AI/);
  expect(stretta).not.toMatch(/Sequenza delle AI/);
  expect(media).not.toMatch(/Sequenza delle AI/);
}, 20000);

it("il blocco delle modifiche e l'uscita delle verifiche fallite", async () => {
  const eventi = [
    { seq: 1, type: "user.request", payload: { message: "Correggi" } },
    { seq: 2, type: "attempt.started", payload: { message: "codex reale avviato" } },
    { seq: 3, type: "verification.completed", payload: { message: "0/1 criteri verificati · test:ko" } },
    { seq: 4, type: "turn.completed", payload: { message: "Turno 1 concluso" } },
  ];
  const r = { ...run, checks: [{ id: "test", label: "Test", passed: false, dettaglio: "FAIL somma.test.js\nexpected 3, received -1" }] };
  const t = await testRender(
    () => <App api={servizio(eventi, r)} id="x" cartella="/p" cartellaDati="/tmp/n" onEsci={() => {}} />,
    { width: 100, height: 30, exitOnCtrlC: false },
  );
  await aspetta(400);
  await t.renderOnce();
  const s = t.captureCharFrame();
  expect(s).toMatch(/✗ 0\/1 criteri verificati/);
  expect(s).toMatch(/expected 3, received -1/);
  t.renderer.destroy();
}, 15000);

it("anteprima del menu dei comandi", async () => {
  const t = await testRender(
    () => <App api={servizio(conversazione, run)} id="x" cartella="/Users/prova/test1" cartellaDati="/tmp/n" onEsci={() => {}} />,
    { width: 120, height: 36, exitOnCtrlC: false },
  );
  await aspetta(400);
  t.mockInput.pressKey("p", { ctrl: true });
  await aspetta(150);
  await t.renderOnce();
  const s = t.captureCharFrame();
  if (process.env.CONTINUITY_ANTEPRIMA) console.log(`\n===== menu 120x36 =====\n${s}`);
  // I gruppi del 25 ottobre, il primo è «Le AI».
  expect(s).toMatch(/Le AI/);
  expect(s).toMatch(/Scegli chi risponde\s+\/ai/);
  // /ordine è dentro /flusso («La sequenza») dal 26 ottobre.
  expect(s).toMatch(/Come lavorano le AI\s+\/flusso/);
  expect(s).not.toMatch(/\/ordine/);
  t.renderer.destroy();
}, 15000);

it("anteprima del pannello dell'AI ibrida", async () => {
  const config = {
    attiva: true, modello: "qwen3.5:4b", riserva: true, aComando: true,
    compiti: [
      { id: "chiedi", nome: "Domande veloci", parola: "#chiedi", istruzioni: "x", attivo: true, predefinito: true },
      { id: "spiega", nome: "Spiega un errore o un comando", parola: "#spiega", istruzioni: "x", attivo: false, predefinito: true },
    ],
  };
  const base = servizio([], run);
  const api = async (p: string, c?: any) =>
    p.startsWith("/ibrida") ? { config, ollama: { acceso: false, modelli: [] } } : base(p);
  const t = await testRender(
    () => <App api={api} id="x" cartella="/Users/prova/test1" cartellaDati="/tmp/n" onEsci={() => {}} />,
    { width: 120, height: 36, exitOnCtrlC: false },
  );
  await aspetta(400);
  await t.mockInput.typeText("/ibrida");
  t.mockInput.pressEnter();
  await aspetta(300);
  await t.renderOnce();
  const s = t.captureCharFrame();
  if (process.env.CONTINUITY_ANTEPRIMA) console.log(`\n===== /ibrida 120x36 =====\n${s}`);
  expect(s).toMatch(/AI ibrida/);
  expect(s).toMatch(/Riserva: senza crediti lavora lei\s+sì/);
  expect(s).toMatch(/#spiega/);
  expect(s).toMatch(/Ollama spento/);
  t.renderer.destroy();
}, 15000);

it("pannello dei modelli gratuiti: servizi, modelli e una domanda di prova", async () => {
  const servizi = [
    { id: "cloudflare", nome: "Cloudflare Workers AI (gratuito)", collegato: true, lavoraSuiFile: false },
    { id: "groq", nome: "Groq (gratuito)", collegato: false, lavoraSuiFile: false },
    { id: "openrouter", nome: "Codex · OpenRouter (anche modelli :free)", collegato: true, lavoraSuiFile: true },
  ];
  const chieste: any[] = [];
  const base = servizio([], run);
  const api = async (p: string, c?: any) => {
    if (p === "/gratuiti") return servizi;
    if (p === "/gratuiti/cloudflare/modelli") return [{ id: "@cf/openai/gpt-oss-120b", nome: "GPT OSS 120B" }];
    if (p === "/gratuiti/cloudflare/prova") {
      chieste.push(c);
      return { risposta: "Un test unitario controlla una singola funzione.", millisecondi: 2300 };
    }
    return base(p);
  };
  const t = await testRender(
    () => <App api={api} id="x" cartella="/Users/prova/test1" cartellaDati="/tmp/n" onEsci={() => {}} />,
    { width: 120, height: 36, exitOnCtrlC: false },
  );
  await aspetta(400);
  await t.mockInput.typeText("/gratuiti");
  t.mockInput.pressEnter();
  await aspetta(300);
  await t.renderOnce();
  let s = t.captureCharFrame();
  if (process.env.CONTINUITY_ANTEPRIMA) console.log(`\n===== /gratuiti 120x36 =====\n${s}`);
  expect(s).toMatch(/Modelli gratuiti/);
  expect(s).toMatch(/Collegati/);
  expect(s).toMatch(/Cloudflare Workers AI \(gratuito\)\s+collegato/);
  expect(s.match(/Collegati/g)?.length).toBe(1);
  expect(s).toMatch(/Groq \(gratuito\)\s+collega/);
  // Primo della lista: Cloudflare, collegato → i suoi modelli.
  t.mockInput.pressEnter();
  await aspetta(300);
  await t.renderOnce();
  s = t.captureCharFrame();
  expect(s).toMatch(/1 gratuiti/);
  expect(s).toMatch(/GPT OSS 120B/);
  t.mockInput.pressEnter();
  await aspetta(300);
  await t.mockInput.typeText("Cos'è un test unitario?");
  t.mockInput.pressEnter();
  await aspetta(500);
  await t.renderOnce();
  s = t.captureCharFrame();
  expect(chieste).toEqual([{ modello: "@cf/openai/gpt-oss-120b", domanda: "Cos'è un test unitario?" }]);
  expect(s).toMatch(/Cloudflare Workers AI \(gratuito\) · @cf\/openai\/gpt-oss-120b/);
  expect(s).toMatch(/ha risposto in 2\.3 s/);
  expect(s).toMatch(/Un test unitario controlla una singola funzione/);
  t.renderer.destroy();
}, 15000);

it("durante un turno l'azione fuori dal progetto aspetta il tuo permesso", async () => {
  const risposte: any[] = [];
  const inCorso = { ...run, agent: "claude", state: "RUNNING" };
  const base = servizio([], inCorso);
  const api = async (p: string, c?: any) => {
    if (p === "/runs/x/live")
      return {
        parziale: "",
        attivita: "",
        permesso: risposte.length
          ? null
          : { id: "p1", ai: "claude", strumento: "Vercel: create_deployment", dettaglio: '{"project":"lorenzoreali"}' },
      };
    if (p === "/runs/x/permessi/p1") {
      risposte.push(c);
      return { ok: true };
    }
    return base(p);
  };
  const t = await testRender(
    () => <App api={api} id="x" cartella="/Users/prova/test1" cartellaDati="/tmp/n" onEsci={() => {}} />,
    { width: 120, height: 36, exitOnCtrlC: false },
  );
  await aspetta(1500);
  await t.renderOnce();
  const s = t.captureCharFrame();
  if (process.env.CONTINUITY_ANTEPRIMA) console.log(`\n===== permesso 120x36 =====\n${s}`);
  expect(s).toMatch(/Claude chiede il permesso/);
  expect(s).toMatch(/Vuole usare Vercel: create_deployment/);
  t.mockInput.pressEnter();
  await aspetta(300);
  expect(risposte).toEqual([{ consenti: true }]);
  t.renderer.destroy();
}, 15000);
