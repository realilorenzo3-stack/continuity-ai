import { it, expect } from "vitest";
import { quotaExhausted, normalizedLiveEvent } from "../src/adapters/live.js";

// Le frasi con cui i provider dichiarano davvero il limite, raccolte dalle
// sessioni reali. Quella di Claude non contiene la parola «usage»: per questo
// non veniva riconosciuta, e il lavoro si fermava invece di passare al
// successore — il caso per cui Continuity esiste.
const FRASI_VERE = [
  "You've hit your session limit · resets 1:30pm (Europe/Rome)",
  "Claude usage limit reached",
  "You've hit your usage limit. Upgrade to Pro or try again at 11:24 PM.",
  "You have hit your rate limit",
  "quota exceeded for this account",
  "You are out of credits",
];

it("riconosce le formulazioni vere del limite, non solo quelle immaginate", () => {
  for (const frase of FRASI_VERE)
    expect(quotaExhausted(frase), frase).toBe(true);
});

it("non scambia per limite un testo qualunque che parla di limiti", () => {
  for (const frase of [
    "connection reset by peer",
    "Il documento descrive il limite di velocità",
    "the function has no limit on its arguments",
    "disk full while writing",
    "",
  ])
    expect(quotaExhausted(frase), frase).toBe(false);
});

it("il messaggio finale di Claude che dichiara il limite è quota, non errore", () => {
  const vero = "You've hit your session limit · resets 1:30pm (Europe/Rome)";
  const evento = normalizedLiveEvent("claude", {
    type: "result",
    is_error: true,
    result: vero,
  });
  expect(evento.type).toBe("quota");
  // Il motivo resta visibile: chi legge deve capire cosa è successo.
  expect(evento.text).toContain("session limit");
  // Un errore vero resta un errore, altrimenti si ruoterebbe per nulla.
  expect(
    normalizedLiveEvent("claude", {
      type: "result",
      is_error: true,
      result: "connection reset by peer",
    }).type,
  ).toBe("error");
});

it("l'evento strutturato di Claude porta l'orario esatto del ritorno", () => {
  const reset = Math.floor(Date.now() / 1000) + 14000;
  const evento = normalizedLiveEvent("claude", {
    type: "rate_limit_event",
    rate_limit_info: {
      status: "rejected",
      resetsAt: reset,
      rateLimitType: "five_hour",
    },
  });
  expect(evento.type).toBe("quota");
  expect(new Date(evento.ricaricaA!).getTime()).toBe(reset * 1000);
  // Un avviso di soglia non è un esaurimento.
  expect(
    normalizedLiveEvent("claude", {
      type: "rate_limit_event",
      rate_limit_info: { status: "allowed_warning", resetsAt: reset },
    }).type,
  ).not.toBe("quota");
});

it("un orario di ricarica inutilizzabile non cancella l'evento di quota", async () => {
  const { istanteRicarica, normalizedLiveEvent } = await import(
    "../src/adapters/live.js"
  );
  const fraTreOre = Math.floor(Date.now() / 1000) + 10800;
  // Secondi, millisecondi e stringa ISO portano allo stesso istante.
  expect(istanteRicarica(fraTreOre)).toBe(
    new Date(fraTreOre * 1000).toISOString(),
  );
  expect(istanteRicarica(fraTreOre * 1000)).toBe(
    new Date(fraTreOre * 1000).toISOString(),
  );
  expect(istanteRicarica(new Date(fraTreOre * 1000).toISOString())).toBe(
    new Date(fraTreOre * 1000).toISOString(),
  );
  // Valori inutilizzabili: nessun orario, ma nessuna eccezione.
  for (const brutto of ["domani", NaN, null, undefined, 1, 99999999999999])
    expect(istanteRicarica(brutto)).toBeUndefined();

  // E soprattutto: l'evento resta una quota, invece di sparire.
  const evento = normalizedLiveEvent("claude", {
    type: "rate_limit_event",
    rate_limit_info: { status: "rejected", resetsAt: "2026-13-45T99:99:99Z" },
  });
  expect(evento.type).toBe("quota");
  expect(evento.ricaricaA).toBeUndefined();
});

it("il motivo dell'errore viene trovato dovunque il provider lo metta", async () => {
  const { testoErrore, quotaExhausted } = await import(
    "../src/adapters/live.js"
  );
  const limite = "You've hit your session limit";
  for (const forma of [
    { error: { message: limite } },
    { error: limite },
    { message: limite },
    { result: limite },
    { result: { message: limite } },
    { item: { message: limite } },
  ])
    expect(quotaExhausted(testoErrore(forma)), JSON.stringify(forma)).toBe(
      true,
    );
  expect(testoErrore({})).toBe("");
});

it("riconosce anche le altre formulazioni dei limiti", async () => {
  const { quotaExhausted } = await import("../src/adapters/live.js");
  for (const frase of [
    "You've hit your 5h limit",
    "You've reached your weekly limit",
    "You've used up your plan's limit",
    "Claude AI usage limit reached",
    "5-hour limit reached ∙ resets 3pm",
  ])
    expect(quotaExhausted(frase), frase).toBe(true);
  for (const frase of [
    "429 Too Many Requests",
    "rate_limit_error",
    "Reconnecting... 1/5 (429 Too Many Requests)",
    "agent thread limit reached",
  ])
    expect(quotaExhausted(frase), frase).toBe(false);
});
