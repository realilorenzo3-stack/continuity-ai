// Allegare senza scrivere percorsi (richiesta di Lorenzo del 15 ottobre):
// - trascinando un file dal Finder dentro il terminale, il Terminale incolla il
//   suo percorso (fra apici, o con gli spazi scritti «\ »): qui lo si
//   riconosce e diventa un allegato invece di testo;
// - il «+» accanto al campo e «/allega» senza nulla aprono la finestra del
//   Finder per sceglierli (osascript, «choose file»).
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, sep } from "node:path";
import { sistema } from "../piattaforma.js";
import { scegliFile as scegliFileMac } from "../../piattaforme/macos/allegati.js";
import { scegliFile as scegliFileLinux } from "../../piattaforme/linux-windows/allegati.js";

// Le parole di un testo come le scrive il Terminale trascinando file: apici
// singoli o doppi, oppure spazi e caratteri speciali preceduti da «\».
export function parole(testo: string): string[] {
  const fuori: string[] = [];
  let attuale = "";
  let apice: string | undefined;
  let dentro = false;
  for (let i = 0; i < testo.length; i++) {
    const c = testo[i];
    if (apice) {
      if (c === apice) apice = undefined;
      else attuale += c;
      continue;
    }
    if (c === "'" || c === '"') {
      apice = c;
      dentro = true;
      continue;
    }
    if (c === "\\" && i + 1 < testo.length) {
      attuale += testo[++i];
      dentro = true;
      continue;
    }
    if (/\s/.test(c)) {
      if (dentro || attuale) fuori.push(attuale);
      attuale = "";
      dentro = false;
      continue;
    }
    attuale += c;
    dentro = true;
  }
  if (dentro || attuale) fuori.push(attuale);
  return fuori;
}

function èFile(percorso: string) {
  try {
    return existsSync(percorso) && statSync(percorso).isFile();
  } catch {
    return false;
  }
}

// Un testo fatto solo di percorsi di file esistenti (ciò che arriva
// trascinando uno o più file): restituisce i percorsi, altrimenti niente.
export function soloFileTrascinati(testo: string): string[] | undefined {
  const t = testo.trim();
  if (!t || t.length > 8000) return undefined;
  const elenco = parole(t).map((p) => p.replace(/^~(?=\/|$)/, homedir()));
  if (!elenco.length || !elenco.every((p) => p.startsWith("/") && èFile(p)))
    return undefined;
  return elenco;
}

// All'invio: i percorsi di file che stanno FUORI dal progetto diventano
// allegati (l'AI non potrebbe leggerli dalla sua copia); quelli dentro il
// progetto restano testo, perché l'AI li trova già.
export function fileFuoriProgetto(testo: string, progetto: string): string[] {
  const radice = resolve(progetto) + sep;
  return parole(testo)
    .map((p) => p.replace(/^~(?=\/|$)/, homedir()))
    .filter((p) => p.startsWith("/") && !resolve(p).startsWith(radice) && èFile(p));
}

// La finestra del sistema per scegliere uno o più file (Finder sul Mac,
// zenity su Linux): in piattaforme/<sistema>/allegati.ts.
export function scegliDalFinder(): Promise<string[]> {
  return sistema() === "mac" ? scegliFileMac() : scegliFileLinux();
}
