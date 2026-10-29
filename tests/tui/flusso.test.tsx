// Fase 3, passo 3: i flussi nell'interfaccia. Servizio finto: /flusso, il
// flusso seguito fino alla fine, il piano che chiede il sì, la consegna una
// volta sola.
import { it, expect } from "vitest";
import { testRender } from "@opentui/solid";
import { App } from "../../src/tui/app.js";
import { applicaEventi, nuovaConversazione } from "../../src/tui/conversazione.js";
import { flussiPredefiniti } from "../../src/core/flussi.js";

const aspetta = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const ora = () => new Date().toISOString();

it("gli eventi di un flusso diventano righe e blocchi nella conversazione", () => {
  const ev = (seq: number, type: string, message: string, source = "continuity") => ({ seq, type, payload: { message }, source, recordedAt: ora() });
  const c = applicaEventi(
    { ...nuovaConversazione(), elementi: [{ tipo: "richiesta", testo: "il totale", locale: true }] },
    [
      ev(1, "user.request", "il totale"),
      ev(2, "flow.started", "Flusso «Completo»: Pianifica (la sequenza) → Scrive (la sequenza)"),
      ev(3, "flow.step", "Passo 1 di 2 · Pianifica · la sequenza · legge soltanto"),
      ev(4, "flow.plan_ready", "1. Moltiplica\n2. Un test", "Codex"),
      ev(5, "flow.plan_approved", "Piano approvato"),
      ev(6, "flow.review", "• carrello.js:1 — manca → aggiungi", "Groq · gpt-oss-120b"),
      ev(7, "flow.correction", "Rimando il problema a chi scrive · giro 1 di 2"),
      ev(8, "flow.review", "Nessun problema: il lavoro sembra a posto", "Groq · gpt-oss-120b"),
      ev(9, "flow.verdict", "NON PRONTO\n- manca il caso vuoto", "Groq · gpt-oss-120b"),
      ev(10, "flow.progress", "Avanti: passo 3 di 3"),
      ev(11, "flow.completed", "Flusso «Completo» concluso · NON pronto"),
      ev(12, "flow.readonly_violation", "claude doveva solo leggere ma ha cambiato 1 file (a.js): li ho rimessi com'erano"),
    ],
  );
  expect(c.elementi).toEqual([
    { tipo: "richiesta", testo: "il totale" },
    { tipo: "info", testo: "▸ Flusso «Completo»: Pianifica (la sequenza) → Scrive (la sequenza)" },
    { tipo: "info", testo: "◆ Passo 1 di 2 · Pianifica · la sequenza · legge soltanto" },
    { tipo: "flusso", titolo: "Piano", da: "Codex", righe: ["1. Moltiplica", "2. Un test"], nota: "Aspetta il tuo sì: approvalo, chiedi di cambiarlo o annullalo" },
    { tipo: "info", testo: "✓ Piano approvato" },
    { tipo: "flusso", titolo: "Revisione", da: "Groq · gpt-oss-120b", righe: ["1. carrello.js:1 — manca → aggiungi"] },
    { tipo: "info", testo: "↺ Rimando il problema a chi scrive · giro 1 di 2" },
    { tipo: "info", testo: "◇ Revisione · Groq · gpt-oss-120b: Nessun problema: il lavoro sembra a posto" },
    { tipo: "flusso", titolo: "Verifica finale", da: "Groq · gpt-oss-120b", righe: ["NON PRONTO", "- manca il caso vuoto"], esito: false },
    { tipo: "info", testo: "■ Flusso «Completo» concluso · NON pronto" },
    { tipo: "avviso", testo: "claude doveva solo leggere ma ha cambiato 1 file (a.js): li ho rimessi com'erano" },
  ]);
});

