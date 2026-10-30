// macOS: cartelle, browser, appunti, copia delle dipendenze, processi.
// Parte della distribuzione macOS (piattaforme/macos/LEGGIMI.md); il resto di
// Continuity la usa attraverso src/piattaforma.ts.
import { spawnSync } from "node:child_process";
import { join } from "node:path";

// I dati dei programmi della persona.
export function cartellaBaseDati(casa: string): string {
  return join(casa, "Library", "Application Support");
}

export function comandoApriLink(): [string, string[]] {
  return ["open", []];
}

export function comandiAppunti(): { copia: [string, string[]]; leggi: [string, string[]] } {
  return { copia: ["pbcopy", []], leggi: ["pbpaste", []] };
}

// La clonazione di APFS: istantanea, senza spazio in più.
export function argomentiCopiaVeloce(): string[] {
  return ["-cR"];
}

// I processi dell'utente con la cartella di lavoro dentro «radice», con lsof.
export function processiConCartellaIn(radice: string): number[] {
  const dentro = (dove: string) => dove === radice || dove.startsWith(radice + "/");
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

// La sandbox di Claude Code c'è sempre (Seatbelt di macOS).
export function sandboxClaude(): boolean {
  return true;
}

export function tastoIncolla(): string {
  return "cmd+V";
}
