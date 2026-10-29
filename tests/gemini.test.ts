import { it, expect, afterEach, vi } from "vitest";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  normalizedLiveEvent,
  subscriptionEnvironment,
  liveCommand,
} from "../src/adapters/live.js";
import {
  geminiEnvironment,
  prepareGeminiProfile,
} from "../src/adapters/gemini.js";
const dirs: string[] = [];
const temp = () => {
  const root = mkdtempSync(join(tmpdir(), "continuity-gemini-"));
  dirs.push(root);
  return root;
};
afterEach(() => {
  vi.restoreAllMocks();
  dirs
    .splice(0)
    .forEach((root) => rmSync(root, { recursive: true, force: true }));
});
it("profilo Google separato senza crediti aggiuntivi, hook o strumenti shell", () => {
  const root = temp();
  const profile = prepareGeminiProfile(root);
  const settings = JSON.parse(
    readFileSync(join(profile, ".gemini/settings.json"), "utf8"),
  );
  expect(settings.security.auth.enforcedType).toBe("oauth-personal");
  expect(settings.billing.overageStrategy).toBe("never");
  expect(settings.hooksConfig.enabled).toBe(false);
  expect(settings.tools.core).toEqual(["read_file", "replace", "write_file"]);
  const env = geminiEnvironment(root, root, subscriptionEnvironment());
  expect(env.GEMINI_CLI_HOME).toBe(profile);
  expect(env.GEMINI_API_KEY).toBeUndefined();
  expect(env.GOOGLE_CLOUD_PROJECT).toBeUndefined();
  mkdirSync(join(root, ".gemini"));
  expect(() =>
    geminiEnvironment(root, root, subscriptionEnvironment()),
  ).toThrow("worktree");
  rmSync(join(root, ".gemini"), { recursive: true });
  writeFileSync(join(root, ".env"), "GEMINI_API_KEY=not-a-real-key");
  expect(() =>
    geminiEnvironment(root, root, subscriptionEnvironment()),
  ).toThrow(".env");
});
it("Gemini usa sandbox e policy confinata al carrello, senza auto-approvazione generale", () => {
  const root = temp();
  const command = liveCommand("gemini", root, root);
  expect(command.binary).toBe("gemini");
  expect(command.args).toContain("--sandbox");
  expect(command.args).not.toContain("--yolo");
  expect(command.args).not.toContain("auto_edit");
  const policy = readFileSync(join(root, "gemini-policy.toml"), "utf8");
  expect(policy).toContain('toolName = "*"\ndecision = "deny"');
  const expression = JSON.parse(
    policy.split("argsPattern = ")[1].split("\n")[0],
  );
  const match = new RegExp(expression);
  expect(
    match.test(JSON.stringify({ file_path: join(root, "cart.mjs") })),
  ).toBe(true);
  expect(
    match.test(JSON.stringify({ file_path: join(root, "other.mjs") })),
  ).toBe(false);
  expect(
    match.test(
      JSON.stringify({
        file_path: "/secret",
        content: JSON.stringify({ file_path: join(root, "cart.mjs") }),
      }),
    ),
  ).toBe(false);
});
it.each([
  [{ type: "init", model: "gemini-test" }, "reported"],
  [{ type: "message", role: "assistant", content: "Ciao" }, "message"],
  [{ type: "result", status: "success" }, "reported"],
  [{ type: "result", status: "error" }, "error"],
  [{ type: "error", message: "quota" }, "error"],
  [{ type: "tool_result", output: "quota exhausted" }, "unknown"],
  [{ type: "result", status: "invented" }, "unknown"],
])(
  "normalizza eventi Gemini senza trasformare claim in successo: %j",
  (event, kind) => {
    expect(normalizedLiveEvent("gemini", event).type).toBe(kind);
  },
);
