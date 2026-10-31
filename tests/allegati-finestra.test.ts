// La finestra per scegliere i file da allegare (31 ottobre): su Windows
// partiva zenity, quella di Linux, e /allega non faceva nulla.
import { it, expect, vi } from "vitest";

vi.mock("../piattaforme/macos/allegati.js", () => ({ scegliFile: async () => ["mac"] }));
vi.mock("../piattaforme/linux-windows/allegati.js", () => ({ scegliFile: async () => ["linux"] }));
vi.mock("../piattaforme/windows/allegati.js", () => ({ scegliFile: async () => ["windows"] }));

import { nomeFile, scegliDalFinder } from "../src/tui/allegati.js";
import { senzaCrediti } from "../src/tui/comandi.js";

it("ogni sistema apre la sua finestra: Finder, zenity, «Apri» di Windows", async () => {
  expect(await scegliDalFinder("mac")).toEqual(["mac"]);
  expect(await scegliDalFinder("linux")).toEqual(["linux"]);
  expect(await scegliDalFinder("wsl")).toEqual(["linux"]);
  expect(await scegliDalFinder("windows")).toEqual(["windows"]);
});

it("il nome dell'allegato si legge con «/» e con «\\»", () => {
  expect(nomeFile("/Users/io/Nota finale.md")).toBe("Nota finale.md");
  expect(nomeFile("C:\\Users\\io\\Nota finale.md")).toBe("Nota finale.md");
  expect(nomeFile("C:\\Users\\io\\progetto\\")).toBe("progetto");
});

it("un'AI senza crediti lo dice, con l'orario in cui torna", () => {
  const adesso = Date.parse("2026-10-31T10:00:00Z");
  const run = {
    esauriti: {
      codex: { riprendi: "2026-10-31T11:37:00Z" },
      groq: { credito: true },
      claude: { riprendi: "2026-10-31T09:00:00Z" },
    },
  };
  expect(senzaCrediti(run, "codex", adesso)).toMatch(/^senza crediti · torna alle \d\d:37$/);
  expect(senzaCrediti(run, "groq", adesso)).toBe("senza credito");
  // L'orario è passato: può di nuovo lavorare.
  expect(senzaCrediti(run, "claude", adesso)).toBeUndefined();
  expect(senzaCrediti(run, "gemini", adesso)).toBeUndefined();
});
