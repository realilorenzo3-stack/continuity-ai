import { it, expect } from "vitest";
import { readFileSync } from "node:fs";

const engine = readFileSync("src/core/engine.ts", "utf8");

// Il motivo per cui un turno si è interrotto appartiene a quel turno. Restando
// acceso, faceva annunciare «Turno interrotto» su turni riusciti e spegneva in
// silenzio la verifica indipendente per tutto il resto della sessione.
it("azzera il motivo dell'interruzione all'inizio di ogni turno", () => {
  const corpo = engine.slice(
    engine.indexOf("r.quotaDetected = false;"),
    engine.indexOf('this.event(r, "turn.started"'),
  );
  expect(corpo).toContain("r.uscitaFallita = undefined;");
});

// Se l'avvio fallisce dopo che lo stato è già STARTING, senza blocco la
// sessione resta occupata per sempre: non si riapre e non si cancella.
it("blocca la run se l'avvio del turno fallisce", () => {
  const dopo = engine.slice(engine.indexOf('this.event(r, "turn.started"'));
  const blocco = dopo.slice(0, dopo.indexOf("return this.run(id);"));
  expect(blocco).toContain("try {");
  expect(blocco).toContain("this.block(id, e);");
});
