import { it, expect } from "vitest";
import { normalizedLiveEvent } from "../src/adapters/live.js";
import {
  COLORI_AI,
  coloreAI,
  zonaInput,
  visibile,
} from "../src/cli/schermo.js";

it("mostra i passaggi di Codex senza esporre l'output dei comandi", () => {
  const comando = normalizedLiveEvent("codex", {
    type: "item.completed",
    item: {
      type: "command_execution",
      command: "/bin/zsh -lc 'cat ricetta.txt'",
      aggregated_output: "contenuto riservato",
    },
  });
  expect(comando.type).toBe("azione");
  expect(comando.text).toContain("cat ricetta.txt");
  expect(comando.text).not.toContain("contenuto riservato");

  const modifica = normalizedLiveEvent("codex", {
    type: "item.completed",
    item: {
      type: "file_change",
      changes: [{ path: "/lungo/percorso/app.mjs", kind: "modified" }],
    },
  });
  expect(modifica.type).toBe("azione");
  expect(modifica.text).toContain("app.mjs");
  expect(modifica.text).not.toContain("/lungo/percorso");
});

it("mostra gli strumenti di Claude, e il testo resta un messaggio", () => {
  const strumento = normalizedLiveEvent("claude", {
    type: "assistant",
    message: {
      content: [
        {
          type: "tool_use",
          name: "Read",
          input: { file_path: "/x/y/app.mjs" },
        },
      ],
    },
  });
  expect(strumento.type).toBe("azione");
  expect(strumento.text).toBe("legge  app.mjs");

  const testo = normalizedLiveEvent("claude", {
    type: "assistant",
    message: { content: [{ type: "text", text: "Fatto." }] },
  });
  expect(testo.type).toBe("message");
});

it("ogni AI ha il suo colore e la zona di input lo usa", () => {
  const codici = [COLORI_AI.claude, COLORI_AI.codex, COLORI_AI.antigravity];
  expect(new Set(codici).size).toBe(3);
  const zona = zonaInput("claude");
  expect(zona.azioni).toContain("claude");
  expect(visibile(zona.cima)).toBeLessThanOrEqual(100);
  expect(zona.invito).toContain("›");
  // Fuori da un terminale i colori spariscono: l'output resta leggibile in un
  // file di log o in una pipe.
  expect(coloreAI("claude")("x")).toBe("x");
  expect(zona.cima).not.toContain("\u001b");
});
