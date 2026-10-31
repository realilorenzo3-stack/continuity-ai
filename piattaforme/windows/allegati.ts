// Windows: la finestra «Apri» di Windows per scegliere uno o più file da
// allegare (PowerShell con Windows Forms, che chiede un thread STA). Annullare
// non è un errore: si torna senza nulla.
import { execFile } from "node:child_process";

export function scegliFile(): Promise<string[]> {
  const script = [
    "[Console]::OutputEncoding=[Text.Encoding]::UTF8",
    "Add-Type -AssemblyName System.Windows.Forms",
    "$f=New-Object System.Windows.Forms.OpenFileDialog",
    "$f.Multiselect=$true",
    "$f.Title='Allega a Continuity'",
    // Aperta da un programma in sottofondo, Windows la metterebbe dietro il
    // terminale: una finestra invisibile «sempre davanti» le fa da padre.
    "$p=New-Object System.Windows.Forms.Form -Property @{TopMost=$true;ShowInTaskbar=$false;Opacity=0}",
    "$p.Show();$p.Activate()",
    "$r=$f.ShowDialog($p);$p.Close()",
    "if($r -eq 'OK'){$f.FileNames -join \"`n\"}",
  ].join(";");
  return new Promise((risolvi) =>
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-STA", "-Command", script],
      // Senza windowsHide: nascondere la finestra di PowerShell nasconderebbe
      // anche la prima finestra che apre, cioè la scelta dei file.
      { timeout: 10 * 60 * 1000, windowsHide: false },
      (errore, uscita) => risolvi(errore ? [] : String(uscita).split(/\r?\n/).map((r) => r.trim()).filter(Boolean)),
    ),
  );
}
