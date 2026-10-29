import { it, expect } from "vitest";
import { liveCommand, normalizedLiveEvent, titoloPensiero } from "../src/adapters/live.js";
import { providerNoto } from "../src/core/provider.js";

// Sessione di Lorenzo del 14 ottobre: Codex pensava per minuti senza nulla a
// schermo, con il ragionamento forzato ad «alto» mentre lui lo tiene a «low».
it("il ragionamento di Codex arriva riassunto su una riga", () => {
  const e = normalizedLiveEvent("codex", {
    type: "item.completed",
    item: { type: "reasoning", text: "**Planning the five games**\n\nI will create…" },
  });
  expect(e).toEqual({ type: "pensiero", text: "Planning the five games" });
  expect(titoloPensiero("Scelgo la struttura dei file. Poi…")).toBe("Scelgo la struttura dei file. Poi…");
});

it("un comando appena partito è un'attività in corso, non una riga del registro", () => {
  const e = normalizedLiveEvent("codex", {
    type: "item.started",
    item: { type: "command_execution", command: "/bin/zsh -lc 'npm test'" },
  });
  expect(e).toEqual({ type: "attivita", text: "esegue  npm test" });
});

it("anche il ragionamento di Claude arriva riassunto", () => {
  const e = normalizedLiveEvent("claude", {
    type: "assistant",
    message: { content: [{ type: "thinking", thinking: "Devo leggere prima i test.\nPoi…" }] },
  });
  expect(e).toEqual({ type: "pensiero", text: "Devo leggere prima i test." });
});

it("Codex: riassunti del ragionamento con OpenAI, nessun livello forzato se non scelto", () => {
  const { args } = liveCommand("codex", "/w", undefined, undefined, "project");
  expect(args).toContain('model_reasoning_summary="auto"');
  expect(args.some((a) => a.startsWith("model_reasoning_effort"))).toBe(false);
  const locale = liveCommand("codex", "/w", undefined, undefined, "project", undefined, undefined, {
    profilo: providerNoto("ollama"),
  });
  expect(locale.args).not.toContain('model_reasoning_summary="auto"');
  const scelto = liveCommand("codex", "/w", undefined, undefined, "project", undefined, undefined, {
    ragionamento: "basso",
  });
  expect(scelto.args).toContain('model_reasoning_effort="low"');
});

it("Claude: nessun --effort se il livello non è stato scelto", () => {
  const { args } = liveCommand("claude", "/w", undefined, undefined, "project");
  expect(args).not.toContain("--effort");
});
