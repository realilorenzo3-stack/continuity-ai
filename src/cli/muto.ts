// L'uscita del lettore di riga, con un interruttore: mentre si incolla una
// chiave il terminale non la riscrive. Readline scrive qui invece che
// direttamente sul terminale; tutto il resto passa uguale.
import { Writable } from "node:stream";
import { stdout } from "node:process";

let muto = false;

export const uscitaLettore = new Writable({
  write(pezzo, codifica, fatto) {
    if (!muto) stdout.write(pezzo, codifica as BufferEncoding);
    fatto();
  },
}) as Writable & { columns?: number; rows?: number; isTTY?: boolean };
// Readline impagina con le dimensioni dell'uscita: quelle vere del terminale.
Object.defineProperty(uscitaLettore, "columns", { get: () => stdout.columns });
Object.defineProperty(uscitaLettore, "rows", { get: () => stdout.rows });
Object.defineProperty(uscitaLettore, "isTTY", { get: () => stdout.isTTY });
stdout.on("resize", () => uscitaLettore.emit("resize"));

// Chiede una riga senza mostrarla: l'invito si scrive prima, poi silenzio fino
// all'invio.
export async function inSilenzio<T>(invito: string, leggi: () => Promise<T>) {
  stdout.write(invito);
  muto = true;
  try {
    return await leggi();
  } finally {
    muto = false;
    stdout.write("\n");
  }
}
