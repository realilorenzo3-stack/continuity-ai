// L'ambiente di ogni comando Git di Continuity. Le impostazioni personali e di
// sistema della persona si ignorano (GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM):
// un alias, un hook o un editor configurato non devono cambiare ciò che
// Continuity fa.
//
// Un'eccezione, in WSL, per i progetti sul disco di Windows (/mnt/c/…). Lì il
// repository è di solito di Git per Windows, che estrae i file con le fine
// riga di Windows (core.autocrlf=true, scelto dall'installatore e salvato fra
// le impostazioni globali di Windows). Senza la stessa impostazione,
// Continuity vedrebbe ogni file come modificato e la copia di lavoro avrebbe
// fine riga diverse da quelle della persona. Da WSL, inoltre, i file di
// Windows sembrano tutti eseguibili: core.fileMode=false (piano di
// pubblicazione, punto 2, 29 ottobre 2026).
import { execFileSync } from "node:child_process";
import { sistema, type Sistema } from "../piattaforma.js";

const BASE = { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };

// Il disco di Windows visto da WSL: /mnt/c, /mnt/d…
export function sulDiscoDiWindows(percorso: string) {
  return /^\/mnt\/[a-z](\/|$)/i.test(percorso);
}

// Le impostazioni da aggiungere, come variabili d'ambiente di Git
// (GIT_CONFIG_COUNT, Git 2.31 e successivi): valgono più dei file di
// configurazione, senza scrivere nulla nel repository della persona.
export function impostazioniPerWindows(autocrlf: string | undefined): Record<string, string> {
  const voci: [string, string][] = [["core.fileMode", "false"]];
  if (autocrlf && /^(true|input|false)$/.test(autocrlf)) voci.push(["core.autocrlf", autocrlf]);
  return Object.fromEntries([
    ["GIT_CONFIG_COUNT", String(voci.length)],
    ...voci.flatMap(([k, v], i) => [
      [`GIT_CONFIG_KEY_${i}`, k],
      [`GIT_CONFIG_VALUE_${i}`, v],
    ]),
  ]);
}

// Dove sta il repository vero di una cartella (anche di una copia di lavoro
// fatta con «git worktree», che vive nella cartella dati di Continuity).
function cartellaGitComune(cwd: string): string | undefined {
  try {
    return execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
      cwd,
      encoding: "utf8",
      env: { PATH: process.env.PATH, ...BASE },
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10_000,
    }).trim();
  } catch {
    return undefined;
  }
}

// La scelta di Git per Windows sulle fine riga per quel repository, chiesta a
// git.exe (dal lato Windows), se c'è.
function autocrlfDiWindows(repository: string): string | undefined {
  try {
    const cartellaWindows = execFileSync("wslpath", ["-w", repository], { encoding: "utf8", timeout: 5000 }).trim();
    return execFileSync("git.exe", ["-C", cartellaWindows, "config", "--get", "core.autocrlf"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 15_000,
    }).trim();
  } catch {
    return undefined;
  }
}

const ricordate = new Map<string, Record<string, string>>();

export function ambienteGit(
  cwd?: string,
  s: Sistema = sistema(),
  chiedi = { cartellaGitComune, autocrlfDiWindows },
): NodeJS.ProcessEnv {
  const ambiente = { PATH: process.env.PATH, ...BASE };
  if (s !== "wsl" || !cwd) return ambiente;
  let extra = ricordate.get(cwd);
  if (!extra) {
    const comune = chiedi.cartellaGitComune(cwd);
    extra = comune && sulDiscoDiWindows(comune) ? impostazioniPerWindows(chiedi.autocrlfDiWindows(comune.replace(/\/\.git\/?$/, ""))) : {};
    ricordate.set(cwd, extra);
  }
  return { ...ambiente, ...extra };
}

// Per una cartella senza Git sul disco di Windows (la pubblicazione): le fine
// riga che Git per Windows userebbe lì. Fuori da WSL o dal disco di Windows,
// nessuna.
export function autocrlfPerCartella(
  cartella: string,
  s: Sistema = sistema(),
  chiedi = { autocrlfDiWindows },
): string | undefined {
  if (s !== "wsl" || !sulDiscoDiWindows(cartella)) return undefined;
  const valore = chiedi.autocrlfDiWindows(cartella);
  return valore && /^(true|input|false)$/.test(valore) ? valore : undefined;
}

