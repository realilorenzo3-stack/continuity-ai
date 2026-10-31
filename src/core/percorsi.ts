// Confronti fra percorsi che valgono su ogni sistema: con «/» su Mac e Linux,
// con «\» e la lettera del disco su Windows (lavoro 7, Windows nativo, 30
// ottobre). Prima si confrontava `percorso.startsWith(radice + "/")`, che su
// Windows non è mai vero.
import { isAbsolute, relative, resolve } from "node:path";

// Vero se «percorso» sta dentro «radice» (non la radice stessa).
export function dentroDi(radice: string, percorso: string): boolean {
  const r = relative(resolve(radice), resolve(percorso));
  return Boolean(r) && r !== ".." && !r.startsWith(".." + "/") && !r.startsWith(".." + "\\") && !isAbsolute(r);
}

// Vero se «percorso» è la radice o sta dentro.
export function dentroOUguale(radice: string, percorso: string): boolean {
  return relative(resolve(radice), resolve(percorso)) === "" || dentroDi(radice, percorso);
}
