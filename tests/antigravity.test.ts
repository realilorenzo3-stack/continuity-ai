import { expect, it } from "vitest";
import {
  AntigravityStream,
  antigravityInput,
  antigravityCommand,
  prepareAntigravityProfile,
  validateAntigravityProfile,
} from "../src/adapters/antigravity.js";
import { livePrompt } from "../src/adapters/live.js";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const init = { event: "init", init: { permission_mode: "request-review" } };
it("trasporta RHP e testo multilinea come un solo messaggio stdin", () => {
  const prompt =
    'Continua\n{"goal":"carrello","snapshot":"abc"}\nNon ricominciare';
  const input = antigravityInput(prompt);
  expect(input.trim().split("\n")).toHaveLength(1);
  expect(JSON.parse(input).message.content).toBe(prompt);
  expect(antigravityCommand().args).toContain("--sandbox");
  expect(antigravityCommand().args).not.toContain(
    "--dangerously-skip-permissions",
  );
  expect(antigravityCommand().args).not.toContain("always-proceed");
});
it("distingue dichiarazione SUCCESS dalla verifica indipendente", () => {
  const s = new AntigravityStream();
  s.receive(init);
  expect(
    s.receive({ event: "result", result: { status: "SUCCESS" } }).type,
  ).toBe("reported");
  expect(s.end()).toBeNull();
});
it("rifiuta stream troncato, risultato duplicato e permessi inattesi", () => {
  const s = new AntigravityStream();
  s.receive(init);
  expect(s.end()).not.toBeNull();
  s.receive({ event: "result", result: { status: "SUCCESS" } });
  expect(
    s.receive({ event: "result", result: { status: "SUCCESS" } }).type,
  ).toBe("error");
  expect(s.end()).not.toBeNull();
  for (const mode of ["always-proceed", "accept-edits"])
    expect(
      new AntigravityStream().receive({
        event: "init",
        init: { permission_mode: mode },
      }).type,
    ).toBe("error");
});
it("auth reale redatta non diventa quota e non espone il testo errore", () => {
  const s = new AntigravityStream();
  const result = s.receive({
    event: "result",
    result: {
      status: "ERROR",
      error: "authentication failed or timed out access_token=secret",
    },
  });
  expect(result.type).toBe("error");
  expect(JSON.stringify(result)).not.toContain("secret");
  expect(s.end()).not.toBeNull();
});
it("un errore tool resta fallimento anche se seguito da SUCCESS", () => {
  const s = new AntigravityStream();
  s.receive(init);
  s.receive({
    event: "step_update",
    step_update: { tool_info: { error: { type: "permission_denied" } } },
  });
  expect(
    s.receive({ event: "result", result: { status: "SUCCESS" } }).type,
  ).toBe("error");
  expect(s.end()).not.toBeNull();
});
it("testo del modello su crediti non viene trattato come errore provider", () => {
  const s = new AntigravityStream();
  s.receive(init);
  expect(
    s.receive({
      event: "step_update",
      step_update: {
        step_type: "agent_response",
        text_delta: "quota exhausted",
      },
    }).type,
  ).toBe("message");
});

it("un errore di percorso non blocca il turno, una negazione di permessi sì", () => {
  const recoverable = new AntigravityStream();
  recoverable.receive(init);
  expect(
    recoverable.receive({
      event: "step_update",
      step_update: {
        tool_info: {
          error: "invalid tool call error (invalid_args) failed to read file",
        },
      },
    }).type,
  ).toBe("reported");
  expect(
    recoverable.receive({ event: "result", result: { status: "SUCCESS" } })
      .type,
  ).toBe("reported");
  expect(recoverable.end()).toBeNull();
  const denied = new AntigravityStream();
  denied.receive(init);
  const event = denied.receive({
    event: "step_update",
    step_update: {
      tool_info: {
        error:
          'user denied permission for read_file("/Users/tester/Continuity/runs/abc/snapshots/def.json")',
      },
    },
  });
  expect(event.type).toBe("error");
  expect(JSON.stringify(event)).not.toContain("snapshots");
  expect(denied.end()).not.toBeNull();
});

it("indica al successore il percorso assoluto e vieta i dati interni di Continuity", () => {
  const prompt = livePrompt(
    "antigravity",
    { goal: "carrello" },
    "/tmp/continuity fixture/worktree",
  );
  expect(prompt).toContain("/tmp/continuity fixture/worktree/cart.mjs");
  expect(prompt).toContain("non cercare cart.mjs altrove");
  expect(prompt).toContain("snapshots/");
  expect(livePrompt("codex", undefined, "/tmp/continuity fixture/worktree")).not.toContain(
    "/tmp/continuity fixture/worktree",
  );
});

it("prepara un profilo con permesso confinato ai run e divieti conservati", () => {
  const root = mkdtempSync(join(tmpdir(), "continuity-antigravity-"));
  try {
    const home = prepareAntigravityProfile(root);
    const settings = JSON.parse(
      readFileSync(
        join(home, ".gemini/antigravity-cli/settings.json"),
        "utf8",
      ),
    );
    expect(settings.permissions.deny).toContain("command(*)");
    expect(settings.permissions.deny).toContain("write_file(.git)");
    for (const rule of settings.permissions.allow)
      expect(rule).toContain(join(root, "runs"));
    expect(settings.permissions.allow.join(" ")).not.toContain("(*)");
    expect(settings.toolPermission).toBeUndefined();
    expect(() => validateAntigravityProfile(root)).not.toThrow();
    settings.permissions.allow.push("command(*)");
    writeFileSync(
      join(home, ".gemini/antigravity-cli/settings.json"),
      JSON.stringify(settings),
    );
    expect(() => validateAntigravityProfile(root)).toThrow(
      /Allowlist Antigravity/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("associa esplicitamente il worktree a un nuovo progetto", () => {
  const command = antigravityCommand("/tmp/continuity fixture/worktree");
  expect(command.args).toContain("--new-project");
  expect(command.args[command.args.indexOf("--add-dir") + 1]).toBe(
    "/tmp/continuity fixture/worktree",
  );
});
