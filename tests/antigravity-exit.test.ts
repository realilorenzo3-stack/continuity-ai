import { it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../src/adapters/live.js", () => ({
  requireSubscriptions: () => ({}),
  subscriptionEnvironment: () => ({ PATH: process.env.PATH }),
  livePrompt: () => "fixture",
  normalizedLiveEvent: () => ({ type: "unknown", text: "" }),
  liveCommand: () => ({
    binary: process.execPath,
    args: [
      "-e",
      'console.log(JSON.stringify({event:"init",init:{permission_mode:"request-review"}}));process.exit(0)',
    ],
  }),
}));

import { Store } from "../src/persistence/store.js";
import { Engine } from "../src/core/engine.js";
const dirs: string[] = [];
afterEach(() =>
  dirs
    .splice(0)
    .forEach((dir) => rmSync(dir, { recursive: true, force: true })),
);
it("Antigravity exit zero senza result blocca prima della verifica", async () => {
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
    agent: "antigravity",
    successor: "antigravity",
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
    expect(result.error).toContain("Errore provider");
    expect(result.processExit.code).toBe(0);
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
