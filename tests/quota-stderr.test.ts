import { it, expect } from "vitest";
import { quotaSuErrore } from "../src/adapters/live.js";

// Lo stderr di un CLI non è prosa di un provider: sono stack trace, output di
// test e nomi di file. Se un «rate-limit.ts» basta a dichiarare la quota
// esaurita, Continuity blocca per ore un abbonamento perfettamente attivo.
it("non scambia per quota lo stderr normale di un progetto", () => {
  for (const riga of [
    "ESLint: maximum warning limit reached",
    "error: memory limit reached while compiling",
    "  at RateLimiter.check (/src/rate-limit.ts:42:11)",
    "FAIL tests/rate-limit.test.ts",
    "npm WARN deprecated: the counter resets in 3 days",
    "Error: connection reset by peer",
    "",
  ])
    expect(quotaSuErrore(riga), riga).toBe(false);
});

it("riconosce le dichiarazioni esplicite di limite anche su stderr", () => {
  for (const riga of [
    "You've hit your session limit · resets 1:30pm",
    "Claude usage limit reached",
    "quota exceeded for this account",
    "You are out of credits",
  ])
    expect(quotaSuErrore(riga), riga).toBe(true);
});

// Un 429 o un limite interno non sono la fine dell'abbonamento: compaiono in
// riconnessioni riuscite e in limiti del CLI (revisione del 7 ottobre).
it("non scambia per quota una riconnessione o un limite interno", () => {
  for (const riga of [
    '{"type":"error","error":{"type":"rate_limit_error"}}',
    "429 Too Many Requests",
    "Reconnecting... 2/5 (stream error: 429 Too Many Requests)",
    "agent thread limit reached",
    "output size limit reached",
  ])
    expect(quotaSuErrore(riga), riga).toBe(false);
});
