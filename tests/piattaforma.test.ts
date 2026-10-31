// Lo strato piattaforma (CONTINUITY_2.0.md §9.1 punto 2): che cosa fa
// Continuity su Mac, Linux e WSL. Le parti che chiamano il sistema si provano
// con programmi finti, così le stesse prove valgono su ogni sistema.
import { it, expect, afterEach } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  argomentiCopiaVeloce,
  cartellaBaseDati as base,
  comandiAppunti,
  comandoApriLink,
  processiConCartellaIn,
  senzaTerminale,
  sistema,
} from "../src/piattaforma.js";
import { codificaPowerShell, portachiaviLinux, portachiaviWindows, scriptVault } from "../src/core/portachiavi.js";
import { redact } from "../src/persistence/redact.js";

// Le prove con programmi finti scritti per «sh» valgono per Mac e Linux: su
// Windows non si possono eseguire.
const suWindows = process.platform === "win32";
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
const temp = (n: string) => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), n)));
  dirs.push(d);
  return d;
};

it("riconosce il sistema: Mac, Linux, e WSL dal kernel di Microsoft o dalla variabile di WSL", () => {
  expect(sistema("darwin", {}, () => "")).toBe("mac");
  expect(sistema("linux", {}, () => "Linux version 6.8.0-45-generic (buildd@lcy02)")).toBe("linux");
  expect(sistema("linux", {}, () => "Linux version 5.15.153.1-microsoft-standard-WSL2")).toBe("wsl");
  expect(sistema("linux", { WSL_DISTRO_NAME: "Ubuntu" }, () => "")).toBe("wsl");
  expect(sistema("win32", {}, () => "")).toBe("windows");
});

it("la cartella dei dati: Application Support sul Mac, XDG su Linux e WSL", () => {
  const cartellaBaseDati = (...a: Parameters<typeof base>) => base(...a).replaceAll("\\", "/");
  expect(cartellaBaseDati("/Users/anna", "mac", {})).toBe("/Users/anna/Library/Application Support");
  expect(cartellaBaseDati("/home/anna", "linux", {})).toBe("/home/anna/.local/share");
  expect(cartellaBaseDati("/home/anna", "wsl", { XDG_DATA_HOME: "/dati/xdg" })).toBe("/dati/xdg");
  // Un XDG_DATA_HOME relativo non vale (specifica XDG).
  expect(cartellaBaseDati("/home/anna", "linux", { XDG_DATA_HOME: "relativa" })).toBe("/home/anna/.local/share");
});

it("Windows: dati in %LOCALAPPDATA%, link con Esplora risorse, appunti con PowerShell in UTF-8, nessun processo da cercare", () => {
  expect(base("C:\\Users\\anna", "windows", { LOCALAPPDATA: "D:\\Locale" })).toBe("D:\\Locale");
  expect(base("C:\\Users\\anna", "windows", {})).toBe("C:\\Users\\anna\\AppData\\Local");
  expect(base("C:\\Users\\anna", "windows", { LOCALAPPDATA: "relativa" })).toBe("C:\\Users\\anna\\AppData\\Local");
  expect(comandoApriLink("windows", () => false)).toEqual(["explorer.exe", []]);
  const appunti = comandiAppunti("windows", () => false);
  expect(appunti.copia?.[0]).toBe("powershell.exe");
  expect(appunti.copia?.[1].join(" ")).toContain("InputEncoding=[Text.Encoding]::UTF8;Set-Clipboard");
  expect(appunti.leggi?.[1].join(" ")).toContain("Get-Clipboard -Raw");
  expect(argomentiCopiaVeloce("windows")).toEqual([]);
  expect(processiConCartellaIn("C:\\progetto", "windows")).toEqual([]);
});

