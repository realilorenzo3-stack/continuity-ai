// I percorsi di Windows a schermo (collaudo del 31 ottobre): il piè tagliava
// il percorso a metà di un nome, e le modifiche dell'AI mostravano il
// percorso intero della copia di lavoro invece del nome del file.
import { it, expect } from "vitest";
import { abbrevia, percorsoBreve } from "../../src/tui/app.js";
import { normalizedLiveEvent } from "../../src/adapters/live.js";

it("il percorso nel piè: ~ per la cartella personale, poi si tolgono le cartelle centrali, anche con «\\»", () => {
  const casa = "C:\\Users\\anna";
  expect(percorsoBreve("C:\\Users\\anna\\Desktop\\sito", 40, casa)).toBe("~\\Desktop\\sito");
  expect(percorsoBreve("C:\\Users\\anna\\lavori\\clienti\\rossi\\sito-nuovo", 24, casa)).toBe("~\\lavori\\…\\sito-nuovo");
  expect(percorsoBreve("D:\\progetti\\molto\\annidati\\qui\\app", 14, casa)).toBe("D:\\…\\app");
  expect(abbrevia("C:\\Users\\anna\\Desktop\\sito", 40, casa)).toBe("~\\Desktop\\sito");
  // Sul Mac come prima.
  expect(percorsoBreve("/Users/anna/lavori/clienti/rossi/sito", 22, "/Users/anna")).toBe("~/lavori/…/sito");
});

it("le azioni dell'AI mostrano il nome del file anche con un percorso di Windows", () => {
  const azione = normalizedLiveEvent("claude", {
    type: "assistant",
    message: {
      content: [
        {
          type: "tool_use",
          name: "Edit",
          input: { file_path: "C:\\Users\\anna\\AppData\\Local\\Continuity\\runs\\x\\worktree\\somma.mjs" },
        },
      ],
    },
  });
  expect(azione.text).toMatch(/modifica\s+somma\.mjs$/);
  const codex = normalizedLiveEvent("codex", {
    type: "item.completed",
    item: { type: "file_change", changes: [{ path: "C:\\w\\worktree\\a.txt" }, { path: "/w/b.txt" }] },
  });
  expect(codex.text).toBe("modifica  a.txt, b.txt");
});
