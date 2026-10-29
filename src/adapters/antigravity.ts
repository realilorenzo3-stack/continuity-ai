import { readFileSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { atomic } from "../git/snapshot.js";

export const ANTIGRAVITY_VERSION = "1.2.8";
// The CLI reports this mode even when another one is requested on the command
// line, so headless edits are enabled by the allowlist below, not by a mode.
export const ANTIGRAVITY_PERMISSION_MODE = "request-review";
export const ANTIGRAVITY_DENY = [
  "command(*)",
  "mcp(*)",
  "read_url(*)",
  "execute_url(*)",
  "write_file(.git)",
];
// Scoped to Continuity's own run tree: the successor may edit the worktree it was
// given and nothing else on the machine. Both spellings are declared because the
// CLI documents no matching semantics for a directory argument.
export function antigravityAllow(root: string) {
  const runs = join(root, "runs");
  return [
    "read_file(" + runs + ")",
    "read_file(" + runs + "/*)",
    "write_file(" + runs + ")",
    "write_file(" + runs + "/*)",
  ];
}
export function antigravityBinary() {
  return join(
    homedir(),
    "Library",
    "Application Support",
    "Continuity",
    "toolchain",
    "antigravity",
    ANTIGRAVITY_VERSION,
    "agy",
  );
}
export function antigravityCommand(work?: string) {
  return {
    binary: antigravityBinary(),
    args: [
      ...(work ? ["--new-project", "--add-dir", work] : []),
      "--model",
      "gemini-3.8-flash-high",
      "--sandbox",
      "--disable-slash-commands",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--print-timeout",
      "120s",
    ],
  };
}
export function antigravityInput(prompt: string) {
  return JSON.stringify({ event: "user", message: { content: prompt } }) + "\n";
}
// A denial must stop the run: retrying it would be an attempt to work around the
// policy. Other tool errors (a wrong path, a directory read) are recoverable
// inside the same turn, so they are surfaced without failing the stream.
export function quotaNelTesto(errore: unknown) {
  const testo =
    typeof errore === "string" ? errore : JSON.stringify(errore ?? "");
  return /quota|usage limit|out of credits/i.test(testo);
}
function deniedByPermission(error: unknown) {
  let text: string;
  try {
    text = typeof error === "string" ? error : JSON.stringify(error ?? "");
  } catch {
    return true;
  }
  return /permission[_ ]denied|denied permission|permission check failed|not allowed|non consentito/i.test(
    text,
  );
}
// Never infer quota exhaustion from arbitrary model prose or a generic ERROR.
// Enabling execution also requires validating local permissions, credential
// eligibility, and independent file verification.
export class AntigravityStream {
  initialized = false;
  finished = false;
  failed = false;
  receive(value: unknown): {
    type: "reported" | "message" | "azione" | "error" | "quota" | "unknown";
    text: string;
  } {
    const e = value as any;
    if (!e || typeof e !== "object")
      return this.error("Evento Antigravity non valido");
    if (this.finished)
      return this.error("Evento dopo risultato finale Antigravity");
    if (e.event === "init") {
      if (
        this.initialized ||
        !e.init ||
        e.init.permission_mode !== ANTIGRAVITY_PERMISSION_MODE
      )
        return this.error("Configurazione Antigravity inattesa");
      this.initialized = true;
      return {
        type: "reported",
        text: "Antigravity inizializzato; verifica Continuity necessaria",
      };
    }
    if (e.event === "result") {
      this.finished = true;
      // Una quota esaurita non è un errore del provider: è il segnale che fa
      // passare il lavoro al successore.
      if (quotaNelTesto(e.result?.error))
        return {
          type: "quota" as const,
          text: "Antigravity ha esaurito la quota; passaggio al successore",
        };
      if (e.result?.status !== "SUCCESS" || !this.initialized || this.failed)
        return this.error(
          "Antigravity non ha completato il turno; verificare accesso e permessi",
        );
      return {
        type: "reported",
        text: "Antigravity dichiara il turno completato; verifica Continuity necessaria",
      };
    }
    if (e.event === "step_update") {
      if (!this.initialized)
        return this.error("Evento Antigravity prima dell’inizializzazione");
      if (e.step_update?.tool_info?.error)
        return deniedByPermission(e.step_update.tool_info.error)
          ? this.error(
              "Strumento Antigravity negato dai permessi; nessuno switch per aggirarli",
            )
          : {
              type: "reported",
              text: "Strumento Antigravity fallito; il modello può riprovare entro i permessi",
            };
      if (e.step_update?.tool_info?.name)
        return {
          type: "azione",
          text: "usa  " + String(e.step_update.tool_info.name).slice(0, 60),
        };
      if (
        e.step_update?.step_type === "agent_response" &&
        typeof e.step_update.text_delta === "string"
      )
        return {
          type: "message",
          text: e.step_update.text_delta.slice(0, 2000),
        };
    }
    return { type: "unknown", text: "Evento Antigravity non riconosciuto" };
  }
  end() {
    return this.finished && !this.failed
      ? null
      : "Stream Antigravity incompleto o fallito";
  }
  private error(text: string) {
    this.failed = true;
    return { type: "error" as const, text };
  }
}
export function antigravityVersion() {
  const result = spawnSync(antigravityBinary(), ["--version"], {
    encoding: "utf8",
    timeout: 10000,
  });
  // The CLIs update themselves. Refusing an unseen version would break the tool
  // without warning; Continuity reports it and keeps its own verification as the
  // real guard, while the stream decoder still fails loudly if the protocol moved.
  if (result.status !== 0)
    throw Error("Antigravity assente: installarlo con continuity connect");
  return result.stdout.trim();
}

export function antigravityEnvironment(root: string): NodeJS.ProcessEnv {
  return {
    HOME: join(root, "antigravity-profile"),
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
    TERM: "dumb",
    LANG: "en_US.UTF-8",
  };
}
export function prepareAntigravityProfile(root: string) {
  const home = join(root, "antigravity-profile");
  const dir = join(home, ".gemini", "antigravity-cli");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  atomic(
    join(dir, "settings.json"),
    JSON.stringify(
      {
        altScreenMode: "never",
        permissions: { allow: antigravityAllow(root), deny: ANTIGRAVITY_DENY },
        trustedWorkspaces: [home],
      },
      null,
      2,
    ),
  );
  return home;
}
export function requireAntigravity(root: string) {
  antigravityVersion();
  prepareAntigravityProfile(root);
  validateAntigravityProfile(root);
  const result = spawnSync(antigravityBinary(), antigravityCommand().args, {
    env: antigravityEnvironment(root),
    cwd: join(root, "antigravity-profile"),
    input: "",
    encoding: "utf8",
    timeout: 30000,
    maxBuffer: 1024 * 1024,
  });
  let initialized = false;
  for (const line of (result.stdout ?? "").split("\n")) {
    try {
      const e = JSON.parse(line);
      if (
        e.event === "init" &&
        e.init?.permission_mode === ANTIGRAVITY_PERMISSION_MODE
      )
        initialized = true;
    } catch {}
  }
  if (result.status !== 0 || !initialized)
    throw Error(
      "Antigravity: login ufficiale o inizializzazione non validi; nessun prompt inviato",
    );
  return ANTIGRAVITY_VERSION;
}

export function validateAntigravityProfile(root: string) {
  const home = join(root, "antigravity-profile");
  const settings = JSON.parse(
    readFileSync(join(home, ".gemini/antigravity-cli/settings.json"), "utf8"),
  );
  if (
    settings.modelProvider ||
    settings.useG1Credits ||
    settings.allowNonWorkspaceAccess ||
    settings.toolPermission === "always-proceed"
  )
    throw Error(
      "Profilo Antigravity incompatibile con la prova senza API/extra",
    );
  const deny = settings.permissions?.deny ?? [];
  for (const rule of ANTIGRAVITY_DENY)
    if (!deny.includes(rule))
      throw Error("Restrizione Antigravity mancante: " + rule);
  const allow: string[] = settings.permissions?.allow ?? [];
  const expected = antigravityAllow(root);
  if (allow.some((rule) => !expected.includes(rule)))
    throw Error("Allowlist Antigravity da revisionare");
  for (const path of [
    ".gemini/antigravity-cli/hooks.json",
    ".gemini/config/hooks.json",
  ])
    if (existsSync(join(home, path)))
      throw Error("Hook Antigravity da revisionare");
  for (const path of [
    ".agents",
    ".gemini/antigravity-cli/plugins",
    ".gemini/antigravity-cli/skills",
  ])
    if (existsSync(join(home, path)) && readdirSync(join(home, path)).length)
      throw Error("Personalizzazioni Antigravity da revisionare");
  const mcp = join(home, ".gemini/config/mcp_config.json");
  if (existsSync(mcp)) {
    const raw = readFileSync(mcp, "utf8").trim();
    if (raw && Object.keys(JSON.parse(raw).mcpServers ?? {}).length)
      throw Error("Server MCP Antigravity da revisionare");
  }
}
