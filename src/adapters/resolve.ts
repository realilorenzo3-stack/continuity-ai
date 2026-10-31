import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { atomic } from "../git/snapshot.js";
import { cercaNelPath, nomeEseguibile, sistema } from "../piattaforma.js";

export type Provider = "codex" | "claude";
// Versions actually exercised against Continuity. A different one is reported, never
// assumed compatible: the stream formats are not guaranteed across releases.
// Le versioni su cui Continuity è stata provata con turni reali. Codex 0.159.2:
// collaudo ufficiale del 3 ottobre 2026, quattro turni reali con sotto-agenti.
export const PROVIDER_CONTRACT: Record<Provider, string> = {
  codex: "codex-cli 0.159.2",
  claude: "2.1.294 (Claude Code)",
};

// La versione di un eseguibile, tenuta finché il file non cambia: chiederla a
// ogni turno a tutte le copie installate costava secondi.
const versioni = new Map<string, { mtime: number; versione?: string }>();
function versionOf(path: string) {
  let mtime = 0;
  try {
    mtime = statSync(path).mtimeMs;
  } catch {}
  const nota = versioni.get(path);
  if (nota && nota.mtime === mtime) return nota.versione;
  const result = spawnSync(path, ["--version"], {
    encoding: "utf8",
    timeout: 20000,
  });
  const versione =
    result.error || result.status !== 0
      ? undefined
      : ((result.stdout ?? "") + (result.stderr ?? "")).trim().split("\n")[0];
  versioni.set(path, { mtime, versione });
  return versione;
}
// «2.1.294 (Claude Code)», «codex-cli 0.162.0-alpha.2» → confrontabili.
// A parità di numeri una versione stabile vale più di un'anteprima.
export function rangoVersione(versione: string) {
  const m = /(\d+)\.(\d+)\.(\d+)(-[\w.]+)?/.exec(versione);
  if (!m) return [-1, -1, -1, 0];
  return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] ? 0 : 1];
}
function piuNuova(a: string, b: string) {
  const x = rangoVersione(a),
    y = rangoVersione(b);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

// Su Windows solo i .exe (src/piattaforma.ts, cercaNelPath).
function fromPath(binary: string) {
  return cercaNelPath(binary);
}

// I CLI stanno spesso solo dentro le estensioni dell'editor (VS Code, Cursor)
// o nelle app ufficiali, fuori dal PATH di un terminale: è lì che si
// aggiornano da soli, mentre una vecchia installazione nel PATH resta ferma.
const CARTELLE_ESTENSIONI = [".vscode", ".vscode-insiders", ".cursor"].map(
  (d) => join(homedir(), d, "extensions"),
);
function nelleEstensioni(prefisso: string, dentro: (dir: string) => string[]) {
  const found: string[] = [];
  for (const extensions of CARTELLE_ESTENSIONI) {
    if (!existsSync(extensions)) continue;
    for (const name of readdirSync(extensions)) {
      if (!name.startsWith(prefisso)) continue;
      for (const candidate of dentro(join(extensions, name)))
        if (existsSync(candidate)) found.push(candidate);
    }
  }
  return found;
}
function editorCodex() {
  return [
    ...nelleEstensioni("openai.chatgpt", (dir) => {
      const bin = join(dir, "bin");
      return existsSync(bin)
        ? readdirSync(bin).map((arch) => join(bin, arch, nomeEseguibile("codex")))
        : [];
    }),
    "/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex",
  ];
}
function editorClaude() {
  const versioniInstallate = join(
    homedir(),
    ".local",
    "share",
    "claude",
    "versions",
  );
  return [
    ...nelleEstensioni("anthropic.claude-code", (dir) => [
      join(dir, "resources", "native-binary", nomeEseguibile("claude")),
    ]),
    ...(existsSync(versioniInstallate)
      ? readdirSync(versioniInstallate).map((v) => join(versioniInstallate, v))
      : []),
  ];
}

function configPath(root: string) {
  return join(root, "providers.json");
}
function saved(root: string, name: Provider) {
  try {
    const data = JSON.parse(readFileSync(configPath(root), "utf8"));
    return typeof data[name]?.path === "string" ? [data[name].path] : [];
  } catch {
    return [];
  }
}
export function rememberProvider(root: string, name: Provider, path: string) {
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(readFileSync(configPath(root), "utf8"));
  } catch {}
  data[name] = { path, rememberedAt: new Date().toISOString() };
  atomic(configPath(root), JSON.stringify(data, null, 2));
}

// Selection is kept separate from discovery so it can be exercised without
// depending on what happens to be installed on the machine.
// Si usa la versione più recente installata. Prima si preferiva quella del
// collaudo: Continuity restava su un Claude Code vecchio di mesi, che non
// conosceva gli ultimi modelli («opus» portava a Opus 5.0, il 60% più lento),
// mentre la persona nel suo terminale usava già l'ultima versione.
// Un percorso indicato con CONTINUITY_<CLI>_BIN vale sempre.
export function pickProvider(
  name: Provider,
  candidates: string[],
  scelto?: string,
) {
  if (scelto && existsSync(scelto)) {
    const version = versionOf(scelto);
    if (version) return { path: scelto, version };
  }
  const seen = new Set<string>();
  let migliore: { path: string; version: string } | undefined;
  for (const path of candidates) {
    if (seen.has(path) || !existsSync(path)) continue;
    seen.add(path);
    const version = versionOf(path);
    if (!version) continue;
    if (!migliore || piuNuova(version, migliore.version))
      migliore = { path, version };
  }
  if (migliore) return migliore;
  throw Error(
    `${name}: CLI non trovata. Installarla oppure indicarne il percorso con CONTINUITY_${name.toUpperCase()}_BIN.`,
  );
}

export function providerCandidates(name: Provider, root: string) {
  return [
    ...saved(root, name),
    ...fromPath(name),
    ...(sistema() === "windows"
      ? // Gli installatori ufficiali per Windows: Codex in
        // %LOCALAPPDATA%ProgramsOpenAICodexin, Claude Code in ~.localin.
        name === "codex"
        ? [
            join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "Programs", "OpenAI", "Codex", "bin", "codex.exe"),
            ...editorCodex(),
          ]
        : [join(homedir(), ".local", "bin", "claude.exe"), ...editorClaude()]
      : name === "codex"
      ? [join(homedir(), ".local", "bin", "codex"), ...editorCodex()]
      : [
          "/usr/local/bin/claude",
          "/opt/homebrew/bin/claude",
          join(homedir(), ".local", "bin", "claude"),
          join(homedir(), ".claude", "local", "claude"),
          ...editorClaude(),
        ]),
  ];
}

export function resolveProvider(name: Provider, root: string) {
  return pickProvider(
    name,
    providerCandidates(name, root),
    process.env[`CONTINUITY_${name.toUpperCase()}_BIN`],
  );
}
