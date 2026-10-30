// Ciò che vale per gli archivi delle chiavi di tutti i sistemi: il tipo, il
// nome delle voci per cartella dati, le virgolette. Le versioni per sistema
// stanno in piattaforme/macos/portachiavi.ts e
// piattaforme/linux-windows/portachiavi.ts; src/core/portachiavi.ts sceglie.
import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { cartellaBaseDati } from "../piattaforma.js";

export type Portachiavi = {
  leggi(provider: string): string | undefined;
  // Se la chiave c'è, senza leggerla: per «collegato» e per la sequenza.
  esiste(provider: string): boolean;
  salva(provider: string, chiave: string): void;
  togli(provider: string): boolean;
};

// Un servizio per cartella dati: le prove con una cartella temporanea non
// toccano le chiavi della persona, e Continuity 1 e 2 restano separate.
// Il nome solo non basta: due cartelle «…/a/dati» e «…/b/dati» vedevano e
// cancellavano le stesse chiavi (settimo collaudo, CT-2.0-608). Le cartelle
// in «Application Support» (quelle normali, una per nome) tengono il nome di
// sempre, così le chiavi già salvate restano; ogni altra cartella aggiunge
// un'impronta del suo percorso vero: lo stesso posto raggiunto da un alias
// (/tmp e /private/tmp, un collegamento simbolico) ha lo stesso nome, anche
// quando la cartella non c'è più (ottavo collaudo). scripts/nome-chiavi.sh
// fa lo stesso calcolo per la disinstallazione, e un test li confronta.
export function percorsoVero(percorso: string) {
  let base = resolve(percorso);
  const resto: string[] = [];
  while (!existsSync(base) && dirname(base) !== base) {
    resto.unshift(basename(base));
    base = dirname(base);
  }
  try {
    base = realpathSync(base);
  } catch {}
  return join(base, ...resto);
}

export function servizioPortachiavi(cartellaDati: string, casa = homedir()) {
  const percorso = percorsoVero(cartellaDati);
  const nome = `Continuity · ${basename(percorso)}`;
  // La cartella normale dei dati dei programmi: «Application Support» sul
  // Mac, ~/.local/share su Linux e WSL.
  if (dirname(percorso) === percorsoVero(cartellaBaseDati(casa))) return nome;
  return `${nome} · ${createHash("sha256").update(percorso).digest("hex").slice(0, 8)}`;
}

// Le virgolette di «security -i» seguono le regole della shell: dentro le
// doppie virgolette contano solo \ e ". Una chiave con a capo non è una chiave.
export function tra(valore: string) {
  if (/[\r\n\0]/.test(valore)) throw Error("Valore non valido");
  return '"' + valore.replace(/(["\\])/g, "\\$1") + '"';
}
