import { it, expect } from "vitest";
import { testRender } from "@opentui/solid";
import { App } from "../../src/tui/app.js";
import { Domanda, Scelta } from "../../src/tui/dialoghi.js";

// Correzioni della revisione del 14 ottobre (docs/CONTEXT.md).
const aspetta = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

function servizio(opzioni: { eventiIniziali?: any[]; durata?: number } = {}) {
  const eventi: any[] = [...(opzioni.eventiIniziali ?? [])];
  const chiamate: { percorso: string; corpo?: any }[] = [];
  const run: any = { id: "x", agent: "codex", state: "PAUSED", turnNumber: 0, providers: ["codex", "claude"] };
  let seq = eventi.length;
  const metti = (type: string, message = "") =>
    eventi.push({ seq: ++seq, type, payload: { message }, source: "codex" });
  const api = async (percorso: string, corpo?: any) => {
    chiamate.push({ percorso, corpo });
    if (percorso.startsWith("/runs/x/events")) {
      const dopo = Number(/afterSeq=(\d+)/.exec(percorso)?.[1] ?? 0);
      return { events: eventi.filter((e) => e.seq > dopo) };
    }
    if (percorso === "/runs/x/turn") {
      run.state = "RUNNING";
      metti("user.request", corpo.text);
      metti("attempt.started", "codex reale avviato");
      setTimeout(() => {
        metti("agent.message", "Fatto.");
        metti("turn.completed", `Turno ${++run.turnNumber} concluso da codex`);
        run.state = "PAUSED";
      }, opzioni.durata ?? 1500);
      return {};
    }
    if (percorso === "/runs/x/providers") return { providers: ["claude", "codex"] };
    if (percorso.startsWith("/runs/x/changed")) return { files: ["a.ts"] };
    if (percorso === "/runs/x/apply") {
      metti("work.applied", "Nella tua cartella: a.ts");
      return { applicati: ["a.ts"] };
    }
    if (percorso === "/runs/x/github") return {};
    if (percorso === "/runs/x/live") return { parziale: "" };
    if (percorso === "/runs/x") return run;
    return {};
  };
  return { api, chiamate };
}

async function apri(api: any, onEsci = () => {}) {
  const t = await testRender(
    () => <App api={api} id="x" cartella="/p" cartellaDati="/tmp/n" onEsci={onEsci} />,
    { width: 100, height: 30, exitOnCtrlC: false },
  );
  await aspetta(300);
  return t;
}

it("un comando scritto durante il turno va in coda e parte dopo, non subito", async () => {
  const s = servizio();
  const t = await apri(s.api);
  await t.mockInput.typeText("Lavora");
  t.mockInput.pressEnter();
  await aspetta(200);
  await t.mockInput.typeText("/ordine claude");
  t.mockInput.pressEnter();
  await aspetta(200);
  expect(s.chiamate.some((c) => c.percorso === "/runs/x/providers")).toBe(false);
  await t.renderOnce();
  expect(t.captureCharFrame()).toMatch(/1 in coda/);
  await aspetta(2500);
  const indici = s.chiamate.map((c) => c.percorso);
  expect(indici.indexOf("/runs/x/providers")).toBeGreaterThan(indici.indexOf("/runs/x/apply"));
  t.renderer.destroy();
}, 15000);

it("ctrl+c con del testo durante il turno svuota il campo e non interrompe", async () => {
  const s = servizio({ durata: 3000 });
  const t = await apri(s.api);
  await t.mockInput.typeText("Lavora");
  t.mockInput.pressEnter();
  await aspetta(200);
  await t.mockInput.typeText("bozza da buttare");
  t.mockInput.pressKey("c", { ctrl: true });
  t.mockInput.pressKey("c", { ctrl: true });
  await aspetta(100);
  await t.renderOnce();
  const schermo = t.captureCharFrame();
  expect(schermo).not.toMatch(/bozza da buttare/);
  expect(s.chiamate.some((c) => c.percorso === "/runs/x/actions")).toBe(false);
  t.renderer.destroy();
}, 15000);

