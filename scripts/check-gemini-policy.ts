// Offline contract check against the installed Gemini CLI bundle. No model calls.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { geminiCommand } from "../src/adapters/gemini.js";
const bundle = process.argv[2];
if (!bundle)
  throw Error(
    "Passare il bundle Gemini 0.45.0 che esporta PolicyEngine e loadPoliciesFromToml",
  );
const { PolicyEngine, loadPoliciesFromToml } = await import(
  pathToFileURL(bundle).href
);
const root = mkdtempSync(join(tmpdir(), "continuity-gemini-policy-"));
try {
  geminiCommand(root, root);
  const loaded = await loadPoliciesFromToml(
    [join(root, "gemini-policy.toml")],
    () => 4,
  );
  if (loaded.errors.length) throw Error(JSON.stringify(loaded.errors));
  const engine = new PolicyEngine({
    rules: loaded.rules,
    nonInteractive: true,
  });
  const cases = [
    {
      name: "read_file",
      args: { file_path: join(root, "cart.mjs") },
      expected: "allow",
    },
    {
      name: "replace",
      args: {
        file_path: join(root, "cart.mjs"),
        old_string: "a",
        new_string: "b",
      },
      expected: "allow",
    },
    {
      name: "write_file",
      args: { file_path: join(root, "cart.mjs"), content: "fixture" },
      expected: "allow",
    },
    { name: "read_file", args: { file_path: "/etc/passwd" }, expected: "deny" },
    {
      name: "write_file",
      args: {
        file_path: join(root, "other.mjs"),
        content: JSON.stringify({ file_path: join(root, "cart.mjs") }),
      },
      expected: "deny",
    },
    {
      name: "run_shell_command",
      args: { command: "echo blocked" },
      expected: "deny",
    },
    { name: "web_fetch", args: { prompt: "blocked" }, expected: "deny" },
  ];
  const results = [];
  for (const item of cases) {
    const result = await engine.check({ name: item.name, args: item.args });
    results.push({
      tool: item.name,
      expected: item.expected,
      decision: result.decision,
    });
    if (result.decision !== item.expected) throw Error(JSON.stringify(results));
  }
  writeFileSync(
    "docs/evidence/gemini-policy.json",
    JSON.stringify(
      {
        observedAt: new Date().toISOString(),
        version: "0.45.0",
        inferenceStarted: false,
        results,
      },
      null,
      2,
    ),
  );
  console.log(
    "Policy Gemini: " + results.length + " controlli offline superati",
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}