// Un servizio finto con un registro che cresce.
function servizio(run: any) {
  const eventi: any[] = [];
  const chiamate: { p: string; c?: any }[] = [];
  let seq = 0;
  const metti = (type: string, message: string, source = "continuity") =>
    eventi.push({ seq: ++seq, type, payload: { message }, source, recordedAt: ora() });
  const config = flussiPredefiniti();
  const api = async (p: string, c?: any) => {
    chiamate.push({ p, c });
    if (p.startsWith("/runs/x/events")) {
      const dopo = Number(/afterSeq=(\d+)/.exec(p)?.[1] ?? 0);
      return { events: eventi.filter((e) => e.seq > dopo) };
    }
    if (p === "/runs/x") return run;
    if (p === "/flussi") return config;
    if (p === "/gratuiti") return [];
    if (p.startsWith("/runs/x/changed")) return { files: ["carrello.js"], stat: {} };
    if (p === "/runs/x/apply") return { applicati: ["carrello.js"], eliminati: [] };
    if (p === "/runs/x/github") return {};
    return run;
  };
  return { api, eventi, chiamate, metti };
}

it("/flusso: i flussi con quello attivo, e invio ne rende attivo un altro", async () => {
  const run: any = { id: "x", agent: "codex", state: "PAUSED", providers: ["codex", "claude"], flusso: "diretto" };
  const s = servizio(run);
  const t = await testRender(
    () => <App api={s.api} id="x" cartella="/Users/prova/test1" cartellaDati="/tmp/n" onEsci={() => {}} />,
    { width: 120, height: 40, exitOnCtrlC: false },
  );
  await aspetta(400);
  await t.mockInput.typeText("/flusso");
  t.mockInput.pressEnter();
  await aspetta(400);
  await t.renderOnce();
  let schermo = t.captureCharFrame();
  if (process.env.CONTINUITY_ANTEPRIMA) console.log(`\n===== /flusso =====\n${schermo}`);
  expect(schermo).toMatch(/Come lavorano le AI/);
  // Nomi che dicono cosa succede, ognuno spiegato sotto; nessuna «parola:».
  expect(schermo).toMatch(/● Lavora\s+● in uso/);
  expect(schermo).toMatch(/Lavora e ricontrolla/);
  expect(schermo).toMatch(/Pianifica, lavora e ricontrolla/);
  expect(schermo).not.toMatch(/revisione:|completo:/);
  expect(schermo).toMatch(/\+ Crea un flusso/);
  expect(schermo).toMatch(/• Lavora e ricontrolla: Un'AI fa il lavoro, un'altra/);
  // /ordine è qui dentro, e anche chi controlla sempre.
  expect(schermo).toMatch(/Sequenza: Codex → Claude Code\s+chi continua/);
  expect(schermo).toMatch(/Sempre attivi: nessuno acceso\s+in parallelo/);
  // Giù su «Lavora e ricontrolla», invio.
  t.mockInput.pressArrow("down");
  await aspetta(100);
  t.mockInput.pressEnter();
  await aspetta(400);
  expect(s.chiamate.find((x) => x.p === "/runs/x/flusso")?.c).toEqual({ flusso: "revisione" });
  t.renderer.destroy();
}, 20000);