it("link e appunti: i programmi giusti per ogni sistema, e niente se non ce n'è nessuno", () => {
  const ci = (...nomi: string[]) => (n: string) => nomi.includes(n);
  expect(comandoApriLink("mac", ci())).toEqual(["open", []]);
  expect(comandoApriLink("wsl", ci("wslview", "xdg-open"))).toEqual(["wslview", []]);
  expect(comandoApriLink("wsl", ci("explorer.exe"))).toEqual(["explorer.exe", []]);
  expect(comandoApriLink("linux", ci("xdg-open"))).toEqual(["xdg-open", []]);
  expect(comandoApriLink("linux", ci())).toBeUndefined();

  expect(comandiAppunti("mac", ci())).toEqual({ copia: ["pbcopy", []], leggi: ["pbpaste", []] });
  expect(comandiAppunti("wsl", ci("clip.exe", "powershell.exe")).copia).toEqual(["clip.exe", []]);
  expect(comandiAppunti("wsl", ci("clip.exe", "powershell.exe")).leggi?.[0]).toBe("powershell.exe");
  expect(comandiAppunti("linux", ci("xclip"))).toEqual({
    copia: ["xclip", ["-selection", "clipboard"]],
    leggi: ["xclip", ["-selection", "clipboard", "-o"]],
  });
  expect(comandiAppunti("linux", ci())).toEqual({ copia: undefined, leggi: undefined });
});

it("la copia delle dipendenze: clonazione APFS sul Mac, copia (con reflink dove c'è) su Linux, mai un collegamento", () => {
  expect(argomentiCopiaVeloce("mac")).toEqual(["-cR"]);
  expect(argomentiCopiaVeloce("linux")).toEqual(["-R", "--reflink=auto"]);
  expect(argomentiCopiaVeloce("wsl")).toEqual(["-R", "--reflink=auto"]);
});

it("un processo senza terminale: «??» sul Mac, «?» su Linux", () => {
  expect(senzaTerminale("??")).toBe(true);
  expect(senzaTerminale("?")).toBe(true);
  expect(senzaTerminale("ttys003")).toBe(false);
  expect(senzaTerminale("pts/0")).toBe(false);
});

it.skipIf(suWindows)("trova i processi che lavorano dentro una cartella (lsof sul Mac, /proc su Linux)", async () => {
  const cartella = temp("piatt-proc-");
  const { spawn } = await import("node:child_process");
  const figlio = spawn("sleep", ["30"], { cwd: cartella, stdio: "ignore" });
  try {
    await new Promise((r) => setTimeout(r, 300));
    expect(processiConCartellaIn(cartella)).toContain(figlio.pid);
    expect(processiConCartellaIn(join(cartella, "altra"))).not.toContain(figlio.pid);
  } finally {
    figlio.kill("SIGKILL");
  }
});

// Un «secret-tool» finto: le voci in una cartella, come libsecret.
function secretToolFinto() {
  const base = temp("piatt-st-");
  const voci = join(base, "voci");
  mkdirSync(voci);
  const comando = join(base, "secret-tool");
  writeFileSync(
    comando,
    `#!/bin/sh
azione=$1; shift
[ "$azione" = store ] && shift
f="${voci}/$(printf '%s|%s' "$2" "$4" | shasum | cut -c1-16)"
case "$azione" in
lookup) [ -f "$f" ] || exit 1; cat "$f" ;;
store) cat > "$f" ;;
clear) rm -f "$f" ;;
esac
`,
  );
  chmodSync(comando, 0o755);
  return { base, comando };
}

it.skipIf(suWindows)("Linux: le chiavi in libsecret, entrate dallo standard input; lette, cambiate e tolte", () => {
  const { base, comando } = secretToolFinto();
  const chiavi = portachiaviLinux(join(base, "dati"), comando);
  expect(chiavi.esiste("groq")).toBe(false);
  chiavi.salva("groq", "gsk_linux_finta_1234567890");
  expect(chiavi.leggi("groq")).toBe("gsk_linux_finta_1234567890");
  expect(chiavi.esiste("groq")).toBe(true);
  // Letta, la chiave non entra più nei testi conservati.
  expect(redact("errore gsk_linux_finta_1234567890")).not.toContain("gsk_linux_finta");
  chiavi.salva("groq", "gsk_linux_nuova_0987654321");
  expect(chiavi.leggi("groq")).toBe("gsk_linux_nuova_0987654321");
  expect(chiavi.togli("groq")).toBe(true);
  expect(chiavi.leggi("groq")).toBeUndefined();
});

