// Il menu dei comandi mentre si scrive «/» (richiesta di Lorenzo del 30
// ottobre): compare sopra il campo, si restringe lettera dopo lettera, ↑↓
// sceglie, tab completa, invio esegue, esc chiude.
import { it, expect } from "vitest";
import { testRender } from "@opentui/solid";
import { App } from "../../src/tui/app.js";

const aspetta = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

function servizio() {
  const chiamate: { percorso: string; corpo?: any }[] = [];
  const run: any = { id: "x", agent: "codex", state: "PAUSED", turnNumber: 0, providers: ["codex", "claude"], checks: [] };
  const api = async (percorso: string, corpo?: any) => {
    chiamate.push({ percorso, corpo });
    if (percorso.startsWith("/runs/x/events")) return { events: [] };
    if (percorso === "/runs/x") return run;
    return {};
  };
  return { api, chiamate };
}

it("scrivendo «/» compare il menu dei comandi, che si restringe con le lettere; invio esegue quello scelto", async () => {
  const s = servizio();
  const { renderer, mockInput, renderOnce, captureCharFrame } = await testRender(
    () => <App api={s.api} id="x" cartella="/Users/prova/progetto" cartellaDati="/tmp/nessuna" onEsci={() => {}} />,
    { width: 100, height: 44, exitOnCtrlC: false },
  );
  const schermo = async (ms = 80) => {
    await aspetta(ms);
    await renderOnce();
    return captureCharFrame();
  };
  await schermo(300);
  await mockInput.typeText("/");
  let s1 = await schermo();
  expect(s1).toMatch(/› \/ai\s/);
  expect(s1).toMatch(/\/collega\s/);
  expect(s1).toMatch(/↑↓ scegli · tab completa · invio esegue · esc chiude/);
  // Lettera dopo lettera restano solo i comandi che cominciano così.
  await mockInput.typeText("re");
  s1 = await schermo();
  expect(s1).toMatch(/› \/revisore/);
  expect(s1).not.toMatch(/\/collega\s/);
  // «/tem» + invio esegue /tema (che apre la sua scelta).
  for (let i = 0; i < 3; i++) mockInput.pressBackspace();
  await mockInput.typeText("/tem");
  s1 = await schermo();
  expect(s1).toMatch(/› \/tema/);
  mockInput.pressEnter();
  s1 = await schermo(200);
  expect(s1).toMatch(/Tema/);
  expect(s1).toMatch(/scuro/);
  mockInput.pressEscape();
  await schermo();
  // esc chiude il menu; il testo resta.
  await mockInput.typeText("/fl");
  s1 = await schermo();
  expect(s1).toMatch(/› \/flusso/);
  mockInput.pressEscape();
  s1 = await schermo();
  expect(s1).not.toMatch(/↑↓ scegli/);
  renderer.destroy();
});
