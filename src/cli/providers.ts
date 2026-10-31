import { spawnSync } from "node:child_process";
import { join } from "node:path";
import {
  antigravityBinary,
  antigravityEnvironment,
  prepareAntigravityProfile,
  requireAntigravity,
  ANTIGRAVITY_VERSION,
} from "../adapters/antigravity.js";
import { subscriptionEnvironment } from "../adapters/live.js";
import {
  resolveProvider,
  rememberProvider,
  PROVIDER_CONTRACT,
} from "../adapters/resolve.js";

export type Provider = "codex" | "claude" | "antigravity";

// Continuity never reads or copies credentials: it only observes what each official
// CLI reports about itself, and hands the terminal over for the login flow.
// Some CLIs report their login state on stderr, so both streams are inspected;
// stdout stays separate for the ones that answer with JSON.
function run(binary: string, params: string[], env: NodeJS.ProcessEnv) {
  const result = spawnSync(binary, params, {
    env,
    encoding: "utf8",
    timeout: 20000,
  });
  if (result.error) throw result.error;
  const stdout = (result.stdout ?? "").trim();
  return { stdout, both: (stdout + "\n" + (result.stderr ?? "")).trim() };
}

// Una versione diversa da quella collaudata si segnala, ma non viene
// rifiutata: il messaggio diceva «le prove reali saranno rifiutate» mentre le
// sessioni funzionavano (collaudo del 3 ottobre, CT-013).
function contract(name: "codex" | "claude", version: string) {
  return version === PROVIDER_CONTRACT[name]
    ? ""
    : ` · versione diversa da quella collaudata (${PROVIDER_CONTRACT[name]}): funziona, ma segnala eventuali anomalie`;
}

export function providerStatus(name: Provider, root: string) {
  const env = subscriptionEnvironment();
  try {
    if (name === "codex") {
      const { path, version } = resolveProvider("codex", root);
      const status = run(path, ["login", "status"], env).both;
      rememberProvider(root, "codex", path);
      return status.includes("Logged in using ChatGPT")
        ? {
            connected: true,
            detail: `${version}, abbonamento ChatGPT${contract("codex", version)}`,
          }
        : {
            connected: false,
            detail: `${version}, nessun abbonamento ChatGPT attivo`,
          };
    }
    if (name === "claude") {
      const { path, version } = resolveProvider("claude", root);
      rememberProvider(root, "claude", path);
      const auth = JSON.parse(run(path, ["auth", "status"], env).stdout);
      return auth.loggedIn &&
        auth.authMethod === "claude.ai" &&
        auth.apiProvider === "firstParty"
        ? {
            connected: true,
            detail: `${version}, abbonamento claude.ai${auth.subscriptionType ? " " + auth.subscriptionType : ""}${contract("claude", version)}`,
          }
        : {
            connected: false,
            detail: `${version}, serve un abbonamento claude.ai (API a consumo non ammesse)`,
          };
    }
    requireAntigravity(root);
    return {
      connected: true,
      detail: `${ANTIGRAVITY_VERSION}, profilo dedicato di Continuity`,
    };
  } catch (e) {
    return { connected: false, detail: dettaglioErrore(e) };
  }
}

// Il programma che manca si dice sempre con le stesse parole, che /collega e
// la configurazione riconoscono per proporre di installarlo. L'errore vero
// della ricerca è «claude: CLI non trovata…»: prima si cercava «non
// trovato», al maschile, e il programma assente non veniva riconosciuto
// (prova di Lorenzo su Ubuntu del 31 ottobre: niente proposta di installarlo).
export function dettaglioErrore(e: unknown) {
  const message = e instanceof Error ? e.message : String(e);
  return /ENOENT|not found|non trovat[oa]/i.test(message)
    ? "CLI non installata o non nel PATH"
    : message.split("\n")[0].slice(0, 160);
}

export function providerLogin(name: Provider, root: string) {
  const terminal = process.env.TERM ?? "xterm-256color";
  if (name === "antigravity") {
    const home = prepareAntigravityProfile(root);
    return {
      binary: antigravityBinary(),
      args: ["--sandbox", "--disable-slash-commands"],
      env: { ...antigravityEnvironment(root), TERM: terminal },
      cwd: home,
      note: "Completa l'accesso Google nel browser, poi torna qui. Non premere Ctrl+C durante il flusso: esci dal programma solo dopo che il login risulta concluso. Continuity usa un profilo dedicato e non tocca le altre configurazioni.",
    };
  }
  const env = { ...subscriptionEnvironment(), TERM: terminal };
  const binary = resolveProvider(name, root).path;
  return name === "codex"
    ? {
        binary,
        args: ["login"],
        env,
        cwd: join(root),
        note: "Si apre il login ufficiale di Codex con il tuo abbonamento ChatGPT. Le API a consumo non sono ammesse.",
      }
    : {
        binary,
        args: ["auth", "login", "--claudeai"],
        env,
        cwd: join(root),
        note: "Si apre il login ufficiale di Claude Code con il tuo abbonamento claude.ai.",
      };
}
