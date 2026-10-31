// Windows nativo: i processi delle AI. Su Windows non ci sono i gruppi di
// processi di Unix (process.kill(-pid)) né «ps»: un'AI si ferma con tutto il
// suo albero (taskkill /T /F), e di un processo si chiedono riga di comando e
// ora di nascita a Windows (Win32_Process). Parte della distribuzione Windows
// (piattaforme/windows/LEGGIMI.md); il codice comune la usa attraverso
// src/piattaforma.ts.
import { spawnSync } from "node:child_process";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { win32 } from "node:path";

// Nessuna finestra per i programmi che Continuity avvia. Il servizio gira
// staccato dal terminale (altrimenti Windows lo chiuderebbe con il terminale:
// Node mette i figli non staccati in un «job» che muore con il padre), e un
// processo staccato non ha console: ogni git, AI o comando che avvia ne
// aprirebbe una visibile. Qui windowsHide diventa il valore di serie di tutte
// le funzioni di node:child_process; chi deve mostrare una finestra (la scelta
// dei file, il browser) lo chiede con windowsHide: false. Si fa una volta,
// all'avvio (src/piattaforma.ts), solo su Windows.
let nascoste = false;
export function nascondiFinestre() {
  if (nascoste) return;
  nascoste = true;
  const cp = createRequire(import.meta.url)("node:child_process") as Record<string, any>;
  const conArgomenti = (nome: string) => {
    const originale = cp[nome];
    cp[nome] = function (this: unknown, comando: unknown, ...resto: any[]) {
      return originale.call(this, comando, ...conNascosta(resto, true));
    };
  };
  const senzaArgomenti = (nome: string) => {
    const originale = cp[nome];
    cp[nome] = function (this: unknown, comando: unknown, ...resto: any[]) {
      return originale.call(this, comando, ...conNascosta(resto, false));
    };
  };
  for (const n of ["spawn", "spawnSync", "execFile", "execFileSync"]) conArgomenti(n);
  for (const n of ["exec", "execSync"]) senzaArgomenti(n);
  // Anche gli «import { spawn } from "node:child_process"» già fatti.
  syncBuiltinESMExports();
}

// Gli argomenti dopo il comando, con windowsHide: true se nessuno l'ha scelto.
export function conNascosta(resto: any[], argomenti: boolean): any[] {
  const fuori = [...resto];
  // spawn(comando, undefined, …): l'elenco vuoto.
  if (argomenti && fuori.length && fuori[0] == null) fuori[0] = [];
  const i = fuori.findIndex((x) => x && typeof x === "object" && !Array.isArray(x));
  if (i >= 0) {
    fuori[i] = { windowsHide: true, ...fuori[i] };
    return fuori;
  }
  // Nessuna opzione: si aggiungono dopo l'elenco degli argomenti e prima
  // dell'eventuale funzione di ritorno.
  let dove = fuori.findIndex((x) => typeof x === "function");
  if (dove < 0) dove = fuori.length;
  if (argomenti && !Array.isArray(fuori[0])) {
    fuori.splice(dove, 0, [], { windowsHide: true });
    return fuori;
  }
  fuori.splice(dove, 0, { windowsHide: true });
  return fuori;
}

// Ferma il processo e tutti quelli che ha avviato. Windows non ha un
// «arresto gentile» per i programmi da terminale: si chiude subito.
export function fermaAlbero(pid: number): "fermato" | "non c'era" | "errore" {
  const r = spawnSync("taskkill.exe", ["/T", "/F", "/PID", String(pid)], {
    encoding: "utf8",
    timeout: 15_000,
    windowsHide: true,
  });
  if (r.error) return "errore";
  if (r.status === 0) return "fermato";
  // 128: nessun processo con quel numero.
  return r.status === 128 ? "non c'era" : "errore";
}

