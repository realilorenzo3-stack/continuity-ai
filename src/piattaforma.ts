// Lo strato «piattaforma»: ciò che cambia fra macOS, Linux, Windows con WSL 2 e
// Windows nativo.
// Il resto di Continuity chiede «apri questo link», «copia negli appunti»,
// «dove stanno i dati», senza sapere su quale sistema gira. Le risposte di
// ciascun sistema stanno nella sua distribuzione: piattaforme/macos/sistema.ts e
// piattaforme/linux-windows/sistema.ts e piattaforme/windows/sistema.ts
// (struttura del 30 ottobre: codice comune + distribuzioni). Una modifica qui
// vale per tutti.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { cpSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { esiste, sistema, type Sistema } from "./sistema.js";
import * as mac from "../piattaforme/macos/sistema.js";
import * as lw from "../piattaforme/linux-windows/sistema.js";
import * as win from "../piattaforme/windows/sistema.js";
import * as winProc from "../piattaforme/windows/processi.js";

export { esiste, sistema, type Sistema };

// Su Windows nessun programma avviato da Continuity apre una finestra
// (piattaforme/windows/processi.ts, nascondiFinestre).
if (sistema() === "windows") winProc.nascondiFinestre();

// Dove stanno i dati dei programmi della persona.
export function cartellaBaseDati(
  casa = homedir(),
  s: Sistema = sistema(),
  ambiente: NodeJS.ProcessEnv = process.env,
): string {
  if (s === "windows") return win.cartellaBaseDati(casa, ambiente);
  return s === "mac" ? mac.cartellaBaseDati(casa) : lw.cartellaBaseDati(casa, ambiente);
}

// La cartella dati di Continuity, se la persona non ne indica un'altra con
// CONTINUITY_DATA_DIR.
export function cartellaDatiPredefinita(nome = "Continuity"): string {
  return process.env.CONTINUITY_DATA_DIR ?? join(cartellaBaseDati(), nome);
}

