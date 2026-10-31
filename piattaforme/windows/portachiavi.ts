// Windows nativo: le chiavi nell'archivio credenziali di Windows
// (PasswordVault), protetto dal login di Windows. È lo stesso archivio che usa
// Continuity in WSL: il codice che gli parla attraverso PowerShell sta in
// piattaforme/linux-windows/portachiavi.ts e qui si riusa, con il comando e il
// messaggio di Windows nativo. La chiave entra sempre dallo standard input.
import { spawnSync } from "node:child_process";
import type { Portachiavi } from "../../src/core/archivio.js";
import { portachiaviWindows as archivioCredenziali } from "../linux-windows/portachiavi.js";

export function portachiaviWindows(cartellaDati: string, comando = "powershell.exe"): Portachiavi {
  return archivioCredenziali(
    cartellaDati,
    comando,
    "L'archivio credenziali di Windows non risponde: Windows PowerShell (powershell.exe) non si avvia o non trova l'archivio",
  );
}

// L'archivio risponde se PowerShell di Windows si avvia.
export function archivioDisponibile(comando = "powershell.exe"): boolean {
  const r = spawnSync(comando, ["-NoProfile", "-NonInteractive", "-Command", "exit 0"], {
    timeout: 20_000,
    windowsHide: true,
  });
  return !r.error && r.status === 0;
}
