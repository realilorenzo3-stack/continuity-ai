import { it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Engine } from "../src/core/engine.js";
import { Store } from "../src/persistence/store.js";
import { projectPrompt } from "../src/adapters/live.js";

const dirs: string[] = [];
afterEach(() =>
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })),
);
const motore = () => {
  const d = mkdtempSync(join(tmpdir(), "continuity-lunga-"));
  dirs.push(d);
  return new Engine(new Store(d));
};

// Una specifica di quindici pagine è il caso che il prodotto deve reggere: era
// ridotta a 600 caratteri nella memoria della sessione, quindi chi subentrava
// dopo un cambio di AI non sapeva più cosa gli fosse stato chiesto.
it("tiene la richiesta dell'utente, non i suoi primi 600 caratteri", () => {
  const engine = motore();
  const specifica = "SEZIONE 1\n" + "x".repeat(14000) + "\nSEZIONE 17 RESOCONTO";
  const r: any = {};
  engine.remember(r, "utente", specifica);
  expect(r.transcript[0].text.length).toBeGreaterThan(14000);
  expect(r.transcript[0].text).toContain("SEZIONE 17 RESOCONTO");
});

// Il mandato iniziale non deve mai uscire dalla conversazione: è ciò che
// permette all'AI che subentra di capire il lavoro senza la chat precedente.
it("non butta mai la prima richiesta, per quanti turni passino", () => {
  const engine = motore();
  const r: any = {};
  engine.remember(r, "utente", "MANDATO ORIGINALE del lavoro");
  for (let i = 0; i < 80; i++) {
    engine.remember(r, "ai", "risposta " + i, "codex");
    engine.remember(r, "utente", "richiesta " + i);
  }
  expect(r.transcript[0].text).toContain("MANDATO ORIGINALE");
  expect(r.transcript.length).toBeLessThanOrEqual(42);
  // E l'ultima richiesta è comunque l'ultima della lista.
  expect(r.transcript[r.transcript.length - 1].text).toContain("richiesta 79");
});

// Il prompt che arriva al provider deve contenere la richiesta per intero.
it("porta la richiesta intera nel prompt del provider", () => {
  const richiesta = "PRIMA RIGA\n" + "y".repeat(9000) + "\nULTIMA ISTRUZIONE";
  const prompt = projectPrompt({
    role: "writer",
    goal: "Obiettivo",
    work: "/tmp/w",
    criteria: [],
    request: richiesta,
  });
  expect(prompt).toContain("ULTIMA ISTRUZIONE");
});