it("un flusso si segue fino alla fine: il piano chiede il sì, e il lavoro si consegna una volta sola", async () => {
  const run: any = { id: "x", agent: "codex", state: "PAUSED", providers: ["codex", "claude"], flusso: "diretto" };
  const s = servizio(run);
  const api = async (p: string, c?: any) => {
    if (p === "/runs/x/turn") {
      s.chiamate.push({ p, c });
      run.esecuzione = { flusso: { nome: "Completo", passi: [{ ruolo: "pianifica" }, { ruolo: "scrive" }] }, ruoli: [{ id: "pianifica", nome: "Pianifica" }, { id: "scrive", nome: "Scrive" }], passo: 0, giro: 0 };
      s.metti("user.request", "il totale");
      s.metti("flow.started", "Flusso «Completo»: Pianifica (la sequenza) → Scrive (la sequenza)");
      s.metti("flow.step", "Passo 1 di 2 · Pianifica · la sequenza · legge soltanto");
      setTimeout(() => {
        s.metti("turn.completed", "Turno 1 concluso da codex · nessun file modificato");
        s.metti("flow.plan_ready", "1. Moltiplica per la quantità\n2. Aggiungi un test", "Codex");
        run.esecuzione = { ...run.esecuzione, attesa: "piano", piano: "1. Moltiplica per la quantità\n2. Aggiungi un test" };
      }, 300);
      return { ...run };
    }
    if (p === "/runs/x/flusso/piano") {
      s.chiamate.push({ p, c });
      run.esecuzione = { ...run.esecuzione, attesa: undefined, passo: 1 };
      s.metti("flow.plan_approved", "Piano approvato");
      s.metti("flow.step", "Passo 2 di 2 · Scrive · la sequenza");
      setTimeout(() => {
        s.metti("turn.completed", "Turno 2 concluso da codex · 1/1 criteri");
        s.metti("flow.completed", "Flusso «Completo» concluso");
        run.esecuzione = undefined;
      }, 300);
      return { ...run };
    }
    return s.api(p, c);
  };
  const t = await testRender(
    () => <App api={api} id="x" cartella="/Users/prova/test1" cartellaDati="/tmp/n" onEsci={() => {}} />,
    { width: 120, height: 40, exitOnCtrlC: false },
  );
  await aspetta(400);
  await t.mockInput.typeText("il totale");
  t.mockInput.pressEnter();
  // Il piano arriva: il riquadro chiede il sì.
  let schermo = "";
  for (let i = 0; i < 20 && !/Approva e continua/.test(schermo); i++) {
    await aspetta(200);
    await t.renderOnce();
    schermo = t.captureCharFrame();
  }
  if (process.env.CONTINUITY_ANTEPRIMA) console.log(`\n===== piano =====\n${schermo}`);
  expect(schermo).toMatch(/Il piano da approvare/);
  expect(schermo).toMatch(/Approva e continua/);
  // Il piano è dentro il riquadro, intero.
  expect(schermo).toMatch(/Aggiungi un test[\s\S]*Esc lo lascia in attesa/);
  // Il primo turno (il piano) non ha consegnato nulla.
  expect(s.chiamate.some((x) => x.p === "/runs/x/apply")).toBe(false);
  t.mockInput.pressEnter();
  for (let i = 0; i < 20 && !s.chiamate.some((x) => x.p === "/runs/x/apply"); i++) await aspetta(200);
  expect(s.chiamate.find((x) => x.p === "/runs/x/flusso/piano")?.c).toEqual({ azione: "approva" });
  expect(s.chiamate.filter((x) => x.p === "/runs/x/apply")).toHaveLength(1);
  await t.renderOnce();
  schermo = t.captureCharFrame();
  if (process.env.CONTINUITY_ANTEPRIMA) console.log(`\n===== fine flusso =====\n${schermo}`);
  expect(schermo).toMatch(/◆ Piano · Codex/);
  expect(schermo).toMatch(/1\. Moltiplica per la quantità/);
  expect(schermo).toMatch(/■ Flusso «Completo» concluso/);
  t.renderer.destroy();
}, 30000);

it("verifica finale NON PRONTO: prima di portare il lavoro nella cartella si chiede", async () => {
  const run: any = { id: "x", agent: "codex", state: "PAUSED", providers: ["codex", "claude"], flusso: "completo" };
  const s = servizio(run);
  const api = async (p: string, c?: any) => {
    if (p === "/runs/x/turn") {
      run.esecuzione = { flusso: { nome: "Con revisione", passi: [{ ruolo: "scrive" }] }, ruoli: [], passo: 0, giro: 0 };
      s.metti("user.request", "fai");
      setTimeout(() => {
        s.metti("flow.verdict", "NON PRONTO\n- manca un test", "Groq · m");
        s.metti("flow.completed", "Flusso «Con revisione» concluso · NON pronto");
        run.esecuzione = undefined;
      }, 300);
      return { ...run, esecuzione: run.esecuzione };
    }
    return s.api(p, c);
  };
  const t = await testRender(
    () => <App api={api} id="x" cartella="/Users/prova/test1" cartellaDati="/tmp/n" onEsci={() => {}} />,
    { width: 120, height: 40, exitOnCtrlC: false },
  );
  await aspetta(400);
  await t.mockInput.typeText("fai");
  t.mockInput.pressEnter();
  let schermo = "";
  for (let i = 0; i < 20 && !/La verifica finale dice NON PRONTO/.test(schermo); i++) {
    await aspetta(200);
    await t.renderOnce();
    schermo = t.captureCharFrame();
  }
  expect(schermo).toMatch(/Lascia il lavoro nella copia/);
  // Invio sulla prima voce: resta nella copia, niente consegna.
  t.mockInput.pressEnter();
  await aspetta(400);
  expect(s.chiamate.some((x) => x.p === "/runs/x/apply")).toBe(false);
  await t.renderOnce();
  expect(t.captureCharFrame()).toMatch(/Il lavoro resta nella copia/);
  t.renderer.destroy();
}, 30000);

