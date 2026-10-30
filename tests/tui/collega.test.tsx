// /collega nell'interfaccia (prova di Lorenzo del 25 ottobre: «non riesco a
// incollare la chiave»). La chiave si incolla davvero (bracketed paste, come
// fa il Terminale con cmd+V), un rifiuto lascia il riquadro aperto con
// l'errore, i gratuiti stanno in cima. Portachiavi in memoria e prova finta:
// niente rete, niente Portachiavi vero.
import { it, expect, vi, beforeEach } from "vitest";
import { testRender } from "@opentui/solid";

const salvate = new Map<string, string>();
vi.mock("../../src/core/portachiavi.js", async (originale) => ({
  ...(await originale<any>()),
  portachiaviDiSistema: () => ({
    leggi: (p: string) => salvate.get(p),
    esiste: (p: string) => salvate.has(p),
    salva: (p: string, c: string) => void salvate.set(p, c),
    togli: (p: string) => salvate.delete(p),
  }),
}));
const prove: string[] = [];
let rifiuta = 0;
vi.mock("../../src/core/collega.js", async (originale) => ({
  ...(await originale<any>()),
  provaCollegamento: async (_p: any, chiave: string) => {
    prove.push(chiave);
    return rifiuta-- > 0
      ? { ok: false, chiaveRifiutata: true, dettaglio: "il servizio ha rifiutato la chiave (HTTP 401)" }
      : { ok: true, dettaglio: "collegamento riuscito" };
  },
}));
const { App } = await import("../../src/tui/app.js");
const { testoIncollato } = await import("../../src/tui/dialoghi.js");

const aspetta = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
beforeEach(() => {
  salvate.clear();
  prove.length = 0;
  rifiuta = 0;
});

async function apri() {
  const run = { id: "x", agent: "claude", state: "PAUSED", providers: ["claude", "codex"] };
  const chiamate: string[] = [];
  const api = async (p: string) => {
    chiamate.push(p);
    return p.startsWith("/runs/x/events") ? { events: [] } : p === "/runs/x" ? run : {};
  };
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dati = mkdtempSync(join(tmpdir(), "continuity-prova-collega-"));
  const t = await testRender(() => <App api={api} id="x" cartella="/Users/prova/test1" cartellaDati={dati} onEsci={() => {}} />, {
    width: 110,
    height: 36,
    exitOnCtrlC: false,
  });
  await aspetta(400);
  const schermo = async () => {
    await aspetta(250);
    await t.renderOnce();
    return t.captureCharFrame();
  };
  return { t, schermo, chiamate };
}

it("l'evento incolla di OpenTUI porta il testo in bytes", () => {
  expect(testoIncollato({ bytes: new TextEncoder().encode("gsk_abc123\n") })).toBe("gsk_abc123");
  expect(testoIncollato({ text: "vecchio" })).toBe("vecchio");
});

it("i gratuiti in cima, la chiave incollata con cmd+V, collegato al primo colpo", async () => {
  const { t, schermo, chiamate } = await apri();
  await t.mockInput.typeText("/collega");
  t.mockInput.pressEnter();
  let s = await schermo();
  if (process.env.CONTINUITY_ANTEPRIMA) console.log(`\n===== /collega =====\n${s}`);
  expect(s.indexOf("Gratuiti con il tuo account")).toBeGreaterThan(-1);
  expect(s.indexOf("Gratuiti con il tuo account")).toBeLessThan(s.indexOf("Sul tuo computer") === -1 ? Infinity : s.indexOf("Sul tuo computer"));
  await t.mockInput.typeText("groq");
  t.mockInput.pressEnter();
  s = await schermo();
  if (process.env.CONTINUITY_ANTEPRIMA) console.log(`\n===== chiave groq =====\n${s}`);
  expect(s).toMatch(/1\. ctrl\+o apre console\.groq\.com/);
  expect(s).toMatch(/incolla qui la chiave \(cmd\+V\)/);
  // Come il Terminale con cmd+V.
  await t.mockInput.pasteBracketedText("gsk_chiave_vera_di_prova_1234567890");
  s = await schermo();
  if (process.env.CONTINUITY_ANTEPRIMA) console.log(`\n===== incollata =====\n${s}`);
  expect(s).toMatch(/✓ chiave incollata \(35 caratteri\)/);
  expect(s).not.toContain("gsk_chiave_vera");
  t.mockInput.pressEnter();
  await aspetta(400);
  s = await schermo();
  expect(prove).toEqual(["gsk_chiave_vera_di_prova_1234567890"]);
  expect(salvate.get("groq")).toBe("gsk_chiave_vera_di_prova_1234567890");
  expect(chiamate).toContain("/providers/groq/collegato");
  expect(s).toMatch(/Fallo lavorare adesso/);
  t.renderer.destroy();
}, 20000);

it("una chiave rifiutata lascia il riquadro aperto con l'errore, e si riprova", async () => {
  rifiuta = 1;
  const { t, schermo } = await apri();
  await t.mockInput.typeText("/collega groq");
  t.mockInput.pressEnter();
  await schermo();
  await t.mockInput.pasteBracketedText("sbagliata");
  t.mockInput.pressEnter();
  let s = await schermo();
  if (process.env.CONTINUITY_ANTEPRIMA) console.log(`\n===== rifiutata =====\n${s}`);
  expect(s.replace(/\s+/g, " ")).toMatch(/✗ il servizio ha rifiutato la chiave \(HTTP 401\): controlla di averla copiata intera/);
  expect(s).toMatch(/incolla qui la chiave/);
  await t.mockInput.pasteBracketedText("giusta");
  t.mockInput.pressEnter();
  await schermo();
  expect(prove).toEqual(["sbagliata", "giusta"]);
  expect(salvate.get("groq")).toBe("giusta");
  t.renderer.destroy();
}, 20000);
