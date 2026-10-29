// Passo 2 del revisore nell'interfaccia: la revisione nella conversazione, con i
// suggerimenti numerati, e /revisore per scartarli. Servizio finto.
import { it, expect } from "vitest";
import { testRender } from "@opentui/solid";
import { App } from "../../src/tui/app.js";
import { applicaEventi, nuovaConversazione } from "../../src/tui/conversazione.js";

const aspetta = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const ora = () => new Date().toISOString();

it("la revisione diventa un blocco con i suggerimenti; nessun suggerimento lo dice", () => {
  const ev = (seq: number, type: string, message: string, source = "continuity") => ({ seq, type, payload: { message }, source, recordedAt: ora() });
  const c = applicaEventi(nuovaConversazione(), [
    ev(1, "review.started", "Groq rivede le modifiche (2 file)", "Groq"),
    ev(2, "review.completed", "• carrello.js:1 — manca la quantità → moltiplica\n• spedizione.js:3 — 50 esatti → <=", "Groq · gpt-oss-120b"),
    ev(3, "review.completed", "Nessun suggerimento: le modifiche sembrano a posto", "Groq · gpt-oss-120b"),
    ev(4, "review.consent_needed", "Google AI Studio riceverebbe il codice cambiato…"),
  ]);
  expect(c.elementi).toEqual([
    { tipo: "info", testo: "◇ Groq rivede le modifiche (2 file)" },
    { tipo: "revisione", da: "Groq · gpt-oss-120b", suggerimenti: ["carrello.js:1 — manca la quantità → moltiplica", "spedizione.js:3 — 50 esatti → <="] },
    { tipo: "revisione", da: "Groq · gpt-oss-120b", suggerimenti: [] },
    { tipo: "avviso", testo: "Google AI Studio riceverebbe il codice cambiato…" },
  ]);
});

it("a schermo: i suggerimenti numerati, e /revisore li scarta", async () => {
  const run: any = {
    id: "x", agent: "codex", state: "PAUSED", providers: ["codex", "claude"], revisore: { attivo: true },
    suggerimenti: [
      { id: "a1", testo: "carrello.js:1 — manca la quantità → moltiplica", da: "Groq · gpt-oss-120b", stato: "nuovo" },
      { id: "b2", testo: "spedizione.js:3 — 50 esatti → <=", da: "Groq · gpt-oss-120b", stato: "nuovo" },
    ],
  };
  const eventi = [
    { seq: 1, type: "review.completed", payload: { message: run.suggerimenti.map((x: any) => "• " + x.testo).join("\n") }, source: "Groq · gpt-oss-120b", recordedAt: ora() },
  ];
  const segnati: any[] = [];
  const api = async (p: string, c?: any) => {
    if (p.startsWith("/runs/x/events")) {
      const dopo = Number(/afterSeq=(\d+)/.exec(p)?.[1] ?? 0);
      return { events: eventi.filter((e) => e.seq > dopo) };
    }
    if (p === "/runs/x") return run;
    if (p.startsWith("/runs/x/suggerimenti/")) {
      const id = p.split("/").pop()!;
      segnati.push({ id, ...c });
      run.suggerimenti.find((x: any) => x.id === id).stato = c.scartato ? "scartato" : "nuovo";
      return run;
    }
    return {};
  };
  const t = await testRender(
    () => <App api={api} id="x" cartella="/Users/prova/test1" cartellaDati="/tmp/n" onEsci={() => {}} />,
    { width: 120, height: 34, exitOnCtrlC: false },
  );
  await aspetta(500);
  await t.renderOnce();
  let s = t.captureCharFrame();
  if (process.env.CONTINUITY_ANTEPRIMA) console.log(`\n===== revisione =====\n${s}`);
  expect(s).toMatch(/◇ Revisore · Groq · gpt-oss-120b/);
  expect(s).toMatch(/1\. carrello\.js:1 — manca la quantità → moltiplica/);
  expect(s).toMatch(/Vanno all'AI al prossimo turno · \/revisore per scartarli/);
  await t.mockInput.typeText("/revisore");
  t.mockInput.pressEnter();
  await aspetta(400);
  await t.renderOnce();
  s = t.captureCharFrame();
  if (process.env.CONTINUITY_ANTEPRIMA) console.log(`\n===== /revisore =====\n${s}`);
  expect(s).toMatch(/Suggerimenti per il prossimo turno/);
  expect(s).toMatch(/✓ va all'AI/);
  // Invio sul primo: scartato.
  t.mockInput.pressEnter();
  await aspetta(400);
  await t.renderOnce();
  s = t.captureCharFrame();
  expect(segnati).toEqual([{ id: "a1", scartato: true }]);
  expect(s).toMatch(/✗ scartato/);
  t.renderer.destroy();
}, 20000);

// Passo 3: il pannello completo e il consenso sui dati.
async function pannello(servizi: any[], revisore: any = { attivo: false }) {
  const run: any = { id: "x", agent: "codex", state: "PAUSED", providers: ["codex", "claude"], revisore, suggerimenti: [] };
  const impostazioni: any[] = [];
  const api = async (p: string, c?: any) => {
    if (p.startsWith("/runs/x/events")) return { events: [] };
    if (p === "/runs/x") return run;
    if (p === "/gratuiti") return servizi;
    if (p === "/runs/x/revisore") {
      impostazioni.push(c);
      run.revisore = { ...run.revisore, ...c };
      return run;
    }
    return {};
  };
  const t = await testRender(
    () => <App api={api} id="x" cartella="/Users/prova/test1" cartellaDati="/tmp/n" onEsci={() => {}} />,
    { width: 120, height: 36, exitOnCtrlC: false },
  );
  await aspetta(400);
  await t.mockInput.typeText("/revisore");
  t.mockInput.pressEnter();
  await aspetta(400);
  const schermo = async () => {
    await aspetta(300);
    await t.renderOnce();
    return t.captureCharFrame();
  };
  return { t, impostazioni, schermo, run };
}

it("il pannello mostra impostazioni e chi rivede; con Groq si accende senza domande", async () => {
  const { t, impostazioni, schermo } = await pannello([{ id: "groq", nome: "Groq (gratuito)", collegato: true, lavoraSuiFile: false }]);
  let s = await schermo();
  if (process.env.CONTINUITY_ANTEPRIMA) console.log(`\n===== /revisore impostazioni =====\n${s}`);
  expect(s).toMatch(/Spento\s+accendi/);
  expect(s).toMatch(/Chi rivede: Groq\s+automatico/);
  expect(s).toMatch(/Quando: a ogni turno\s+a fine turno/);
  expect(s).not.toMatch(/minuti/);
  expect(s).toMatch(/Che cosa controlla…\s+di serie/);
  t.mockInput.pressEnter();
  await aspetta(400);
  expect(impostazioni).toEqual([{ attivo: true }]);
  t.renderer.destroy();
}, 20000);

it("con Google si accende senza domande sui dati (l'avviso è solo al collegamento)", async () => {
  const google = [{ id: "google", nome: "Google AI Studio · Gemini (gratuito)", collegato: true, lavoraSuiFile: false }];
  const si = await pannello(google, { attivo: false, provider: "google" });
  si.t.mockInput.pressEnter();
  await aspetta(500);
  expect(si.impostazioni).toEqual([{ attivo: true }]);
  si.t.renderer.destroy();
}, 30000);
