import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { atomic } from "../git/snapshot.js";
import { realpathSync } from "node:fs";
import { processiConCartellaIn, senzaTerminale } from "../piattaforma.js";
export function launch(
  file: string,
  args: string[],
  cwd: string,
  receipt: string,
  options: { env?: NodeJS.ProcessEnv; prompt?: string } = {},
) {
  const child = spawn(file, args, {
    cwd,
    shell: false,
    detached: true,
    env: options.env ?? {
      PATH: process.env.PATH,
      HOME: cwd,
      LANG: "en_US.UTF-8",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.on("error", () => {});
  try {
    atomic(
      receipt,
      JSON.stringify({
        pid: child.pid,
        // Il programma avviato: dopo un riavvio serve a riconoscere il proprio
        // processo, e a non scambiarlo per un altro che ha ereditato il pid.
        binary: file,
        at: new Date().toISOString(),
        status: "spawned",
      }),
    );
  } catch (e) {
    if (child.pid) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {}
    }
    throw e;
  }
  child.stdin?.on("error", () => {});
  child.stdin?.end(options.prompt ?? "");
  return child;
}
// Quanti processi del gruppo sono ancora vivi davvero. Su macOS un gruppo in
// cui restano solo processi terminati e non ancora raccolti (zombie) risponde
// EPERM invece di ESRCH: scambiarlo per un arresto fallito bloccava la sessione
// quando il lavoro era già fermo.
export function viviNelGruppo(pgid: number) {
  const ps = spawnSync("ps", ["-A", "-o", "pgid=,stat="], {
    encoding: "utf8",
    timeout: 5000,
  });
  if (ps.status !== 0) return undefined;
  return ps.stdout
    .split("\n")
    .map((r) => r.trim().split(/\s+/))
    .filter(
      ([g, stato]) => Number(g) === pgid && stato && !stato.startsWith("Z"),
    ).length;
}
// Vero se il gruppo è fermo: nessun processo, oppure solo zombie.
export function fermo(pgid: number) {
  try {
    process.kill(-pgid, 0);
    return false;
  } catch (e: any) {
    if (e.code === "ESRCH") return true;
    if (e.code === "EPERM") {
      const vivi = viviNelGruppo(pgid);
      if (vivi === 0) return true;
    }
    throw e;
  }
}
// I processi vivi di un gruppo, con il nome del programma.
export function processiNelGruppo(pgid: number) {
  const ps = spawnSync("ps", ["-A", "-o", "pid=,pgid=,stat=,comm="], {
    encoding: "utf8",
    timeout: 5000,
  });
  if (ps.status !== 0) return [];
  return ps.stdout
    .split("\n")
    .map((r) => /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(r))
    .filter((m): m is RegExpExecArray => !!m && Number(m[2]) === pgid && !m[3].startsWith("Z"))
    .map((m) => ({ pid: Number(m[1]), comando: m[4].trim() }));
}
function vivo(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    return e.code === "EPERM";
  }
}
// Il segnale a tutto il gruppo. Se il sistema lo rifiuta (EPERM: nel gruppo
// c'è un processo che non si lascia segnalare, per esempio un browser
// avviato da un connettore), lo si manda a uno a uno a quelli che lo
// accettano: prima un solo processo ostinato fermava tutto l'arresto e
// bloccava la sessione (prova di Lorenzo del 23 ottobre, «kill EPERM»).
function segnala(pgid: number, segnale: NodeJS.Signals) {
  try {
    process.kill(-pgid, segnale);
  } catch (e: any) {
    if (e.code === "ESRCH") return;
    if (e.code !== "EPERM") throw e;
    for (const p of processiNelGruppo(pgid))
      try {
        process.kill(p.pid, segnale);
      } catch {}
  }
}
// Ferma l'AI e i processi del suo gruppo. Se l'AI è ferma ma resta qualche
// processo che non si lascia fermare, lo si dice invece di bloccare la
// sessione: il lavoro non è più in corso.
export async function stop(child: ChildProcess): Promise<{ restano: string[] }> {
  if (!child.pid) return { restano: [] };
  const pid = child.pid;
  const finito = () => {
    try {
      return fermo(pid);
    } catch {
      return false;
    }
  };
  segnala(pid, "SIGTERM");
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 20));
    if (finito()) return { restano: [] };
  }
  segnala(pid, "SIGKILL");
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 20));
    if (finito()) return { restano: [] };
  }
  if (vivo(pid)) throw Error("Albero processi non arrestato");
  return {
    restano: processiNelGruppo(pid).map((p) => `${p.comando.split("/").pop()} (${p.pid})`),
  };
}

