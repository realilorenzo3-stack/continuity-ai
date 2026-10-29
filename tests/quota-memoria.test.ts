import { it, expect } from "vitest";
import { Engine } from "../src/core/engine.js";
import { orarioRicarica, RICARICA_ORE } from "../src/adapters/live.js";

const motore = Object.create(Engine.prototype) as any;
const ORA = 3600000;

it("usa i tempi di ricarica degli abbonamenti: Claude 4 ore, Codex 5", () => {
  expect(RICARICA_ORE.claude).toBe(4);
  expect(RICARICA_ORE.codex).toBe(5);
  const run: any = { providers: ["codex", "claude"], agent: "codex" };
  motore.segnaEsaurito(run, "claude");
  const attesa = new Date(run.esauriti.claude.riprendi).getTime() - Date.now();
  expect(attesa).toBeGreaterThan(3.9 * ORA);
  expect(attesa).toBeLessThan(4.1 * ORA);
});

it("l'orario detto dal provider batte la stima", () => {
  const messaggio =
    "You've hit your usage limit. Upgrade to Pro or try again at 11:24 PM.";
  const adesso = new Date("2026-09-23T20:00:00");
  const quando = orarioRicarica(messaggio, adesso)!;
  expect(quando.getHours()).toBe(23);
  expect(quando.getMinutes()).toBe(24);

  // L'orario va provato rispetto ad adesso: una data fissa nel passato viene
  // giustamente rifiutata, perché un provider non torna disponibile ieri.
  const fraDueOre = new Date(Date.now() + 2 * ORA);
  const run: any = { providers: ["codex"], agent: "codex" };
  motore.segnaEsaurito(run, "codex", fraDueOre.toISOString());
  expect(run.esauriti.codex.riprendi).toBe(fraDueOre.toISOString());
  // Cinque ore sarebbero state molto oltre l'orario vero.
  expect(new Date(run.esauriti.codex.riprendi).getTime()).toBeLessThan(
    Date.now() + 5 * ORA,
  );

  // Un orario inutilizzabile non deve escludere il provider per sempre: si
  // ricade sulla stima invece di renderlo irraggiungibile.
  const altra: any = { providers: ["codex"], agent: "codex" };
  motore.segnaEsaurito(altra, "codex", "non-una-data");
  expect(motore.disponibile(altra, "codex")).toBe(false);
  const fra = new Date(altra.esauriti.codex.riprendi).getTime() - Date.now();
  expect(fra).toBeGreaterThan(4 * ORA);
  expect(fra).toBeLessThan(6 * ORA);
});

it("un orario già passato vale per domani", () => {
  const quando = orarioRicarica(
    "try again at 9:00 AM",
    new Date("2026-09-23T20:00:00"),
  )!;
  expect(quando.getDate()).toBe(24);
  expect(quando.getHours()).toBe(9);
});

it("chi è senza crediti resta fuori finché non torna, poi rientra", () => {
  const run: any = { providers: ["codex", "claude"], agent: "codex" };
  expect(motore.disponibile(run, "codex")).toBe(true);
  motore.segnaEsaurito(run, "codex");
  expect(motore.disponibile(run, "codex")).toBe(false);
  expect(motore.disponibile(run, "claude")).toBe(true);
  run.esauriti.codex.riprendi = new Date(Date.now() - 1000).toISOString();
  expect(motore.disponibile(run, "codex")).toBe(true);
});

it("la rotazione salta chi è senza crediti e sa quando torna il primo", () => {
  const run: any = {
    providers: ["codex", "claude", "antigravity"],
    agent: "codex",
    triedThisTurn: ["codex"],
  };
  motore.segnaEsaurito(run, "claude");
  expect(motore.nextProvider(run)).toBe("antigravity");
  motore.segnaEsaurito(run, "antigravity");
  expect(motore.nextProvider(run)).toBeUndefined();
  const prossima = motore.prossimaRicarica(run);
  // Claude (4 ore) torna prima di Antigravity (5 ore di prudenza).
  expect(prossima).toBeLessThan(Date.now() + 4.1 * ORA);
});

it("la sequenza si cambia in sessione e rifiuta nomi o ripetizioni sbagliate", () => {
  const eventi: string[] = [];
  const finto = Object.create(Engine.prototype) as any;
  const run: any = {
    id: "x",
    session: true,
    providers: ["codex", "claude"],
    agent: "codex",
  };
  finto.run = () => run;
  finto.event = (_r: any, _t: string, m: string) => eventi.push(m);
  finto.impostaSequenza("x", ["claude", "codex"]);
  expect(run.providers).toEqual(["claude", "codex"]);
  expect(eventi[0]).toContain("claude → codex");
  expect(() => finto.impostaSequenza("x", ["gpt"])).toThrow(/non supportata/);
  expect(() => finto.impostaSequenza("x", ["claude", "claude"])).toThrow(
    /ripetizioni/,
  );
  expect(() => finto.impostaSequenza("x", [])).toThrow(/almeno un/);
});

it("una sessione in pausa altrove non impedisce di lavorare in un'altra cartella", () => {
  const motore2 = Object.create(Engine.prototype) as any;
  const elenco = [
    { id: "a", state: "PAUSED", session: true, project: { root: "/tmp/uno" } },
  ];
  motore2.store = { list: () => elenco };
  const bloccante = () =>
    motore2.store
      .list()
      .find(
        (r: any) =>
          !["SUCCEEDED", "CANCELLED", "FAILED"].includes(r.state) &&
          r.state !== "PAUSED",
      );
  expect(bloccante()).toBeUndefined();
  // Un lavoro davvero in corso invece blocca, per non avere due writer.
  elenco.push({
    id: "b",
    state: "RUNNING",
    session: true,
    project: { root: "/tmp/due" },
  });
  expect(bloccante()?.id).toBe("b");
});

it("riconosce il limite di Claude dal suo evento, con l'orario esatto", async () => {
  const { normalizedLiveEvent } = await import("../src/adapters/live.js");
  const reset = Math.floor(Date.now() / 1000) + 4 * 3600;
  const esaurito = normalizedLiveEvent("claude", {
    type: "rate_limit_event",
    rate_limit_info: {
      status: "rejected",
      resetsAt: reset,
      rateLimitType: "five_hour",
    },
  });
  expect(esaurito.type).toBe("quota");
  expect(new Date(esaurito.ricaricaA!).getTime()).toBe(reset * 1000);

  // Finché è dentro il limite, l'evento non deve far passare il lavoro.
  expect(
    normalizedLiveEvent("claude", {
      type: "rate_limit_event",
      rate_limit_info: { status: "allowed", resetsAt: reset },
    }).type,
  ).toBe("unknown");

  // Anche il messaggio d'errore finale vale come segnale di quota.
  expect(
    normalizedLiveEvent("claude", {
      type: "result",
      is_error: true,
      result: "Claude usage limit reached",
    }).type,
  ).toBe("quota");
  // Un errore qualsiasi invece resta un errore, non un passaggio.
  expect(
    normalizedLiveEvent("claude", {
      type: "result",
      is_error: true,
      result: "connection reset",
    }).type,
  ).toBe("error");
});

it("il pacchetto può essere indirizzato anche a Codex", async () => {
  const { handoffSchema } = await import("../src/handoff/schema.js");
  const campo = handoffSchema.shape.toAgent;
  expect(campo.safeParse("codex").success).toBe(true);
  expect(campo.safeParse("gpt").success).toBe(false);
});
