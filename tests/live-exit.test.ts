import { it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { liveExitFailure } from "../src/adapters/exit.js";
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
