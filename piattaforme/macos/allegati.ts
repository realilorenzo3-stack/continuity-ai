// macOS: la finestra del Finder per scegliere uno o più file da allegare
// (osascript, «choose file»). Annullare non è un errore: si torna senza nulla.
import { execFile } from "node:child_process";

export function scegliFile(): Promise<string[]> {
  const script = [
    'set scelti to choose file with prompt "Allega a Continuity" with multiple selections allowed',
    'set fuori to ""',
    "repeat with f in scelti",
    "set fuori to fuori & POSIX path of f & linefeed",
    "end repeat",
    "return fuori",
  ];
  return new Promise((risolvi) =>
    execFile("/usr/bin/osascript", script.flatMap((riga) => ["-e", riga]), { timeout: 10 * 60 * 1000 }, (errore, uscita) =>
      risolvi(errore ? [] : String(uscita).split("\n").map((r) => r.trim()).filter(Boolean)),
    ),
  );
}