// Una pagina nel browser della persona.
export function comandoApriLink(s: Sistema = sistema(), c = esiste): [string, string[]] | undefined {
  if (s === "windows") return win.comandoApriLink();
  return s === "mac" ? mac.comandoApriLink() : lw.comandoApriLink(s === "wsl", c);
}
export function apriLink(indirizzo: string): boolean {
  const comando = comandoApriLink();
  if (!comando) return false;
  try {
    // windowsHide: false, perché il browser si deve vedere.
    spawn(comando[0], [...comando[1], indirizzo], { stdio: "ignore", detached: true, windowsHide: false }).unref();
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
  if (s === "windows") return win.comandiAppunti();
  return s === "mac" ? mac.comandiAppunti() : lw.comandiAppunti(s === "wsl", c);
}
export function copiaNegliAppunti(testo: string): boolean {
  const comando = comandiAppunti().copia;
  if (!comando) return false;
  try {
    execFileSync(comando[0], comando[1], { input: testo, timeout: 5000, stdio: ["pipe", "ignore", "ignore"], windowsHide: true });
    return true;
  } catch {
    return false;
  }
}
export function leggiAppunti(): string {
  const comando = comandiAppunti().leggi;
  if (!comando) return "";
  try {
    return execFileSync(comando[0], comando[1], { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
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
  if (s === "windows") return win.argomentiCopiaVeloce();
  return s === "mac" ? mac.argomentiCopiaVeloce() : lw.argomentiCopiaVeloce();
}
export function copiaVeloce(origine: string, destinazione: string, attesa = 120_000) {
  // Windows non ha «cp»: la stessa copia (i collegamenti restano collegamenti,
  // come con cp -R) la fa Node.
  if (sistema() === "windows") return cpSync(origine, destinazione, { recursive: true, verbatimSymlinks: true });
  execFileSync("cp", [...argomentiCopiaVeloce(), origine, destinazione], { stdio: "ignore", timeout: attesa });
}

// «ps» scrive «??» (Mac) o «?» (Linux) per un processo senza terminale.
export function senzaTerminale(tty: string | undefined): boolean {
  return tty === "??" || tty === "?" || tty === "-";
}

// I processi dell'utente con la cartella di lavoro dentro «radice».
export function processiConCartellaIn(radice: string, s: Sistema = sistema()): number[] {
  if (s === "windows") return win.processiConCartellaIn(radice);
  return s === "mac" ? mac.processiConCartellaIn(radice) : lw.processiConCartellaIn(radice);
}

// La sandbox di Claude Code c'è su questo computer?
export function sandboxClaude(s: Sistema = sistema(), c = esiste): boolean {
  if (s === "windows") return win.sandboxClaude();
  return s === "mac" ? mac.sandboxClaude() : lw.sandboxClaude(c);
}

// Le impostazioni della sandbox di Codex proprie del sistema: solo Windows ne
// ha (piattaforme/windows/sistema.ts); sul Mac e su Linux nessuna.
export function argomentiSandboxCodex(s: Sistema = sistema()): string[] {
  return s === "windows" ? win.argomentiSandboxCodex() : [];
}

// Il tasto per incollare nel terminale.
export function tastoIncolla(s: Sistema = sistema()): string {
  if (s === "windows") return win.tastoIncolla();
  return s === "mac" ? mac.tastoIncolla() : lw.tastoIncolla();
}

// ---- Processi (Windows nativo: piattaforme/windows/processi.ts) ----

// Mac e Linux avviano ogni AI in un gruppo di processi suo, per fermarla con
// tutto ciò che ha avviato. Windows non ha gruppi: un processo staccato non ha
// console, e ogni comando dell'AI ne aprirebbe una nuova (finestre che
// lampeggiano); lì l'albero si ferma con taskkill.
export function gruppoDiProcessi(s: Sistema = sistema()): boolean {
  return s !== "windows";
}

// Ferma un'AI e tutto ciò che ha avviato: su Mac e Linux il segnale al gruppo
// (pid negativo), su Windows taskkill /T /F, sempre immediato. Lancia gli
// errori di process.kill (ESRCH, EPERM) come prima, perché chi chiama li
// distingue.
export function segnalaAlbero(pid: number, segnale: NodeJS.Signals, s: Sistema = sistema()) {
  if (s !== "windows") return void process.kill(-pid, segnale);
  const esito = winProc.fermaAlbero(pid);
  if (esito === "non c'era") throw Object.assign(Error("kill ESRCH"), { code: "ESRCH" });
  if (esito === "errore") throw Object.assign(Error("kill EPERM"), { code: "EPERM" });
}

// Le variabili di sistema che un ambiente ridotto deve comunque avere (solo
// Windows: SystemRoot, USERPROFILE, APPDATA…). Su Mac e Linux nessuna.
export function variabiliDiSistema(s: Sistema = sistema(), ambiente: NodeJS.ProcessEnv = process.env): Record<string, string> {
  return s === "windows" ? winProc.variabiliDiSistema(ambiente) : {};
}

// Tutti i programmi con quel nome nel PATH, in ordine.
export function cercaNelPath(nome: string, s: Sistema = sistema()): string[] {
  if (s === "windows") return winProc.cercaNelPath(nome);
  const r = spawnSync("/usr/bin/which", ["-a", nome], { encoding: "utf8", timeout: 10_000 });
  return (r.stdout ?? "").split("\n").filter(Boolean);
}

// Il nome del file di un programma: «codex.exe» su Windows.
export function nomeEseguibile(nome: string, s: Sistema = sistema()): string {
  return s === "windows" ? winProc.nomeEseguibile(nome) : nome;
}

// Riga di comando e nascita di un processo, dove «ps» non c'è (Windows).
export const infoProcesso = winProc.infoProcesso;

// Una riga di comando da eseguire nel terminale della persona (gli
// installatori ufficiali): sh su Mac e Linux, Windows PowerShell su Windows.
export function rigaDiComando(comando: string, s: Sistema = sistema()): [string, string[]] {
  return s === "windows"
    ? ["powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", comando]]
    : ["sh", ["-c", comando]];
}
