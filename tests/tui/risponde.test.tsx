// La prova di Lorenzo del 25 ottobre, rifatta: /ai → Groq, due domande, e
// rispondono tutte e due Groq (prima la seconda andava a Codex). In basso
// resta scritto Groq. Servizio finto.
import { it, expect } from "vitest";
import { testRender } from "@opentui/solid";
import { App } from "../../src/tui/app.js";

const aspetta = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const ora = () => new Date().toISOString();

it("scelto Groq con /ai, Groq diventa l'AI che lavora: i messaggi vanno al suo turno (28 ottobre: tutte sullo stesso piano)", async () => {
  const run: any = { id: "x", agent: "codex", state: "PAUSED", providers: ["codex", "claude"] };
  const chiamate: { p: string; c?: any }[] = [];
  const api = async (p: string, c?: any) => {
    chiamate.push({ p, c });
    if (p.startsWith("/runs/x/events")) return { events: [] };
    if (p === "/runs/x") return run;
    if (p === "/gratuiti") return [{ id: "groq", nome: "Groq (gratuito)", collegato: true, lavoraSuiFile: false }];
    if (p === "/runs/x/providers") {
      run.providers = [c.richiesta, ...run.providers.filter((x: string) => x !== c.richiesta)];
      run.agent = c.richiesta;
      return run;
    }
    if (p === "/runs/x/diretto") throw Error("non doveva rispondere soltanto");
    if (p === "/runs/x/turn") return run;
    return {};
  };
  const t = await testRender(
    () => <App api={api} id="x" cartella="/Users/prova/test1" cartellaDati="/tmp/n" onEsci={() => {}} />,
    { width: 120, height: 36, exitOnCtrlC: false },
  );
  await aspetta(400);
  await t.mockInput.typeText("/ai");
  t.mockInput.pressEnter();
  await aspetta(300);
  await t.renderOnce();
  let s = t.captureCharFrame();
  if (process.env.CONTINUITY_ANTEPRIMA) console.log(`\n===== /ai =====\n${s}`);
  expect(s).toMatch(/Scegli l'AI/);
  expect(s).toMatch(/Le tue AI/);
  expect(s).not.toMatch(/Rispondono soltanto|Lavorano sui file/);
  // Giù fino a Groq (terza voce), invio.
  t.mockInput.pressArrow("down");
  t.mockInput.pressArrow("down");
  t.mockInput.pressEnter();
  await aspetta(400);
  expect(chiamate.find((x) => x.p === "/runs/x/providers")?.c).toEqual({ richiesta: "groq" });
  await t.mockInput.typeText("Crea un file di prova");
  t.mockInput.pressEnter();
  await aspetta(600);
  expect(chiamate.find((x) => x.p === "/runs/x/turn")?.c).toMatchObject({ text: "Crea un file di prova" });
  expect(chiamate.some((x) => x.p === "/runs/x/diretto")).toBe(false);
  t.renderer.destroy();
}, 20000);

it("shift+tab dice ogni volta dove vanno i messaggi", async () => {
  const run: any = { id: "x", agent: "codex", state: "PAUSED", providers: ["codex", "claude"] };
  const config = { attiva: true, modello: "qwen3.5:4b", riserva: true, aComando: true, compiti: [] };
  const chiamate: string[] = [];
  const api = async (p: string) => {
    chiamate.push(p);
    return p.startsWith("/runs/x/events") ? { events: [] } : p === "/runs/x" ? run : p.startsWith("/ibrida") ? { config, ollama: { acceso: true, modelli: [] } } : {};
  };
  const t = await testRender(
    () => <App api={api} id="x" cartella="/Users/prova/test1" cartellaDati="/tmp/n" onEsci={() => {}} />,
    { width: 120, height: 30, exitOnCtrlC: false },
  );
  await aspetta(400);
  const dopo = async () => {
    t.mockInput.pressTab({ shift: true });
    await aspetta(200);
    await t.renderOnce();
    return t.captureCharFrame().replace(/\s+/g, " ");
  };
  expect(await dopo()).toMatch(/Messaggi a Qwen sul computer · solo risposte/);
  expect(await dopo()).toMatch(/Messaggi a Qwen sul computer · lavora sui file/);
  expect(await dopo()).toMatch(/Messaggi a Codex/);
  // Tornando a Codex, il modello del Mac lascia la memoria.
  await aspetta(100);
  expect(chiamate).toContain("/ibrida/libera");
  t.renderer.destroy();
}, 20000);
