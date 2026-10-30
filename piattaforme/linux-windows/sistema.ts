// Linux e Windows con WSL 2: cartelle, browser, appunti, copia delle
// dipendenze, processi. Parte della distribuzione Linux/Windows
// (piattaforme/linux-windows/LEGGIMI.md); il resto di Continuity la usa
// attraverso src/piattaforma.ts.
import { existsSync, readdirSync, readFileSync, readlinkSync } from "node:fs";
import { join } from "node:path";

// La cartella XDG dei dati (un XDG_DATA_HOME relativo non vale).
export function cartellaBaseDati(casa: string, ambiente: NodeJS.ProcessEnv): string {
  const xdg = ambiente.XDG_DATA_HOME;
  return xdg && xdg.startsWith("/") ? xdg : join(casa, ".local", "share");
}

// In WSL il browser è quello di Windows: «wslview» se c'è, altrimenti
// Esplora risorse di Windows, che apre gli indirizzi con il browser predefinito.
export function comandoApriLink(wsl: boolean, c: (n: string) => boolean): [string, string[]] | undefined {
  if (wsl) {
    if (c("wslview")) return ["wslview", []];
    if (c("explorer.exe")) return ["explorer.exe", []];
  }
  if (c("xdg-open")) return ["xdg-open", []];
  return undefined;
}

// Su Linux con Wayland o X11 servono wl-clipboard, xclip o xsel; in WSL i
// programmi di Windows.
export function comandiAppunti(
  wsl: boolean,
  c: (n: string) => boolean,
): { copia?: [string, string[]]; leggi?: [string, string[]] } {
  const copia: [string, string[]][] = [];
  const leggi: [string, string[]][] = [];
  if (wsl) {
    copia.push(["clip.exe", []]);
    leggi.push(["powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "Get-Clipboard"]]);
  }
  copia.push(["wl-copy", []], ["xclip", ["-selection", "clipboard"]], ["xsel", ["--clipboard", "--input"]]);
  leggi.push(["wl-paste", ["--no-newline"]], ["xclip", ["-selection", "clipboard", "-o"]], ["xsel", ["--clipboard", "--output"]]);
  return { copia: copia.find(([n]) => c(n)), leggi: leggi.find(([n]) => c(n)) };
}

// Dove il disco la permette (Btrfs, XFS) una copia istantanea, altrimenti una
// copia normale: mai un collegamento alle cartelle della persona.
export function argomentiCopiaVeloce(): string[] {
  return ["-R", "--reflink=auto"];
}

// I processi dell'utente con la cartella di lavoro dentro «radice»: da /proc,
// che c'è sempre (lsof spesso no).
export function processiConCartellaIn(radice: string): number[] {
  const dentro = (dove: string) => dove === radice || dove.startsWith(radice + "/");
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

// La sandbox di Claude Code su Linux e WSL 2: servono bubblewrap e socat, e
// che Ubuntu (AppArmor) non blocchi bubblewrap (code.claude.com/docs/en/sandboxing).
export function sandboxClaude(c: (n: string) => boolean): boolean {
  if (!c("bwrap") || !c("socat")) return false;
  try {
    return readFileSync("/proc/sys/kernel/apparmor_restrict_unprivileged_userns", "utf8").trim() !== "1" ||
      existsSync("/etc/apparmor.d/bwrap");
  } catch {
    return true;
  }
}

// Nei terminali di Linux e in Windows Terminal.
export function tastoIncolla(): string {
  return "ctrl+shift+V";
}
