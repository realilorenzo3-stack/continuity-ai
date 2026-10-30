// Lo strato «piattaforma» (piano di pubblicazione, CONTINUITY_2.0.md §9.1
// punto 2): tutto ciò che cambia fra macOS, Linux e Windows con WSL 2 sta qui,
// in un posto solo. Il resto di Continuity chiede «apri questo link», «copia
// negli appunti», «dove stanno i dati», senza sapere su quale sistema gira.
// Sul Mac ogni funzione fa esattamente ciò che faceva prima.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { readdirSync, readFileSync, readlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type Sistema = "mac" | "linux" | "wsl";

// WSL 2 è Linux, con Windows accanto: lo si riconosce dal kernel di Microsoft.
export function sistema(
  piattaforma = process.platform,
  ambiente: NodeJS.ProcessEnv = process.env,
  versioneKernel = () => {
    try {
      return readFileSync("/proc/version", "utf8");
    } catch {
      return "";
    }
  },
): Sistema {
  if (piattaforma === "darwin") return "mac";
  if (piattaforma === "linux")
    return ambiente.WSL_DISTRO_NAME || /microsoft/i.test(versioneKernel()) ? "wsl" : "linux";
  // Windows nativo non è supportato in questa versione (decisione del 29
  // ottobre: Windows con WSL 2). Gli altri sistemi si trattano come Linux.
  return "linux";
}

// Dove stanno i dati dei programmi della persona: su Mac «Application
// Support», su Linux (e WSL) la cartella XDG dei dati.
export function cartellaBaseDati(
  casa = homedir(),
  s: Sistema = sistema(),
  ambiente: NodeJS.ProcessEnv = process.env,
): string {
  if (s === "mac") return join(casa, "Library", "Application Support");
  const xdg = ambiente.XDG_DATA_HOME;
  return xdg && xdg.startsWith("/") ? xdg : join(casa, ".local", "share");
}

// La cartella dati di Continuity, se la persona non ne indica un'altra con
// CONTINUITY_DATA_DIR.
export function cartellaDatiPredefinita(nome = "Continuity"): string {
  return process.env.CONTINUITY_DATA_DIR ?? join(cartellaBaseDati(), nome);
}

// Il primo programma che c'è, fra quelli indicati.
export function esiste(comando: string): boolean {
  return spawnSync("sh", ["-c", 'command -v "$1" >/dev/null 2>&1', "_", comando]).status === 0;
}

// Una pagina nel browser della persona. In WSL il browser è quello di
// Windows: «wslview» se c'è, altrimenti Esplora risorse di Windows, che apre
// gli indirizzi con il browser predefinito.
export function comandoApriLink(s: Sistema = sistema(), c = esiste): [string, string[]] | undefined {
  if (s === "mac") return ["open", []];
  if (s === "wsl") {
    if (c("wslview")) return ["wslview", []];
    if (c("explorer.exe")) return ["explorer.exe", []];
  }
  if (c("xdg-open")) return ["xdg-open", []];
  return undefined;
}
export function apriLink(indirizzo: string): boolean {
  const comando = comandoApriLink();
  if (!comando) return false;
  try {
    spawn(comando[0], [...comando[1], indirizzo], { stdio: "ignore", detached: true }).unref();
    return true;
  } catch {
    return false;
  }
}

