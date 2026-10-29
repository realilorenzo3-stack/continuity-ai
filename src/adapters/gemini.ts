import { GEMINI_PERSONAL_UNAVAILABLE } from "./exit.js";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { atomic } from "../git/snapshot.js";

export const GEMINI_VERSION = "0.45.0";
export function geminiProfile(root: string) {
  return join(resolve(root), "gemini-profile");
}
// A dedicated CLI profile prevents inherited plugins, hooks and billing settings.
// Credentials are created/read only by the official CLI, never copied by Continuity.
export function prepareGeminiProfile(root: string) {
  const systemDirectory =
    process.platform === "darwin"
      ? "/Library/Application Support/GeminiCli"
      : "/etc/gemini-cli";
  if (
    ["settings.json", "system-defaults.json"].some((name) =>
      existsSync(join(systemDirectory, name)),
    )
  )
    throw Error(
      "Configurazione Gemini di sistema presente: verificare compatibilità della policy senza sovrascriverla",
    );
  const home = geminiProfile(root);
  const settings = {
    security: {
      auth: { selectedType: "oauth-personal", enforcedType: "oauth-personal" },
    },
    billing: { overageStrategy: "never" },
    hooksConfig: { enabled: false },
    skills: { enabled: false },
    admin: {
      extensions: { enabled: false },
      mcp: { enabled: false },
      skills: { enabled: false },
    },
    tools: { core: ["read_file", "replace", "write_file"] },
    model: { maxSessionTurns: 12 },
    telemetry: { enabled: false },
    advanced: { ignoreLocalEnv: true },
  };
  mkdirSync(join(home, ".gemini"), { recursive: true, mode: 0o700 });
  atomic(
    join(home, ".gemini", "settings.json"),
    JSON.stringify(settings, null, 2),
  );
  return home;
}
export function requireGemini(root: string, env: NodeJS.ProcessEnv) {
  let version: string;
  try {
    version = execFileSync("gemini", ["--version"], {
      env,
      encoding: "utf8",
      timeout: 15000,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    throw Error(
      "Gemini CLI non disponibile: installare la versione compatibile " +
        GEMINI_VERSION,
    );
  }
  if (version !== GEMINI_VERSION)
    throw Error("Versione Gemini non validata: attesa " + GEMINI_VERSION);
  // The local OAuth file does not establish eligibility. Google retired the
  // personal-login route on 2026-06-18; confirmed by our startup probe.
  throw Error(GEMINI_PERSONAL_UNAVAILABLE);
}
export function geminiEnvironment(
  root: string,
  work: string,
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const home = prepareGeminiProfile(root);
  if (resolve(work) !== resolve(home) && existsSync(join(work, ".gemini")))
    throw Error(
      "Configurazione Gemini nel worktree non consentita dalla fixture",
    );
  // Gemini also searches ancestor .env files. Reject them without reading secrets.
  for (const start of [home, work]) {
    let current = resolve(start);
    while (true) {
      if (
        existsSync(join(current, ".env")) ||
        existsSync(join(current, ".gemini", ".env"))
      )
        throw Error(
          "File .env nel percorso Gemini: isolamento ambiente non garantito",
        );
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  return { ...env, GEMINI_CLI_HOME: home, NO_BROWSER: "true" };
}
export function geminiCommand(work: string, dir: string) {
  const policy = join(dir, "gemini-policy.toml");
  const file = join(resolve(work), "cart.mjs");
  const escaped = JSON.stringify(file)
    .slice(1, -1)
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = '"file_path"\\s*:\\s*"' + escaped + '"';
  atomic(
    policy,
    "[[" +
      'rule]]\ntoolName = "*"\ndecision = "deny"\npriority = 900\n' +
      ["read_file", "replace", "write_file"]
        .map(
          (tool) =>
            `\n[[rule]]\ntoolName = "${tool}"\nargsPattern = ${JSON.stringify(pattern)}\ndecision = "allow"\npriority = 910\n`,
        )
        .join(""),
  );
  return {
    binary: "gemini",
    args: [
      "--sandbox",
      "--approval-mode",
      "default",
      "--policy",
      policy,
      "--extensions",
      "none",
      "--output-format",
      "stream-json",
      "--prompt",
      "Continua il task descritto nello standard input.",
    ],
  };
}
