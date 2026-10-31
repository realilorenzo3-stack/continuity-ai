// Le prove che sostituiscono il lancio di Codex e Claude Code leggono comunque
// la versione delle loro CLI. Dove le CLI non sono installate (le prove su
// Ubuntu con GitHub Actions) ne prepara due finte; dove ci sono (il Mac di
// Lorenzo) non cambia nulla.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pickProvider, providerCandidates } from "../src/adapters/resolve.js";

// La stessa ricerca di Continuity (PATH, estensioni degli editor, cartelle
// note), senza la cartella dati: le prove ne usano una propria.
const installata = (nome: "codex" | "claude") => {
  try {
    pickProvider(nome, providerCandidates(nome, mkdtempSync(join(tmpdir(), "cli-cerca-"))));
    return true;
  } catch {
    return false;
  }
};

// Rispondono alla versione e al controllo del login (src/adapters/live.ts):
// «codex login status» e «claude auth status». Nient'altro.
const RISPOSTE = {
  codex: `[ "$1" = --version ] && echo "codex-cli 0.200.0" && exit 0
[ "$1 $2" = "login status" ] && echo "Logged in using ChatGPT" && exit 0`,
  claude: `[ "$1" = --version ] && echo "2.1.300 (Claude Code)" && exit 0
[ "$1 $2" = "auth status" ] && echo '{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty"}' && exit 0`,
};
// Su Windows Continuity avvia solo programmi .exe: le stesse risposte in un
// piccolo programma C#, compilato con csc.exe del .NET Framework (c'è in ogni
// Windows, anche su GitHub Actions). Si compila una volta e si riusa: questo
// file gira prima di ogni file di prove (31 ottobre: senza, su GitHub le prove
// che leggono la versione di Codex fallivano).
const RISPOSTE_WINDOWS = {
  codex: { versione: "codex-cli 0.200.0", stato: "login status", testo: "Logged in using ChatGPT" },
  claude: {
    versione: "2.1.300 (Claude Code)",
    stato: "auth status",
    testo: '{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty"}',
  },
};
function exeFinto(nome: "codex" | "claude"): string {
  const r = RISPOSTE_WINDOWS[nome];
  const stringa = (s: string) => '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
  const sorgente = `class P { static int Main(string[] a) {
  string j = string.Join(" ", a);
  if (j == "--version") { System.Console.WriteLine(${stringa(r.versione)}); return 0; }
  if (j.StartsWith(${stringa(r.stato)})) { System.Console.WriteLine(${stringa(r.testo)}); return 0; }
  return 1; } }`;
  const cartella = join(tmpdir(), `continuity-cli-finta-${nome}-${createHash("sha256").update(sorgente).digest("hex").slice(0, 10)}`);
  const exe = join(cartella, `${nome}.exe`);
  if (existsSync(exe)) return exe;
  mkdirSync(cartella, { recursive: true });
  writeFileSync(join(cartella, "p.cs"), sorgente);
  const csc = join(process.env.WINDIR ?? "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");
  // Scritto a parte e poi rinominato: due file di prove non trovano mai un .exe a metà.
  const provvisorio = join(cartella, `${nome}-${process.pid}.exe`);
  execFileSync(csc, ["/nologo", `/out:${provvisorio}`, join(cartella, "p.cs")], { stdio: "ignore" });
  try {
    renameSync(provvisorio, exe);
  } catch {}
  return existsSync(exe) ? exe : provvisorio;
}

for (const nome of ["codex", "claude"] as const) {
  const variabile = `CONTINUITY_${nome.toUpperCase()}_BIN`;
  // CONTINUITY_PROVE_SENZA_CLI=1: come su Ubuntu, anche dove le CLI ci sono.
  if (process.env[variabile] || (!process.env.CONTINUITY_PROVE_SENZA_CLI && installata(nome))) continue;
  let file: string;
  if (process.platform === "win32") file = exeFinto(nome);
  else {
    const cartella = mkdtempSync(join(tmpdir(), `cli-finta-${nome}-`));
    file = join(cartella, nome);
    writeFileSync(file, `#!/bin/sh\n${RISPOSTE[nome]}\nexit 1\n`);
    chmodSync(file, 0o755);
  }
  process.env[variabile] = file;
  // Le prove che vogliono la CLI vera lo sanno da qui.
  process.env.CONTINUITY_CLI_FINTE = [process.env.CONTINUITY_CLI_FINTE, nome].filter(Boolean).join(",");
}