// Gli appunti. Su Linux con Wayland o X11 servono i programmi del sistema
// (wl-clipboard, xclip o xsel); in WSL quelli di Windows. Se non c'è nulla,
// chi chiama usa la riserva del terminale (OSC 52) o lo dice alla persona.
export function comandiAppunti(
  s: Sistema = sistema(),
  c = esiste,
): { copia?: [string, string[]]; leggi?: [string, string[]] } {
  if (s === "mac") return { copia: ["pbcopy", []], leggi: ["pbpaste", []] };
  const copia: [string, string[]][] = [];
  const leggi: [string, string[]][] = [];
  if (s === "wsl") {
    copia.push(["clip.exe", []]);
    leggi.push(["powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "Get-Clipboard"]]);
  }
  copia.push(["wl-copy", []], ["xclip", ["-selection", "clipboard"]], ["xsel", ["--clipboard", "--input"]]);
  leggi.push(["wl-paste", ["--no-newline"]], ["xclip", ["-selection", "clipboard", "-o"]], ["xsel", ["--clipboard", "--output"]]);
  return { copia: copia.find(([n]) => c(n)), leggi: leggi.find(([n]) => c(n)) };
}
export function copiaNegliAppunti(testo: string): boolean {
  const comando = comandiAppunti().copia;
  if (!comando) return false;
  try {
    execFileSync(comando[0], comando[1], { input: testo, timeout: 3000, stdio: ["pipe", "ignore", "ignore"] });
    return true;
  } catch {
    return false;
  }
}
export function leggiAppunti(): string {
  const comando = comandiAppunti().leggi;
  if (!comando) return "";
  try {
    return execFileSync(comando[0], comando[1], { encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return "";
  }
}

// Una copia veloce di una cartella intera (le dipendenze nella copia di
// lavoro). Sul Mac la clonazione di APFS: istantanea, senza spazio in più. Su
// Linux la stessa cosa dove il disco la permette (Btrfs, XFS), altrimenti una
// copia normale: più lenta, ma mai un collegamento alle cartelle della persona.
export function argomentiCopiaVeloce(s: Sistema = sistema()): string[] {
  return s === "mac" ? ["-cR"] : ["-R", "--reflink=auto"];
}
export function copiaVeloce(origine: string, destinazione: string, attesa = 120_000) {
  execFileSync("cp", [...argomentiCopiaVeloce(), origine, destinazione], { stdio: "ignore", timeout: attesa });
}

// «ps» scrive «??» (Mac) o «?» (Linux) per un processo senza terminale.
export function senzaTerminale(tty: string | undefined): boolean {
  return tty === "??" || tty === "?" || tty === "-";
}

// I processi dell'utente con la cartella di lavoro dentro «radice». Sul Mac
// con lsof; su Linux leggendo /proc, che c'è sempre (lsof spesso no).
export function processiConCartellaIn(radice: string, s: Sistema = sistema()): number[] {
  const dentro = (dove: string) => dove === radice || dove.startsWith(radice + "/");
  if (s === "mac") {
    const elenco = spawnSync("lsof", ["-a", "-d", "cwd", "-u", String(process.getuid?.() ?? ""), "-Fpn"], {
      encoding: "utf8",
      timeout: 15_000,
    });
    const trovati: number[] = [];
    let pid = 0;
    for (const riga of String(elenco.stdout ?? "").split("\n")) {
      if (riga.startsWith("p")) pid = Number(riga.slice(1));
      else if (riga.startsWith("n") && dentro(riga.slice(1))) trovati.push(pid);
    }
    return trovati;
  }
  const trovati: number[] = [];
  let voci: string[] = [];
  try {
    voci = readdirSync("/proc");
  } catch {
    return [];
  }
  for (const voce of voci) {
    if (!/^\d+$/.test(voce)) continue;
    try {
      // Solo i processi dell'utente: quelli degli altri non si leggono.
      if (dentro(readlinkSync(`/proc/${voce}/cwd`))) trovati.push(Number(voce));
    } catch {}
  }
  return trovati;
}

// Il tasto per incollare nel terminale: cmd+V sul Mac; ctrl+shift+V nei
// terminali di Linux e in Windows Terminal (WSL).
export function tastoIncolla(s: Sistema = sistema()): string {
  return s === "mac" ? "cmd+V" : "ctrl+shift+V";
}

// Si possono leggere gli appunti? Su Linux servono wl-clipboard, xclip o xsel.
export function appuntiLeggibili(s: Sistema = sistema(), c = esiste): boolean {
  return Boolean(comandiAppunti(s, c).leggi);
}

