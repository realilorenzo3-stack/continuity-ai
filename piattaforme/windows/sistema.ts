// Windows nativo, senza WSL: cartelle, browser, appunti, copia delle
// dipendenze, processi. Parte della distribuzione Windows
// (piattaforme/windows/LEGGIMI.md); il resto di Continuity la usa attraverso
// src/piattaforma.ts.
// Percorsi di Windows anche quando le prove girano su Linux o sul Mac.
import { win32 } from "node:path";

// I dati dei programmi della persona: %LOCALAPPDATA% (AppData\Local), che non
// si sincronizza con il profilo in rete come AppData\Roaming. Le copie di
// lavoro dei progetti sono grandi.
export function cartellaBaseDati(casa: string, ambiente: NodeJS.ProcessEnv): string {
  const locale = ambiente.LOCALAPPDATA;
  return locale && win32.isAbsolute(locale) ? locale : win32.join(casa, "AppData", "Local");
}

// Esplora risorse apre gli indirizzi con il browser predefinito. L'indirizzo
// arriva come argomento, senza passare da cmd.exe (che interpreta «&»).
export function comandoApriLink(): [string, string[]] {
  return ["explorer.exe", []];
}

// PowerShell, in UTF-8 in entrata e in uscita: clip.exe e la console di
// Windows usano la tabella di caratteri di sistema e rovinano le lettere
// accentate.
const POWERSHELL = ["-NoProfile", "-NonInteractive", "-Command"];
export function comandiAppunti(): { copia: [string, string[]]; leggi: [string, string[]] } {
  return {
    copia: [
      "powershell.exe",
      [...POWERSHELL, "[Console]::InputEncoding=[Text.Encoding]::UTF8;Set-Clipboard -Value ([Console]::In.ReadToEnd())"],
    ],
    leggi: [
      "powershell.exe",
      [...POWERSHELL, "[Console]::OutputEncoding=[Text.Encoding]::UTF8;[Console]::Out.Write((Get-Clipboard -Raw))"],
    ],
  };
}

// Windows non ha «cp»: la copia la fa Node (src/piattaforma.ts, copiaVeloce).
export function argomentiCopiaVeloce(): string[] {
  return [];
}

// Windows non permette di leggere la cartella di lavoro di un altro processo
// senza codice nativo: nessuno. I processi dell'AI si fermano con tutto il loro
// albero (taskkill /T, processi.ts).
export function processiConCartellaIn(_radice: string): number[] {
  return [];
}

// Claude Code su Windows nativo non ha sandbox: lavora chiedendo il permesso
// per ogni comando, o libero con /permessi.
export function sandboxClaude(): boolean {
  return false;
}

// Windows Terminal e la console di Windows incollano con ctrl+V.
export function tastoIncolla(): string {
  return "ctrl+V";
}
