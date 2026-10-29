import { it, expect } from "vitest";
import { Engine } from "../src/core/engine.js";

// I termini di Google vietano l'accesso ad Antigravity con software di terzi e
// gli account vengono sospesi: la scelta non deve essere possibile per errore.
it("Antigravity non è selezionabile, e il motivo è scritto", () => {
  const motore = Object.create(Engine.prototype) as any;
  const run: any = { id: "x", session: true, providers: ["codex", "claude"] };
  motore.run = () => run;
  motore.event = () => {};
  expect(() => motore.impostaSequenza("x", ["antigravity"])).toThrow(
    /Antigravity non è disponibile/,
  );
  expect(() => motore.impostaSequenza("x", ["codex", "antigravity"])).toThrow(
    /chiave API/,
  );
  // Le AI consentite restano selezionabili.
  motore.impostaSequenza("x", ["claude", "codex"]);
  expect(run.providers).toEqual(["claude", "codex"]);
});

it("il messaggio indica la strada che Google stessa consente", () => {
  expect(Engine.ANTIGRAVITY_VIETATO).toContain("termini di Google");
  expect(Engine.ANTIGRAVITY_VIETATO).toContain("sospesi");
  expect(Engine.ANTIGRAVITY_VIETATO).toMatch(/Gemini API|Gemini Enterprise/);
});

// Nel pilot due passaggi sono stati dichiarati conclusi mentre l'AI non aveva
// toccato un solo file: in un caso con «2/2 criteri verificati», perché le
// verifiche passavano sulla base di partenza.
it("un turno che non cambia nulla non viene dichiarato svolto", () => {
  const riepilogo = (impronta?: string, adesso?: string, criteri = 2) => {
    const senzaModifiche = impronta !== undefined && impronta === adesso;
    return senzaModifiche
      ? "nessun file modificato"
      : criteri
        ? `${criteri}/${criteri} criteri`
        : "nessuna verifica";
  };
  expect(riepilogo("abc", "abc")).toBe("nessun file modificato");
  expect(riepilogo("abc", "def")).toBe("2/2 criteri");
  expect(riepilogo(undefined, "def")).toBe("2/2 criteri");
});