it.skipIf(suWindows)("Linux senza portachiavi attivo: un errore che dice che cosa installare", () => {
  const base = temp("piatt-st-rotto-");
  const comando = join(base, "secret-tool");
  writeFileSync(comando, "#!/bin/sh\necho 'Cannot autolaunch D-Bus without X11 $DISPLAY' >&2\nexit 1\n");
  chmodSync(comando, 0o755);
  // D-Bus senza sessione: il portachiavi non è attivo, e lo si dice così.
  expect(() => portachiaviLinux(join(base, "dati"), comando).leggi("groq")).toThrow(/non è attivo in questa sessione/);
  expect(portachiaviLinux(join(base, "dati"), comando).esiste("groq")).toBe(false);
});

it("WSL: lo script per l'archivio di Windows ha nome e provider fra apici, e la chiave non c'è mai", () => {
  const script = scriptVault("salva", "Continuity · dati · 1a2b3c4d", "o'reilly");
  expect(script).toContain("'Continuity · dati · 1a2b3c4d'");
  expect(script).toContain("'o''reilly'");
  expect(script).toContain("[Console]::In.ReadToEnd()");
  expect(Buffer.from(codificaPowerShell(script), "base64").toString("utf16le")).toBe(script);
});

it.skipIf(suWindows)("WSL: le chiavi nell'archivio di Windows attraverso powershell.exe (finto), con la chiave dallo standard input", () => {
  const base = temp("piatt-ps-");
  const voci = join(base, "voci");
  mkdirSync(voci);
  const registro = join(base, "argomenti.log");
  // Un powershell.exe finto: decodifica lo script, riconosce l'azione e
  // conserva le voci in una cartella, come farebbe PasswordVault.
  const comando = join(base, "powershell.exe");
  writeFileSync(
    comando,
    `#!/usr/bin/env node
const fs = require("fs"), path = require("path");
const argv = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(registro)}, argv.join(" ") + "\\n");
const script = Buffer.from(argv[argv.indexOf("-EncodedCommand") + 1], "base64").toString("utf16le");
const [, s, a] = /Retrieve\\('((?:[^']|'')*)','((?:[^']|'')*)'\\)/.exec(script) || [];
const f = path.join(${JSON.stringify(voci)}, Buffer.from(s + "|" + a).toString("hex"));
if (script.includes("ReadToEnd")) { fs.writeFileSync(f, fs.readFileSync(0)); process.exit(0); }
if (script.includes("RetrievePassword")) { if (!fs.existsSync(f)) process.exit(44); process.stdout.write(fs.readFileSync(f)); process.exit(0); }
if (script.includes("Remove")) { if (!fs.existsSync(f)) process.exit(44); fs.rmSync(f); process.exit(0); }
`,
  );
  chmodSync(comando, 0o755);
  const chiavi = portachiaviWindows(join(base, "dati"), comando);
  expect(chiavi.leggi("nvidia")).toBeUndefined();
  chiavi.salva("nvidia", "nvapi-wsl-finta-1234567890");
  expect(chiavi.leggi("nvidia")).toBe("nvapi-wsl-finta-1234567890");
  expect(chiavi.togli("nvidia")).toBe(true);
  expect(chiavi.leggi("nvidia")).toBeUndefined();
  // La chiave non è mai passata sulla riga di comando.
  expect(readFileSync(registro, "utf8")).not.toContain("nvapi-wsl-finta");
});

it("Linux: i motivi del portachiavi in parole semplici, con il comando giusto", async () => {
  const { spiegaPortachiaviLinux } = await import("../src/core/portachiavi.js");
  expect(spiegaPortachiaviLinux("spawnSync secret-tool ENOENT")).toMatch(/sudo apt install libsecret-tools gnome-keyring$/);
  expect(spiegaPortachiaviLinux("The name org.freedesktop.secrets was not provided by any .service files")).toMatch(/esci e rientra nel desktop/);
  expect(spiegaPortachiaviLinux("qualcos'altro")).toBeUndefined();
  // secret-tool assente del tutto: lo stesso messaggio, dall'errore del sistema.
  expect(() => portachiaviLinux(join(temp("piatt-assente-"), "dati"), "/percorso/che/non/esiste/secret-tool").leggi("groq")).toThrow(/Manca secret-tool/);
});