it("/esci durante il turno aspetta la fine e la consegna", async () => {
  const s = servizio();
  let uscito = false;
  const t = await apri(s.api, () => (uscito = true));
  await t.mockInput.typeText("Lavora");
  t.mockInput.pressEnter();
  await aspetta(200);
  await t.mockInput.typeText("/esci");
  t.mockInput.pressEnter();
  await aspetta(300);
  expect(uscito).toBe(false);
  await aspetta(2500);
  expect(uscito).toBe(true);
  expect(s.chiamate.some((c) => c.percorso === "/runs/x/apply")).toBe(true);
  t.renderer.destroy();
}, 15000);

it("una fine di turno vecchia nel registro non chiude il turno nuovo", async () => {
  const s = servizio({
    eventiIniziali: [{ seq: 1, type: "run.blocked", payload: { message: "Avvio fallito" } }],
  });
  const t = await apri(s.api);
  await t.mockInput.typeText("Riprova");
  t.mockInput.pressEnter();
  await aspetta(600);
  await t.renderOnce();
  expect(t.captureCharFrame()).toMatch(/lavora da/);
  await aspetta(2000);
  expect(s.chiamate.some((c) => c.percorso === "/runs/x/apply")).toBe(true);
  t.renderer.destroy();
}, 15000);

it("la chiave nel riquadro nascosto non compare mai a schermo", async () => {
  let risposta: string | undefined;
  const t = await testRender(
    () => <Domanda titolo="Chiave" nascosta onRisposta={(r) => (risposta = r)} />,
    { width: 80, height: 20 },
  );
  await t.mockInput.typeText("sk-segreta-123");
  await aspetta(50);
  await t.renderOnce();
  const schermo = t.captureCharFrame();
  expect(schermo).not.toMatch(/segreta/);
  expect(schermo).toMatch(/••••/);
  expect(schermo).toMatch(/14 caratteri/);
  t.mockInput.pressEnter();
  await aspetta(50);
  expect(risposta).toBe("sk-segreta-123");
  t.renderer.destroy();
});

it("nei dialoghi con ricerca le frecce scelgono, invio conferma", async () => {
  let scelta: string | undefined;
  const t = await testRender(
    () => (
      <Scelta
        titolo="Prova"
        ricerca
        voci={[
          { nome: "uno", valore: "1" },
          { nome: "due", valore: "2" },
          { nome: "tre", valore: "3" },
        ]}
        onScegli={(v) => (scelta = v.valore)}
        onChiudi={() => {}}
      />
    ),
    { width: 80, height: 20 },
  );
  await aspetta(50);
  t.mockInput.pressArrow("down");
  t.mockInput.pressArrow("down");
  await aspetta(50);
  // La voce scelta si riconosce dal fondo, non da un segno: la si verifica
  // da ciò che viene scelto.
  t.mockInput.pressEnter();
  await aspetta(50);
  expect(scelta).toBe("3");
  t.renderer.destroy();
});

it("un incolla lungo resta compatto nel campo e parte intero", async () => {
  const s = servizio();
  const t = await apri(s.api);
  const lungo = Array.from({ length: 40 }, (_, i) => `riga ${i + 1}`).join("\n");
  await t.mockInput.pasteBracketedText(lungo);
  await aspetta(150);
  await t.renderOnce();
  expect(t.captureCharFrame()).toMatch(/\[Incollate ~40 righe\]/);
  expect(t.captureCharFrame()).not.toMatch(/riga 39/);
  t.mockInput.pressEnter();
  await aspetta(300);
  expect(s.chiamate.find((c) => c.percorso === "/runs/x/turn")?.corpo.text).toBe(lungo);
  t.renderer.destroy();
}, 15000);

