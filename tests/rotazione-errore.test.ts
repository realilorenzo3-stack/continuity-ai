import { it, expect, vi } from "vitest";
import { Engine } from "../src/core/engine.js";
import { assertTransition } from "../src/core/state.js";

// La regressione: la quota era riconosciuta, ma nello stesso turno era arrivato
// anche un evento di errore. La verifica veniva saltata e con essa il passaggio
// di stato che precede il pacchetto di handoff, così la rotazione — cioè la
// funzione centrale del prodotto — falliva proprio quando serviva.
function motoreMinimo(run: any, tracce: string[]) {
  const m = Object.create(Engine.prototype) as any;
  m.busy = new Set();
  m.parziali = new Map();
  m.store = { list: () => [run], root: "/tmp" };
  m.run = () => run;
  m.event = (_r: any, tipo: string) => tracce.push(tipo);
  m.segnaEsaurito = () => {};
  m.nextProvider = () => "codex";
  m.quiesce = async () => {};
  m.checkpoint = () => tracce.push("checkpoint");
  m.verifyProject = () => tracce.push("verifica");
  m.handoff = () => tracce.push("handoff");
  m.start = async () => tracce.push("avvio successore");
  m.prossimaRicarica = () => undefined;
  return m;
}

it("la rotazione verifica anche quando il turno ha registrato un errore", async () => {
  const tracce: string[] = [];
  const run: any = {
    id: "r1",
    session: true,
    project: { root: "/tmp/p", verify: [] },
    providers: ["claude", "codex"],
    agent: "claude",
    quotaDetected: true,
    providerError: true,
  };
  await motoreMinimo(run, tracce).rotate("r1", "Quota del provider esaurita");

  // La verifica deve precedere il pacchetto: è anche il passaggio di stato.
  expect(tracce).toContain("verifica");
  expect(tracce.indexOf("verifica")).toBeLessThan(tracce.indexOf("handoff"));
  expect(tracce).toContain("avvio successore");
  expect(run.agent).toBe("codex");
  expect(run.switches).toBe(1);
  // I segnali del turno precedente non si trascinano al successore.
  expect(run.providerError).toBe(false);
  expect(run.quotaDetected).toBe(false);
});

it("lo stato attraversa la verifica prima del pacchetto di handoff", () => {
  // Saltare la verifica rendeva illegale il passaggio successivo.
  expect(() => assertTransition("SNAPSHOTTING", "HANDOFF_READY")).toThrow(
    /illegale/,
  );
  expect(() => assertTransition("SNAPSHOTTING", "VERIFYING")).not.toThrow();
  expect(() => assertTransition("VERIFYING", "HANDOFF_READY")).not.toThrow();
});