it("/revisore: gli altri controlli sempre attivi, e ognuno ha il suo pannello", async () => {
  const run: any = {
    id: "x", agent: "codex", state: "PAUSED", providers: ["codex", "claude"],
    revisore: { attivo: true, ogniTurni: 1, consensi: [] },
    controlli: [{ id: "sicurezza", nome: "Sicurezza", attivo: true, ogniTurni: 3, istruzioni: "Solo i form" }],
    suggerimenti: [],
  };
  const s = servizio(run);
  const impostazioni: any[] = [];
  const api = async (p: string, c?: any) => {
    if (p === "/gratuiti") return [{ id: "groq", nome: "Groq · gratuito", collegato: true, lavoraSuiFile: false }];
    if (p === "/runs/x/revisore") {
      impostazioni.push(c);
      if (c.controllo === "sicurezza" && "attivo" in c) run.controlli[0].attivo = c.attivo;
      return run;
    }
    return s.api(p, c);
  };
  const t = await testRender(
    () => <App api={api} id="x" cartella="/Users/prova/test1" cartellaDati="/tmp/n" onEsci={() => {}} />,
    { width: 120, height: 40, exitOnCtrlC: false },
  );
  await aspetta(400);
  await t.mockInput.typeText("/revisore");
  t.mockInput.pressEnter();
  await aspetta(400);
  await t.renderOnce();
  let schermo = t.captureCharFrame();
  if (process.env.CONTINUITY_ANTEPRIMA) console.log(`\n===== /revisore con controlli =====\n${schermo}`);
  expect(schermo).toMatch(/Altri controlli sempre attivi/);
  expect(schermo).toMatch(/Sicurezza\s+acceso · ogni 3 turni/);
  expect(schermo).toMatch(/\+ Aggiungi un controllo/);
  // Sul controllo: il suo pannello, con «Togli questo controllo».
  // Acceso, Chi rivede, Correggi da solo, Modello, Quando, Che cosa controlla, poi Sicurezza.
  for (let i = 0; i < 6; i++) t.mockInput.pressArrow("down");
  await aspetta(100);
  t.mockInput.pressEnter();
  await aspetta(400);
  await t.renderOnce();
  schermo = t.captureCharFrame();
  if (process.env.CONTINUITY_ANTEPRIMA) console.log(`\n===== controllo =====\n${schermo}`);
  expect(schermo).toMatch(/Controllo «Sicurezza»/);
  expect(schermo).toMatch(/Togli questo controllo/);
  // Invio sulla prima voce (Acceso · spegni): spento.
  t.mockInput.pressEnter();
  await aspetta(400);
  expect(impostazioni.at(-1)).toEqual({ attivo: false, controllo: "sicurezza" });
  t.renderer.destroy();
}, 20000);

