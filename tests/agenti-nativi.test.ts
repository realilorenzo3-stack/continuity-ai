import { it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  agentiClaude,
  liveCommand,
  normalizedLiveEvent,
} from "../src/adapters/live.js";

const dirs: string[] = [];
afterEach(() =>
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })),
);

// Senza sessione su disco i sotto-agenti di Codex non nascono, e il modello
// racconta una delega mai avvenuta: sui progetti il flag non ci deve essere.
it("sui progetti Codex tiene la sessione, nelle prove no", () => {
  expect(
    liveCommand("codex", "/tmp/w", undefined, undefined, "project").args,
  ).not.toContain("--ephemeral");
  expect(
    liveCommand("codex", "/tmp/w", undefined, undefined, "fixture").args,
  ).toContain("--ephemeral");
});

it("Claude sul progetto ha tutti i suoi strumenti, terminale compreso, dentro la sandbox", () => {
  const args = liveCommand(
    "claude",
    "/tmp/w",
    undefined,
    undefined,
    "project",
  ).args;
  // Nessuna lista ristretta: Agent, Bash, skill e il resto restano di Claude.
  expect(args).not.toContain("--tools");
  expect(args).not.toContain("--disable-slash-commands");
  const impostazioni = JSON.parse(args[args.indexOf("--settings") + 1]);
  expect(impostazioni.sandbox).toMatchObject({
    enabled: true,
    autoAllowBashIfSandboxed: true,
    allowUnsandboxedCommands: false,
  });
  expect(args[args.indexOf("--allowedTools") + 1].split(",")).toContain("Bash");
});

// Un sotto-agente lavora e riferisce al suo genitore: il suo testo non è la
// risposta del turno, e mescolarlo la spaccerebbe per tale.
it("il testo di un sotto-agente non diventa la risposta dell'AI", () => {
  const parziale = normalizedLiveEvent("claude", {
    type: "stream_event",
    parent_tool_use_id: "toolu_1",
    event: {
      type: "content_block_delta",
      delta: { type: "text_delta", text: "interno" },
    },
  });
  expect(parziale.type).toBe("unknown");
  const testo = normalizedLiveEvent("claude", {
    type: "assistant",
    parent_tool_use_id: "toolu_1",
    message: { content: [{ type: "text", text: "rapporto interno" }] },
  });
  expect(testo.type).toBe("unknown");
  // Il suo lavoro però si vede.
  const azione = normalizedLiveEvent("claude", {
    type: "assistant",
    parent_tool_use_id: "toolu_1",
    message: {
      content: [
        {
          type: "tool_use",
          name: "Read",
          input: { file_path: "/w/index.html" },
        },
      ],
    },
  });
  expect(azione).toMatchObject({ type: "azione" });
  expect(azione.text).toContain("index.html");
});

it("la delega dell'AI principale compare a schermo", () => {
  const e = normalizedLiveEvent("claude", {
    type: "assistant",
    message: {
      content: [
        {
          type: "tool_use",
          name: "Agent",
          input: {
            description: "Revisione accessibilità",
            subagent_type: "general-purpose",
          },
        },
      ],
    },
  });
  expect(e.type).toBe("azione");
  expect(e.text).toContain("delega");
  expect(e.text).toContain("Revisione accessibilità");
});

it("gli agenti del progetto arrivano a Claude con gli strumenti della sessione (terminale nella sandbox)", () => {
  const work = mkdtempSync(join(tmpdir(), "continuity-agenti-claude-"));
  dirs.push(work);
  mkdirSync(join(work, ".claude", "agents"), { recursive: true });
  writeFileSync(
    join(work, ".claude", "agents", "revisore.md"),
    "---\nname: revisore\ndescription: Rilegge prima della consegna\ntools: Read, Grep, Bash\nmodel: sonnet\n---\nRileggi le modifiche e segnala i rischi.",
  );
  // Un file senza intestazione non è un agente.
  writeFileSync(join(work, ".claude", "agents", "note.md"), "appunti sparsi");
  const args = agentiClaude(work);
  expect(args[0]).toBe("--agents");
  const agenti = JSON.parse(args[1]);
  expect(Object.keys(agenti)).toEqual(["revisore"]);
  expect(agenti.revisore.prompt).toContain("rischi");
  expect(agenti.revisore.tools).toEqual(["Read", "Grep", "Bash"]);
  expect(agenti.revisore.model).toBe("sonnet");
  expect(agentiClaude(join(work, "inesistente"))).toEqual([]);
});
