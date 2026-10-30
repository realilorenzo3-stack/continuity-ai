// Le AI chiamate con @ nel terminale (27 ottobre): «@» apre il pannello delle
// AI, la scelta mette il nome nel campo; all'invio il riepilogo «chi fa cosa».
import { it, expect } from "vitest";
import { testRender } from "@opentui/solid";
import { App } from "../../src/tui/app.js";
import { flussiPredefiniti } from "../../src/core/flussi.js";

const aspetta = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

function servizio(conferma = true) {
  const run: any = { id: "x", agent: "codex", state: "PAUSED", providers: ["codex", "claude"] };
  const chiamate: { p: string; c?: any }[] = [];
  const config: any = { ...flussiPredefiniti(), ...(conferma ? {} : { confermaIncarichi: false }) };
  const api = async (p: string, c?: any) => {
    chiamate.push({ p, c });
    if (p.startsWith("/runs/x/events")) return { events: [] };
    if (p === "/runs/x") return run;
    if (p === "/flussi") {
      if (c) Object.assign(config, c);
      return config;
    }
    if (p === "/gratuiti") return [{ id: "groq", nome: "Groq (gratuito) · …", collegato: true, lavoraSuiFile: false }];
    if (p === "/runs/x/revisore") {
      run.revisore = { ...(run.revisore ?? {}), ...c };
      return run;
    }
    if (p === "/runs/x/turn") return run;
    return {};
  };
  return { api, chiamate, config };
}

async function apri(api: any) {
  const t = await testRender(
    () => <App api={api} id="x" cartella="/Users/prova/test1" cartellaDati="/tmp/n" onEsci={() => {}} />,
    { width: 120, height: 40, exitOnCtrlC: false },
  );
  await aspetta(400);
  const attendi = async (re: RegExp) => {
    let s = "";
    for (let i = 0; i < 20 && !re.test(s); i++) {
      await aspetta(120);
      await t.renderOnce();
      s = t.captureCharFrame();
    }
    return s;
  };
  return { t, attendi };
}