it("il tasto per incollare e gli appunti, per sistema", async () => {
  const { tastoIncolla, appuntiLeggibili } = await import("../src/piattaforma.js");
  expect(tastoIncolla("mac")).toBe("cmd+V");
  expect(tastoIncolla("linux")).toBe("ctrl+shift+V");
  expect(tastoIncolla("wsl")).toBe("ctrl+shift+V");
  expect(tastoIncolla("windows")).toBe("ctrl+V");
  expect(appuntiLeggibili("linux", () => false)).toBe(false);
  expect(appuntiLeggibili("linux", (n) => n === "xclip")).toBe(true);
});


it("senza archivio protetto: le chiavi in un file leggibile solo dall'utente (600), e lo si dice", async () => {
  const { portachiaviFile, archivioDisponibile, notaArchivio } = await import("../src/core/portachiavi.js");
  const { statSync, existsSync: esisteFile } = await import("node:fs");
  const dati = join(temp("piatt-file-"), "dati");
  const chiavi = portachiaviFile(dati);
  expect(chiavi.esiste("groq")).toBe(false);
  chiavi.salva("groq", "gsk_file_finta_1234567890");
  expect(chiavi.leggi("groq")).toBe("gsk_file_finta_1234567890");
  // Su Windows i permessi Unix non esistono: il file sta nella cartella
  // dell'utente, che gli altri utenti non leggono.
  if (!suWindows) expect(statSync(join(dati, "chiavi.json")).mode & 0o777).toBe(0o600);
  expect(redact("errore gsk_file_finta_1234567890")).not.toContain("gsk_file_finta");
  expect(chiavi.togli("groq")).toBe(true);
  expect(chiavi.leggi("groq")).toBeUndefined();
  // Un archivio che non risponde (comando assente): si usa il file.
  expect(archivioDisponibile(false, "/percorso/inesistente/secret-tool")).toBe(false);
  expect(archivioDisponibile(true, "/percorso/inesistente/powershell.exe")).toBe(false);
  // Con il file già in uso, la nota lo dice.
  expect(esisteFile(join(dati, "chiavi.json"))).toBe(true);
  expect(notaArchivio(dati, "linux")).toMatch(/^Su questo computer non c'è un archivio protetto delle chiavi: la chiave va in un file/);
});

it("Windows: windowsHide diventa di serie, senza togliere le scelte di chi chiama", async () => {
  const { conNascosta } = await import("../piattaforme/windows/processi.js");
  const cb = () => {};
  // spawn(comando, argomenti, opzioni): le opzioni ricevono windowsHide.
  expect(conNascosta([["-v"], { cwd: "C:/x" }], true)).toEqual([["-v"], { windowsHide: true, cwd: "C:/x" }]);
  // Chi lo vuole visibile lo dice, e resta così.
  expect(conNascosta([["-v"], { windowsHide: false }], true)).toEqual([["-v"], { windowsHide: false }]);
  // Senza opzioni: dopo gli argomenti, prima della funzione di ritorno.
  expect(conNascosta([["-v"]], true)).toEqual([["-v"], { windowsHide: true }]);
  expect(conNascosta([], true)).toEqual([[], { windowsHide: true }]);
  expect(conNascosta([cb], true)).toEqual([[], { windowsHide: true }, cb]);
  expect(conNascosta([undefined, { cwd: "C:/x" }], true)).toEqual([[], { windowsHide: true, cwd: "C:/x" }]);
  // exec(comando, …): niente elenco di argomenti.
  expect(conNascosta([cb], false)).toEqual([{ windowsHide: true }, cb]);
  expect(conNascosta([], false)).toEqual([{ windowsHide: true }]);
});

it.runIf(suWindows)("Windows: la ricerca nel PATH resta valida 30 secondi (where.exe costa circa 100 ms)", async () => {
  const { cercaNelPath } = await import("../piattaforme/windows/processi.js");
  const t = 1_000_000_000_000;
  const prima = cercaNelPath("cmd", t);
  expect(prima.some((p) => /\\cmd\.exe$/i.test(p))).toBe(true);
  // Entro 30 secondi la risposta arriva senza where.exe: meno di 20 ms.
  const inizio = Date.now();
  expect(cercaNelPath("cmd", t + 29_000)).toEqual(prima);
  expect(Date.now() - inizio).toBeLessThan(20);
  // Chi la riceve può cambiarla senza toccare quella conservata.
  cercaNelPath("cmd", t + 1).push("x");
  expect(cercaNelPath("cmd", t + 2)).toEqual(prima);
});
