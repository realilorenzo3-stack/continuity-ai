// Linux e WSL: la finestra di scelta di GNOME (zenity), se c'è; altrimenti il
// percorso si scrive o si trascina nel terminale. Annullare non è un errore.
import { execFile } from "node:child_process";
import { esiste } from "../../src/sistema.js";

export function scegliFile(): Promise<string[]> {
  if (!esiste("zenity")) return Promise.resolve([]);
  return new Promise((risolvi) =>
    execFile(
      "zenity",
      ["--file-selection", "--multiple", "--separator=\n", "--title=Allega a Continuity"],
      { timeout: 10 * 60 * 1000 },
      (errore, uscita) => risolvi(errore ? [] : String(uscita).split("\n").map((r) => r.trim()).filter(Boolean)),
    ),
  );
}