// Di chi è il gruppo di processi `pgid`. Dopo un crash del servizio il pid
// salvato può appartenere ancora al provider di prima — un writer vivo sulla
// copia di lavoro — oppure, molto più tardi, a un programma qualsiasi che ha
// ricevuto lo stesso numero. «incerto» quando il sistema non risponde: in quel
// caso chi chiama deve restare bloccato, mai procedere.
const PROVIDER_NOTI = /\b(codex|claude|gemini|agy|antigravity)\b|mock-worker/;
export function identificaGruppo(
  pgid: number,
  binario: string | undefined,
  // Quando Continuity l'ha avviato (dalla ricevuta).
  avviatoAlle?: string,
): "fermo" | "nostro" | "altro" | "incerto" {
  const ps = spawnSync(
    "ps",
    ["-o", "pgid=,stat=,lstart=,command=", "-p", String(pgid)],
    { encoding: "utf8", timeout: 5000 },
  );
  if (ps.error) return "incerto";
  const riga = ps.stdout.trim();
  const [gruppo, stato, ...resto] = riga.split(/\s+/);
  // lstart occupa cinque parole: «Wed Oct  7 17:43:33 2026».
  const nato = Date.parse(resto.slice(0, 5).join(" "));
  const comando = resto.slice(5);
  if (riga && !stato?.startsWith("Z")) {
    // Il numero appartiene a un processo vivo: è nostro solo se è ancora il
    // capogruppo e se è il programma che avevamo avviato. Un processo di un
    // altro utente (un demone di sistema) risponde qui come gli altri.
    if (Number(gruppo) !== pgid) return "altro";
    // Dopo un riavvio il numero può toccare a un altro programma, magari
    // proprio un «claude» della persona: è nostro solo se è nato quando lo
    // abbiamo avviato.
    const quando = avviatoAlle ? Date.parse(avviatoAlle) : NaN;
    if (
      Number.isFinite(quando) &&
      Number.isFinite(nato) &&
      Math.abs(nato - quando) > 10_000
    )
      return "altro";
    const testo = comando.join(" ");
    const nome = binario?.split("/").pop();
    if (nome && testo.includes(nome)) return "nostro";
    // Ricevute scritte prima che vi si annotasse il programma, o un lanciatore
    // che cede il posto a un eseguibile con un altro nome.
    if (PROVIDER_NOTI.test(testo) && (!nome || PROVIDER_NOTI.test(nome)))
      return "nostro";
    return "altro";
  }
  // Il capogruppo non c'è più (o è uno zombie): se il gruppo ha ancora membri
  // vivi sono i suoi figli, perché un numero di gruppo non viene riassegnato
  // finché il gruppo esiste.
  const vivi = viviNelGruppo(pgid);
  if (vivi === undefined) return "incerto";
  return vivi > 0 ? "nostro" : "fermo";
}

// Un processo che l'AI ha lanciato in background (un server di prova, un
// watcher) può uscire dal gruppo del CLI e sopravvivere al turno: la sandbox
// di Claude gli impedisce perfino di fermarlo da sé. A fine turno si fermano
// i processi della persona che hanno la cartella di lavoro dentro la copia:
// nessun altro programma lavora lì.
export async function fermaProcessiNellaCartella(
  cartella: string,
  // Inizio del turno: un processo nato prima non è dell'AI di questo turno.
  dalle?: number,
): Promise<number[]> {
  let radice: string;
  try {
    radice = realpathSync(cartella);
  } catch {
    return [];
  }
  const trovati = processiConCartellaIn(radice).filter((pid) => pid > 1 && pid !== process.pid);
  // Solo processi senza terminale e nati durante il turno: un terminale
  // della persona aperto nella copia (o il suo editor) ha un tty e va
  // lasciato stare. L'ambiente dei processi non è leggibile su macOS.
  const dellAI = (p: number) => {
    const riga = spawnSync("ps", ["-o", "tty=,lstart=", "-p", String(p)], {
      encoding: "utf8",
    }).stdout?.trim();
    if (!riga) return false;
    const [tty, ...resto] = riga.split(/\s+/);
    if (!senzaTerminale(tty)) return false;
    const nato = Date.parse(resto.join(" "));
    return (
      dalle === undefined || !Number.isFinite(nato) || nato >= dalle - 2000
    );
  };
  const scelti = trovati.filter(dellAI);
  trovati.length = 0;
  trovati.push(...scelti);
  const segnala = (p: number, s: NodeJS.Signals | 0) => {
    try {
      process.kill(p, s);
      return true;
    } catch {
      return false;
    }
  };
  const vivi = () => trovati.filter((p) => segnala(p, 0));
  for (const p of trovati) segnala(p, "SIGTERM");
  for (let i = 0; i < 20 && vivi().length; i++)
    await new Promise((r) => setTimeout(r, 100));
  for (const p of vivi()) segnala(p, "SIGKILL");
  return trovati;
}
