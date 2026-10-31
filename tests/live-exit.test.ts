import { it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { liveExitFailure, pezzoDiErrore } from "../src/adapters/exit.js";
vi.mock("../src/adapters/live.js", () => ({
  requireSubscriptions: () => ({}),
  subscriptionEnvironment: () => ({ PATH: process.env.PATH }),
  livePrompt: () => "fixture",
  normalizedLiveEvent: () => ({ type: "unknown", text: "" }),
  liveCommand: () => ({
    binary: process.execPath,
    args: [
      "-e",
      "process.stderr.write('UNSUPPORTED_CLIENT access_token=private-value');process.exit(41)",
    ],
  }),
}));
vi.mock("../src/adapters/gemini.js", () => ({
  geminiEnvironment: (_root: string, _work: string, env: unknown) => env,
}));
import { Store } from "../src/persistence/store.js";
import { Engine } from "../src/core/engine.js";
const dirs: string[] = [];
afterEach(() =>
  dirs
    .splice(0)
    .forEach((dir) => rmSync(dir, { recursive: true, force: true })),
);
it("uscita provider 41 blocca e conserva snapshot senza produrre un falso fallimento dei test", async () => {
  const root = mkdtempSync(join(tmpdir(), "continuity-live-exit-"));
  dirs.push(root);
  const work = mkdtempSync(join(tmpdir(), "continuity-live-work-"));
  dirs.push(work);
  writeFileSync(join(work, "cart.mjs"), "export function total(){return 0;}");
  const db = new Store(root),
    engine = new Engine(db);
  const run = {
    id: "fixture",
    dir: root,
    work,
    mode: "live",
    state: "READY",
    agent: "gemini",
    successor: "gemini",
    checks: [],
    snapshots: [],
  };
  db.save(run, "created", "fixture");
  try {
    await engine.start(run);
    await vi.waitFor(() => expect(engine.run(run.id).state).toBe("BLOCKED"), {
      timeout: 4000,
    });
    const result = engine.run(run.id);
    expect(result.error).toContain("UNSUPPORTED_CLIENT");
    expect(result.processExit.code).toBe(41);
    expect(result.snapshotId).toMatch(/^[a-f0-9]{64}$/);
    expect(engine.children.size).toBe(0);
    const events = JSON.stringify(db.events(run.id));
    expect(events).not.toContain("private-value");
    expect(events).not.toContain("verification.started");
    expect(events).not.toContain("switch.started");
  } finally {
    await engine.shutdown();
    db.close();
  }
});
it("non attribuisce quota o incompatibilità a un errore generico", () => {
  expect(liveExitFailure("gemini", 1, null, "quota exhausted")).not.toContain(
    "UNSUPPORTED_CLIENT",
  );
  expect(
    liveExitFailure("gemini", 0, null, "UNSUPPORTED_CLIENT in quoted text"),
  ).toBeNull();
  expect(liveExitFailure("codex", null, "SIGTERM", "secret")).toContain(
    "SIGTERM",
  );
});
it("mostra la riga «Error» dell'AI anche quando è più lunga della coda conservata", () => {
  // Claude su Windows, 31 ottobre: «Error: MCP tool … not found. Available
  // MCP tools: …» su una sola riga di oltre 8 KB; la coda ne mostrava la fine.
  const riga = "Error: MCP tool mcp__continuity__permesso (passed via --permission-prompt-tool) not found. Available MCP tools: " + "mcp__x__y, ".repeat(2000);
  const tutto = riga + "\n";
  expect(pezzoDiErrore(tutto.slice(0, 4096), tutto.slice(-8192))).toMatch(/^Error: MCP tool mcp__continuity__permesso/);
  expect(pezzoDiErrore("avvio\n", "riga\nError: rotto\nfine")).toBe("Error: rotto");
  expect(pezzoDiErrore("", "solo coda")).toBe("solo coda");
});