it("CT-2.0-302: un piano di 80 righe a 80×24 si legge tutto scorrendo con pagina giù", async () => {
  const piano = Array.from({ length: 80 }, (_, i) => `${i + 1}. Passo numero ${i + 1}`).join("\n") + "\nFINAL_MARKER_80";
  const run: any = {
    id: "x", agent: "codex", state: "PAUSED", providers: ["codex", "claude"],
    esecuzione: { flusso: { nome: "Completo", passi: [{ ruolo: "pianifica" }, { ruolo: "scrive" }] }, ruoli: [], passo: 0, giro: 0, attesa: "piano", piano },
  };
  const s = servizio(run);
  s.metti("flow.plan_ready", piano, "Claude");
  const t = await testRender(
    () => <App api={s.api} id="x" cartella="/Users/prova/test1" cartellaDati="/tmp/n" onEsci={() => {}} />,
    { width: 80, height: 24, exitOnCtrlC: false },
  );
  let schermo = "";
  for (let i = 0; i < 20 && !/Approva e continua/.test(schermo); i++) {
    await aspetta(200);
    await t.renderOnce();
    schermo = t.captureCharFrame();
  }
  expect(schermo).toMatch(/1\. Passo numero 1\b/);
  expect(schermo).toMatch(/righe 1–\d+ di 81 · pagina su\/giù per scorrere/);
  expect(schermo).toMatch(/Approva e continua/);
  // Pagina giù (la sequenza del terminale): finché il riquadro arriva in fondo.
  for (let i = 0; i < 30 && !/righe \d+–81 di 81/.test(schermo); i++) {
    t.mockInput.pressKey("\x1b[6~");
    await aspetta(50);
    await t.renderOnce();
    schermo = t.captureCharFrame();
  }
  if (process.env.CONTINUITY_ANTEPRIMA) console.log(`\n===== piano lungo, fine =====\n${schermo}`);
  // L'indicatore sta solo nel riquadro: in fondo, con l'ultima riga.
  expect(schermo).toMatch(/righe \d+–81 di 81 · pagina su\/giù/);
  expect(schermo).toMatch(/FINAL_MARKER_80/);
  // Le voci restano lì sotto.
  expect(schermo).toMatch(/Approva e continua/);
  t.renderer.destroy();
}, 30000);

it("il piano dopo esc: invio lo riapre (anche con un messaggio scritto, che resta nel campo) e «Approva sempre»", async () => {
  const run: any = {
    id: "x", agent: "codex", state: "PAUSED", providers: ["codex", "claude"],
    esecuzione: { flusso: { id: "completo", nome: "Pianifica, lavora e ricontrolla", passi: [{ ruolo: "pianifica" }, { ruolo: "scrive" }] }, ruoli: [], passo: 0, giro: 0, attesa: "piano", piano: "1. a\n2. b" },
  };
  const s = servizio(run);
  s.metti("flow.plan_ready", "1. a\n2. b", "Codex");
  const api = async (p: string, c?: any) => {
    if (p === "/runs/x/turn") throw new Error("non deve partire un turno");
    if (p === "/runs/x/flusso/piano") {
      s.chiamate.push({ p, c });
      run.esecuzione = undefined;
      s.metti("flow.plan_approved", "Piano approvato");
      s.metti("flow.completed", "Flusso «Pianifica, lavora e ricontrolla» concluso");
      return run;
    }
    return s.api(p, c);
  };
  const t = await testRender(
    () => <App api={api} id="x" cartella="/Users/prova/test1" cartellaDati="/tmp/n" onEsci={() => {}} />,
    { width: 120, height: 40, exitOnCtrlC: false },
  );
  const attendi = async (re: RegExp) => {
    let schermo = "";
    for (let i = 0; i < 20 && !re.test(schermo); i++) {
      await aspetta(150);
      await t.renderOnce();
      schermo = t.captureCharFrame();
    }
    return schermo;
  };
  expect(await attendi(/Approva sempre/)).toMatch(/Approva e continua/);
  // Esc: il riquadro si chiude e la conversazione dice come tornarci.
  t.mockInput.pressEscape();
  let schermo = await attendi(/premi invio per rispondere/);
  expect(schermo).not.toMatch(/Approva sempre/);
  expect(schermo).toMatch(/Il piano aspetta il tuo sì: premi invio per rispondere/);
  // Un messaggio scritto: non parte, il riquadro torna e il testo resta.
  await t.mockInput.typeText("ok va bene");
  t.mockInput.pressEnter();
  schermo = await attendi(/Approva sempre/);
  expect(schermo).toMatch(/Il piano da approvare/);
  t.mockInput.pressEscape();
  schermo = await attendi(/ok va bene/);
  expect(schermo).toMatch(/ok va bene/);
  // Invio di nuovo: il riquadro; giù su «Approva sempre», invio.
  t.mockInput.pressEnter();
  await attendi(/Approva sempre/);
  t.mockInput.pressArrow("down");
  await aspetta(100);
  t.mockInput.pressEnter();
  for (let i = 0; i < 20 && !s.chiamate.some((x) => x.p === "/runs/x/flusso/piano"); i++) await aspetta(150);
  expect(s.chiamate.find((x) => x.p === "/runs/x/flusso/piano")?.c).toEqual({ azione: "sempre" });
  t.renderer.destroy();
}, 30000);