// Riga di comando e nascita (millisecondi) di un processo; undefined se non
// c'è, «incerto» se Windows non risponde. PowerShell impiega circa un secondo:
// serve solo dopo un riavvio del servizio, non a ogni turno.
export function infoProcesso(pid: number): { comando: string; nato: number } | undefined | "incerto" {
  const script =
    "[Console]::OutputEncoding=[Text.Encoding]::UTF8;" +
    `$p=Get-CimInstance Win32_Process -Filter 'ProcessId=${Math.trunc(pid)}';` +
    "if($p){[Console]::Out.Write($p.CreationDate.ToUniversalTime().ToString('o')+\"`n\"+$p.CommandLine)}";
  const r = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    timeout: 20_000,
    windowsHide: true,
  });
  if (r.error || r.status !== 0) return "incerto";
  const uscita = String(r.stdout ?? "");
  if (!uscita.trim()) return undefined;
  const [nascita, ...comando] = uscita.split("\n");
  return { comando: comando.join("\n").trim(), nato: Date.parse(nascita.trim()) };
}

// Le variabili senza le quali i programmi di Windows non funzionano: senza
// SystemRoot la rete non parte, senza USERPROFILE e APPDATA Codex e Claude
// Code non trovano il loro login. Si aggiungono a ogni ambiente ridotto che
// Continuity prepara per un programma (il PATH c'è già).
const DI_SISTEMA = [
  "SystemRoot",
  "SystemDrive",
  "windir",
  "ComSpec",
  "PATHEXT",
  "USERPROFILE",
  "USERNAME",
  "USERDOMAIN",
  "HOMEDRIVE",
  "HOMEPATH",
  "APPDATA",
  "LOCALAPPDATA",
  "ProgramData",
  "ProgramFiles",
  "ProgramFiles(x86)",
  "ProgramW6432",
  "CommonProgramFiles",
  "TEMP",
  "TMP",
  "COMPUTERNAME",
  "OS",
  "PROCESSOR_ARCHITECTURE",
  "NUMBER_OF_PROCESSORS",
];
export function variabiliDiSistema(ambiente: NodeJS.ProcessEnv): Record<string, string> {
  const fuori: Record<string, string> = {};
  for (const nome of DI_SISTEMA) {
    const valore = ambiente[nome];
    if (valore) fuori[nome] = valore;
  }
  return fuori;
}

// Gli eseguibili con quel nome nel PATH, in ordine. Solo i veri programmi
// (.exe): gli script .cmd di npm non si avviano senza cmd.exe, che
// interpreterebbe gli argomenti; Codex e Claude Code per Windows hanno i loro
// installatori ufficiali, che mettono un .exe.
// La risposta resta valida 30 secondi: where.exe costa circa 100 ms, e il
// servizio cercava Codex e Claude a ogni aggiornamento dell'interfaccia (ogni
// 2 secondi), bloccandosi un quinto del tempo (31 ottobre). Un programma
// appena installato si trova al più tardi dopo mezzo minuto; quelli nelle
// cartelle degli installatori ufficiali subito (src/adapters/resolve.ts).
const trovati = new Map<string, { quando: number; percorsi: string[] }>();
export function cercaNelPath(nome: string, adesso = Date.now()): string[] {
  const chiave = nome + "\0" + (process.env.PATH ?? "");
  const nota = trovati.get(chiave);
  if (nota && adesso - nota.quando < 30_000) return [...nota.percorsi];
  const r = spawnSync("where.exe", [nome], { encoding: "utf8", timeout: 10_000, windowsHide: true });
  const percorsi = String(r.stdout ?? "")
    .split(/\r?\n/)
    .map((riga) => riga.trim())
    .filter((riga) => riga && win32.extname(riga).toLowerCase() === ".exe");
  trovati.set(chiave, { quando: adesso, percorsi });
  return [...percorsi];
}

// Il nome del file di un programma: «codex» diventa «codex.exe».
export function nomeEseguibile(nome: string): string {
  return /\.exe$/i.test(nome) ? nome : nome + ".exe";
}
