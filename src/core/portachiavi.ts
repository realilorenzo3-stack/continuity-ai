// Le chiavi dei provider stanno nell'archivio protetto del sistema: il
// Portachiavi di macOS, il portachiavi di Linux (libsecret), l'archivio
// credenziali di Windows quando Continuity gira in WSL (decisione di Lorenzo
// del 29 ottobre). Mai nel progetto, mai nei file di Continuity, mai a schermo,
// mai date alle AI. opencode le tiene in chiaro in un database
// (docs/rea/provider.md): qui no.
//
// Questo file sceglie l'archivio del sistema in uso. Le parti comuni stanno in
// archivio.ts, quelle di ciascun sistema in piattaforme/<sistema>/portachiavi.ts
// (struttura del 30 ottobre: codice comune + due distribuzioni).
import { sistema, type Sistema } from "../piattaforma.js";
import type { Portachiavi } from "./archivio.js";
import { NOTA_CONFERMA, portachiaviMac } from "../../piattaforme/macos/portachiavi.js";
import {
  archivioDisponibile,
  portachiaviFile,
  portachiaviLinux,
  portachiaviWindows,
} from "../../piattaforme/linux-windows/portachiavi.js";
import { existsSync } from "node:fs";
import { join } from "node:path";
export { percorsoVero, servizioPortachiavi, tra, type Portachiavi } from "./archivio.js";
export { NOTA_CONFERMA, portachiaviMac } from "../../piattaforme/macos/portachiavi.js";
export {
  archivioDisponibile,
  codificaPowerShell,
  portachiaviFile,
  portachiaviLinux,
  portachiaviWindows,
  scriptVault,
  spiegaPortachiaviLinux,
} from "../../piattaforme/linux-windows/portachiavi.js";
import { ricordaSegreto } from "../persistence/redact.js";

// Durante le prove automatiche l'archivio vero del sistema non si usa mai: una
// prova che si dimentica di sostituirlo scriverebbe chiavi finte nel
// Portachiavi della persona (29 ottobre: successo con due prove della TUI,
// voci tolte). Le prove dell'archivio vero chiamano portachiaviMac,
// portachiaviLinux e portachiaviWindows con un comando finto.
const archiviDiProva = new Map<string, Map<string, string>>();

// L'archivio giusto per il sistema su cui gira Continuity.
export function portachiaviDiSistema(cartellaDati: string, s: Sistema = sistema()): Portachiavi {
  if (process.env.VITEST) {
    const voci = archiviDiProva.get(cartellaDati) ?? new Map<string, string>();
    archiviDiProva.set(cartellaDati, voci);
    return {
      leggi: (p) => voci.get(p),
      esiste: (p) => voci.has(p),
      salva: (p, c) => void voci.set(p, c),
      togli: (p) => voci.delete(p),
    };
  }
  const dove = archivioScelto(cartellaDati, s);
  if (dove === "mac") return portachiaviMac(cartellaDati);
  if (dove === "windows") return portachiaviWindows(cartellaDati);
  if (dove === "libsecret") return portachiaviLinux(cartellaDati);
  return portachiaviFile(cartellaDati);
}

// Quale archivio: quello del sistema se risponde, altrimenti il file protetto
// (decisione del 30 ottobre). Una chiave già salvata nel file resta lì: si
// continua a usare il file, finché la persona non la ricollega.
export type Archivio = "mac" | "libsecret" | "windows" | "file";
const scelti = new Map<string, Archivio>();
export function archivioScelto(cartellaDati: string, s: Sistema = sistema()): Archivio {
  if (s === "mac") return "mac";
  const chiave = `${s}\0${cartellaDati}`;
  const ricordato = scelti.get(chiave);
  if (ricordato) return ricordato;
  const scelto: Archivio = existsSync(join(cartellaDati, "chiavi.json"))
    ? "file"
    : archivioDisponibile(s === "wsl")
      ? s === "wsl"
        ? "windows"
        : "libsecret"
      : "file";
  scelti.set(chiave, scelto);
  return scelto;
}

// Che cosa dire alla persona quando collega una chiave.
export function notaArchivio(cartellaDati?: string, s: Sistema = sistema()): string {
  const dove = cartellaDati ? archivioScelto(cartellaDati, s) : s === "mac" ? "mac" : s === "wsl" ? "windows" : "libsecret";
  if (dove === "mac") return NOTA_CONFERMA;
  if (dove === "windows") return "La chiave va nell'archivio credenziali di Windows, protetto dal tuo login di Windows.";
  if (dove === "libsecret") return "La chiave va nel portachiavi di Linux (libsecret), protetto dal tuo login.";
  return "Su questo computer non c'è un archivio protetto delle chiavi: la chiave va in un file nella cartella dati di Continuity, leggibile solo dal tuo utente. Chi può usare il tuo account può leggerla.";
}

// Per i test: le stesse regole, in memoria.
export function portachiaviInMemoria(
  iniziali: Record<string, string> = {},
): Portachiavi {
  const voci = new Map(Object.entries(iniziali));
  for (const c of voci.values()) ricordaSegreto(c);
  return {
    leggi: (p) => voci.get(p),
    esiste: (p) => voci.has(p),
    salva: (p, c) => {
      ricordaSegreto(c);
      voci.set(p, c);
    },
    togli: (p) => voci.delete(p),
  };
}
