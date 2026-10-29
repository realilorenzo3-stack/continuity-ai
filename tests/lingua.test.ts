// L'inglese è la lingua di serie (28 ottobre); l'italiano si sceglie con
// /language. I test girano in italiano con CONTINUITY_LINGUA=it: qui la si
// toglie per provare il comportamento di chi installa Continuity.
import { it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileInterfaccia, istruzioneLingua, leggiLingua, linguaDiSerie } from "../src/core/lingua.js";
import { projectPrompt } from "../src/adapters/live.js";
import { normalizzaComando } from "../src/cli/comandi.js";

const prima = process.env.CONTINUITY_LINGUA;
const dirs: string[] = [];
afterEach(() => {
  process.env.CONTINUITY_LINGUA = prima;
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
});
const temp = () => {
  const d = mkdtempSync(join(tmpdir(), "continuity-lingua-"));
  dirs.push(d);
  return d;
};

it("senza scelta salvata la lingua è l'inglese; la scelta salvata vince", () => {
  delete process.env.CONTINUITY_LINGUA;
  const dati = temp();
  expect(linguaDiSerie()).toBe("en");
  expect(leggiLingua(dati)).toBe("en");
  writeFileSync(fileInterfaccia(dati), JSON.stringify({ lingua: "it" }));
  expect(leggiLingua(dati)).toBe("it");
  process.env.CONTINUITY_LINGUA = "en";
  expect(leggiLingua(dati)).toBe("it");
});

it("le AI ricevono l'istruzione nella lingua scelta", () => {
  expect(istruzioneLingua("en")).toMatch(/^Reply to the person in English/);
  expect(istruzioneLingua("it")).toMatch(/^Rispondi alla persona in italiano/);
  const testo = projectPrompt({ role: "writer", goal: "x", work: "/tmp/x", criteria: [], lingua: "en" });
  expect(testo).toMatch(/Reply to the person in English/);
});

it("normalizzaComando lascia intatto il testo libero", () => {
  expect(normalizzaComando("Ciao, sistema il carrello")).toBe("Ciao, sistema il carrello");
  expect(normalizzaComando("Fix the cart")).toBe("Fix the cart");
});

it("la lingua delle risposte segue quella in cui la persona scrive (Claude rispondeva in inglese a richieste in italiano)", async () => {
  const { linguaScritta } = await import("../src/core/lingua.js");
  expect(linguaScritta(["Ottimo, adesso voglio che @google renda il file html più accattivante, voglio che faccia una bella vetrina"])).toBe("it");
  expect(linguaScritta(["Now I want the html file to look better, please make a nice showcase for it"])).toBe("en");
  // Troppo corto o misto: decide la scelta di /language.
  expect(linguaScritta(["qw"])).toBeUndefined();
  expect(linguaScritta(["ok"])).toBeUndefined();
  const { Engine } = await import("../src/core/engine.js");
  const { Store } = await import("../src/persistence/store.js");
  delete process.env.CONTINUITY_LINGUA;
  const engine = new Engine(new Store(temp()));
  try {
    expect(engine.linguaPer({ transcript: [{ role: "utente", text: "scrivi un file di testo con la ricetta della coca cola" }], request: "qw" })).toBe("it");
    expect(engine.linguaPer({ transcript: [], request: "qw" })).toBe("en");
  } finally {
    await engine.shutdown();
  }
});
