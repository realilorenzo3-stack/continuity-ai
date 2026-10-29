import { it, expect, vi, afterEach } from "vitest";
import { readFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";

// Messaggio osservato dal CLI Codex reale il 22 settembre 2026, quota esaurita.
const LIMIT =
  "You've hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at 11:24 PM.";
const SOLUTION =
  "export function total(items) {\\n" +
  "  for (const item of items) {\\n" +
  "    if (!Number.isInteger(item.quantity) || item.quantity < 0) throw new Error('quantita non valida');\\n" +
  "    if (!Number.isFinite(item.price) || item.price < 0) throw new Error('prezzo non valido');\\n" +
  "  }\\n" +
  "  return items.reduce((sum, item) => sum + item.price * item.quantity, 0);\\n" +
  "}\\n";

vi.mock("../src/adapters/live.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/adapters/live.js")>();
  return {
    ...actual,
    requireSubscriptions: () => ({ codex: "fixture", antigravity: "fixture" }),
    livePrompt: () => "fixture",
    liveCommand: (agent: string) => ({
      binary: process.execPath,
      args: [
        "-e",
        agent === "codex"
          ? `process.stdout.write(JSON.stringify({type:"error",message:${JSON.stringify(LIMIT)}})+"\\n");` +
            `process.stdout.write(JSON.stringify({type:"turn.failed",error:{message:${JSON.stringify(LIMIT)}}})+"\\n");` +
            `process.exit(1);`
          : `require("node:fs").writeFileSync("cart.mjs","${SOLUTION}");` +
            `process.stdout.write(JSON.stringify({event:"init",init:{permission_mode:"request-review"}})+"\\n");` +
            `process.stdout.write(JSON.stringify({event:"result",result:{status:"SUCCESS"}})+"\\n");`,
      ],
    }),
  };
});

import {
  normalizedLiveEvent,
  quotaExhausted,
  subscriptionEnvironment,
} from "../src/adapters/live.js";
import { Store } from "../src/persistence/store.js";
import { Engine } from "../src/core/engine.js";

const dirs: string[] = [];
afterEach(() =>
  dirs
    .splice(0)
    .forEach((dir) => rmSync(dir, { recursive: true, force: true })),
);

it("riconosce la quota solo da un errore strutturato del provider", () => {
  expect(quotaExhausted(LIMIT)).toBe(true);
  expect(normalizedLiveEvent("codex", { type: "error", message: LIMIT }).type).toBe(
    "quota",
  );
  expect(
    normalizedLiveEvent("codex", {
      type: "turn.failed",
      error: { message: LIMIT },
    }).type,
  ).toBe("quota");
  expect(
    normalizedLiveEvent("codex", {
      type: "error",
      message: "connection reset by peer",
    }).type,
  ).toBe("error");
  // Il testo del modello non è una prova di quota: resta un messaggio.
  expect(
    normalizedLiveEvent("codex", {
      type: "item.completed",
      item: { type: "agent_message", text: "You've hit your usage limit" },
    }).type,
  ).toBe("message");
});

it("l'ambiente degli abbonamenti dà il nome utente ma nessuna credenziale", () => {
  const env = subscriptionEnvironment();
  // Senza USER il CLI Claude non legge il proprio portachiavi e si dichiara disconnesso.
  expect(env.USER).toBe(userInfo().username);
  expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  expect(env.ANTHROPIC_BASE_URL).toBeUndefined();
  expect(env.OPENAI_API_KEY).toBeUndefined();
});

it("i permessi di Claude coprono il percorso assoluto indicato nel prompt", async () => {
  const { liveCommand } = await vi.importActual<
    typeof import("../src/adapters/live.js")
  >("../src/adapters/live.js");
  const command = liveCommand("claude", "/tmp/continuity fixture/worktree");
  const allowed =
    command.args[command.args.indexOf("--allowedTools") + 1].split(",");
  expect(allowed).toContain("Edit(/tmp/continuity fixture/worktree/cart.mjs)");
  expect(allowed).toContain("Edit(./cart.mjs)");
  expect(allowed.every((rule) => rule.includes("cart.mjs"))).toBe(true);
  expect(command.args).not.toContain("bypassPermissions");
});

it("una quota reale fa passare il lavoro al successore e non viene marcata simulata", async () => {
  const root = mkdtempSync(join(tmpdir(), "continuity-quota-"));
  dirs.push(root);
  const db = new Store(root),
    engine = new Engine(db);
  try {
    const created = await engine.create(
      "Validare quantità e totale del carrello",
      "live",
      "antigravity",
    );
    await vi.waitFor(
      () => expect(engine.run(created.id).state).toBe("SUCCEEDED"),
      { timeout: 15000 },
    );
    const run = engine.run(created.id);
    expect(run.quotaDetected).toBe(true);
    expect(run.switches).toBe(1);
    expect(run.checks.every((c: any) => c.passed)).toBe(true);
    const detected = db
      .events(created.id)
      .find((e: any) => e.type === "failure.detected");
    expect(detected.simulated).toBe(false);
    expect(detected.payload.message).toContain("REALE");
    const handoff = JSON.parse(
      readFileSync(join(run.dir, "handoff.json"), "utf8"),
    );
    expect(handoff.switch.simulated).toBe(false);
    expect(handoff.switch.kind).toBe("quota_exhausted");
  } finally {
    await engine.shutdown();
    db.close();
  }
}, 30000);