it("«@» apre il pannello delle AI; la scelta mette il nome; l'invio chiede «chi fa cosa» e parte con gli incarichi", async () => {
  const s = servizio();
  const { t, attendi } = await apri(s.api);
  await t.mockInput.typeText("Crea un sito. @");
  let schermo = await attendi(/Chiama un'AI/);
  if (process.env.CONTINUITY_ANTEPRIMA) console.log(`\n===== @ =====\n${schermo}`);
  expect(schermo).toMatch(/Le tue AI/);
  expect(schermo).toMatch(/Codex\s+@codex/);
  expect(schermo).not.toMatch(/Controllano|Lavorano sui file/);
  expect(schermo).toMatch(/Groq\s+@groq/);
  expect(schermo).toMatch(/Qwen sul computer\s+@qwen/);
  // Invio sulla prima (Codex): il nome nel campo.
  t.mockInput.pressEnter();
  await aspetta(200);
  await t.mockInput.typeText("fai il backend @");
  await attendi(/Chiama un'AI/);
  // Scrivere filtra: «groq».
  await t.mockInput.typeText("groq");
  await aspetta(150);
  t.mockInput.pressEnter();
  await aspetta(200);
  await t.mockInput.typeText("revisione dopo ogni modifica");
  await t.renderOnce();
  expect(t.captureCharFrame()).toMatch(/Crea un sito\. @codex fai il backend @groq revisione dopo ogni modifica/);
  t.mockInput.pressEnter();
  schermo = await attendi(/Chi fa cosa/);
  if (process.env.CONTINUITY_ANTEPRIMA) console.log(`\n===== chi fa cosa =====\n${schermo}`);
  expect(schermo).toMatch(/▸ Parti/);
  expect(schermo).toMatch(/1\. Codex: fai il backend\s+lavora/);
  expect(schermo).toMatch(/2\. Groq: revisione dopo ogni modifica\s+controlla/);
  expect(schermo).toMatch(/2\. Groq: revisione dopo ogni modifica \(ricontrolla ·/);
  // Invio su «Parti».
  t.mockInput.pressEnter();
  for (let i = 0; i < 20 && !s.chiamate.some((x) => x.p === "/runs/x/turn"); i++) await aspetta(100);
  expect(s.chiamate.find((x) => x.p === "/runs/x/turn")?.c).toEqual({
    text: "Crea un sito. @codex fai il backend @groq revisione dopo ogni modifica",
    incarichi: [
      { ai: "codex", compito: "fai il backend", tipo: "scrive" },
      { ai: "groq", compito: "revisione dopo ogni modifica", tipo: "legge", quando: "ogni" },
    ],
  });
  t.renderer.destroy();
}, 30000);

it("nel riepilogo si cambia un incarico; esc annulla e il messaggio torna nel campo; un'email non apre il pannello", async () => {
  const s = servizio();
  const { t, attendi } = await apri(s.api);
  await t.mockInput.typeText("scrivi a anna@");
  await aspetta(300);
  await t.renderOnce();
  expect(t.captureCharFrame()).not.toMatch(/Chiama un'AI/);
  // Svuota il campo e scrivi un messaggio con una @ già completa.
  for (let i = 0; i < 20; i++) t.mockInput.pressBackspace();
  await t.mockInput.typeText("@claude rivedi il carrello");
  await aspetta(200);
  // Il pannello si era aperto alla @: esc lo chiude, il testo resta.
  t.mockInput.pressEscape();
  await aspetta(150);
  t.mockInput.pressEnter();
  let schermo = await attendi(/Chi fa cosa/);
  expect(schermo).toMatch(/1\. Claude Code: rivedi il carrello\s+controlla/);
  // Giù sull'incarico, invio: «Lavora sui file».
  t.mockInput.pressArrow("down");
  await aspetta(100);
  t.mockInput.pressEnter();
  await attendi(/Lavora sui file/);
  t.mockInput.pressEnter();
  schermo = await attendi(/1\. Claude Code: rivedi il carrello\s+lavora/);
  expect(schermo).toMatch(/lavora/);
  // Esc: nessun turno, il testo torna nel campo.
  t.mockInput.pressEscape();
  await aspetta(300);
  await t.renderOnce();
  expect(s.chiamate.some((x) => x.p === "/runs/x/turn")).toBe(false);
  expect(t.captureCharFrame()).toMatch(/@claude rivedi il carrello/);
  t.renderer.destroy();
}, 30000);

it("con «Parti sempre senza chiedere» gli incarichi partono subito", async () => {
  const s = servizio(false);
  const { t } = await apri(s.api);
  await t.mockInput.typeText("@codex x @groq rivedi alla fine di tutto");
  await aspetta(200);
  t.mockInput.pressEscape();
  await aspetta(100);
  t.mockInput.pressEnter();
  for (let i = 0; i < 20 && !s.chiamate.some((x) => x.p === "/runs/x/turn"); i++) await aspetta(100);
  expect(s.chiamate.find((x) => x.p === "/runs/x/turn")?.c.incarichi).toEqual([
    { ai: "codex", compito: "x", tipo: "scrive" },
    { ai: "groq", compito: "rivedi alla fine di tutto", tipo: "legge", quando: "fine" },
  ]);
  t.renderer.destroy();
}, 30000);

it("con le @, Google parte senza domande sui dati (l'avviso è solo al collegamento)", async () => {
  const s = servizio();
  const { t, attendi } = await apri(s.api);
  await t.mockInput.typeText("@codex fai il backend @google rivedi");
  await aspetta(200);
  t.mockInput.pressEscape();
  await aspetta(100);
  t.mockInput.pressEnter();
  await attendi(/Chi fa cosa/);
  t.mockInput.pressEnter();
  for (let i = 0; i < 20 && !s.chiamate.some((x) => x.p === "/runs/x/turn"); i++) await aspetta(100);
  expect(s.chiamate.some((x) => x.p === "/runs/x/turn")).toBe(true);
  expect(s.chiamate.some((x) => x.p === "/runs/x/revisore")).toBe(false);
  t.renderer.destroy();
}, 30000);