it("un file trascinato dal Finder diventa un allegato, con la × per toglierlo", async () => {
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const file = join(mkdtempSync(join(tmpdir(), "continuity-trascina-")), "Spec finale.pdf");
  writeFileSync(file, "x");
  const allegati: string[] = [];
  const base = servizio();
  const api = async (percorso: string, corpo?: any) => {
    if (percorso === "/runs/x/attachments") allegati.push(corpo.path.split(/[\\/]/).pop());
    if (percorso === "/runs/x/attachments/remove") allegati.splice(allegati.indexOf(corpo.nome), 1);
    const r = await base.api(percorso, corpo);
    return percorso === "/runs/x" ? { ...r, allegati: [...allegati] } : r;
  };
  const t = await apri(api);
  await t.mockInput.pasteBracketedText(`'${file}' `);
  await aspetta(400);
  await t.renderOnce();
  expect(allegati).toEqual(["Spec finale.pdf"]);
  const schermo = t.captureCharFrame();
  expect(schermo).toMatch(/📎 Spec finale\.pdf\s+×/);
  // Il percorso non resta nel campo come testo.
  expect(schermo).not.toMatch(/continuity-trascina/);
  expect(base.chiamate.some((c) => c.percorso === "/runs/x/turn")).toBe(false);
  expect(schermo).toMatch(/\+ allega/);
  t.renderer.destroy();
}, 15000);

it("AI ibrida: shift+tab cambia destinatario, i compiti con la parola vanno al modello locale", async () => {
  const base = servizio();
  const config = {
    attiva: true, modello: "qwen3.5:4b", riserva: true, aComando: true,
    compiti: [
      { id: "chiedi", nome: "Domande", parola: "#chiedi", istruzioni: "x", attivo: true },
      { id: "spiega", nome: "Spiega", parola: "#spiega", istruzioni: "x", attivo: true },
    ],
  };
  const eventi: any[] = [];
  const compiti: any[] = [];
  let seq = 1000;
  const api = async (percorso: string, corpo?: any) => {
    if (percorso.startsWith("/ibrida")) return { config, ollama: { acceso: true, versione: "0.40.4", modelli: ["qwen3.5:4b"] } };
    if (percorso === "/runs/x/locale") {
      compiti.push(corpo);
      eventi.push({ seq: ++seq, type: "local.request", payload: { message: corpo.testo }, source: "persona" });
      setTimeout(() => eventi.push({ seq: ++seq, type: "local.message", payload: { message: "Risposta locale." }, source: "qwen" }), 200);
      return { ok: true };
    }
    if (percorso.startsWith("/runs/x/events")) {
      const r = await base.api(percorso, corpo);
      const dopo = Number(/afterSeq=(\d+)/.exec(percorso)?.[1] ?? 0);
      return { events: [...r.events, ...eventi.filter((e) => e.seq > dopo)] };
    }
    return base.api(percorso, corpo);
  };
  const t = await apri(api);
  await aspetta(200);
  t.mockInput.pressTab({ shift: true });
  await aspetta(100);
  await t.renderOnce();
  expect(t.captureCharFrame()).toMatch(/→ AI ibrida/);
  expect(t.captureCharFrame()).toMatch(/solo risposte/);
  await t.mockInput.typeText("Cosa fa npm ci?");
  t.mockInput.pressEnter();
  await aspetta(900);
  await t.renderOnce();
  const s = t.captureCharFrame();
  expect(s).toMatch(/Risposta locale\./);
  expect(s).toMatch(/Qwen · sul tuo computer · AI ibrida/);
  expect(base.chiamate.some((c) => c.percorso === "/runs/x/turn")).toBe(false);
  // Torna alla sequenza (risposte → file → sequenza) e prova un compito.
  t.mockInput.pressTab({ shift: true });
  t.mockInput.pressTab({ shift: true });
  await t.mockInput.typeText("#spiega ENOENT");
  t.mockInput.pressEnter();
  await aspetta(900);
  expect(compiti).toEqual([
    { testo: "Cosa fa npm ci?", compito: "chiedi" },
    { testo: "ENOENT", compito: "spiega" },
  ]);
  t.renderer.destroy();
}, 15000);
