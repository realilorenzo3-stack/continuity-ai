// Lo strato «piattaforma»: ciò che cambia fra macOS, Linux e Windows con WSL 2.
// Il resto di Continuity chiede «apri questo link», «copia negli appunti»,
// «dove stanno i dati», senza sapere su quale sistema gira. Le risposte di
// ciascun sistema stanno nella sua distribuzione: piattaforme/macos/sistema.ts e
// piattaforme/linux-windows/sistema.ts (struttura del 30 ottobre: codice comune
// + due distribuzioni). Una modifica qui vale per tutti.
import { execFileSync, spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { esiste, sistema, type Sistema } from "./sistema.js";
import * as mac from "../piattaforme/macos/sistema.js";
import * as lw from "../piattaforme/linux-windows/sistema.js";

export { esiste, sistema, type Sistema };

// Dove stanno i dati dei programmi della persona.
export function cartellaBaseDati(
  casa = homedir(),
  s: Sistema = sistema(),
  ambiente: NodeJS.ProcessEnv = process.env,
): string {
  return s === "mac" ? mac.cartellaBaseDati(casa) : lw.cartellaBaseDati(casa, ambiente);
}

// La cartella dati di Continuity, se la persona non ne indica un'altra con
// CONTINUITY_DATA_DIR.
export function cartellaDatiPredefinita(nome = "Continuity"): string {
  return process.env.CONTINUITY_DATA_DIR ?? join(cartellaBaseDati(), nome);
}

// Una pagina nel browser della persona.
export function comandoApriLink(s: Sistema = sistema(), c = esiste): [string, string[]] | undefined {
  return s === "mac" ? mac.comandoApriLink() : lw.comandoApriLink(s === "wsl", c);
}
export function apriLink(indirizzo: string): boolean {
  const comando = comandoApriLink();
  if (!comando) return false;
  try {
    spawn(comando[0], [...comando[1], indirizzo], { stdio: "ignore", detached: true }).unref();
    return true;
  } catch {
    return false;
  }
}

// Gli appunti. Se non c'è nulla, chi chiama usa la riserva del terminale
// (OSC 52) o lo dice alla persona.
export function comandiAppunti(
  s: Sistema = sistema(),
  c = esiste,
): { copia?: [string, string[]]; leggi?: [string, string[]] } {
  return s === "mac" ? mac.comandiAppunti() : lw.comandiAppunti(s === "wsl", c);
}
export function copiaNegliAppunti(testo: string): boolean {
  const comando = comandiAppunti().copia;
  if (!comando) return false;
  try {
    execFileSync(comando[0], comando[1], { input: testo, timeout: 3000, stdio: ["pipe", "ignore", "ignore"] });
    return true;
  } catch {
    return false;
  }
}
export function leggiAppunti(): string {
  const comando = comandiAppunti().leggi;
  if (!comando) return "";
  try {
    return execFileSync(comando[0], comando[1], { encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return "";
  }
}
// Si possono leggere gli appunti?
export function appuntiLeggibili(s: Sistema = sistema(), c = esiste): boolean {
  return Boolean(comandiAppunti(s, c).leggi);
}

// Una copia veloce di una cartella intera (le dipendenze nella copia di lavoro).
export function argomentiCopiaVeloce(s: Sistema = sistema()): string[] {
  return s === "mac" ? mac.argomentiCopiaVeloce() : lw.argomentiCopiaVeloce();
}
export function copiaVeloce(origine: string, destinazione: string, attesa = 120_000) {
  execFileSync("cp", [...argomentiCopiaVeloce(), origine, destinazione], { stdio: "ignore", timeout: attesa });
}

// «ps» scrive «??» (Mac) o «?» (Linux) per un processo senza terminale.
export function senzaTerminale(tty: string | undefined): boolean {
  return tty === "??" || tty === "?" || tty === "-";
}

// I processi dell'utente con la cartella di lavoro dentro «radice».
export function processiConCartellaIn(radice: string, s: Sistema = sistema()): number[] {
  return s === "mac" ? mac.processiConCartellaIn(radice) : lw.processiConCartellaIn(radice);
}

// La sandbox di Claude Code c'è su questo computer?
export function sandboxClaude(s: Sistema = sistema(), c = esiste): boolean {
  return s === "mac" ? mac.sandboxClaude() : lw.sandboxClaude(c);
}

// Il tasto per incollare nel terminale.
export function tastoIncolla(s: Sistema = sistema()): string {
  return s === "mac" ? mac.tastoIncolla() : lw.tastoIncolla();
}
