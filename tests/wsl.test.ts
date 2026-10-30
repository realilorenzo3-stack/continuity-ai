// Windows con WSL 2 (CONTINUITY_2.0.md §9.1 punto 2): i progetti sul disco di
// Windows (/mnt/c/…) e il comando «continuity» per PowerShell. Senza un
// Windows vero: Git vero per le fine riga, programmi di Windows finti.
import { it, expect, afterEach } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ambienteGit, autocrlfPerCartella, impostazioniPerWindows, sulDiscoDiWindows } from "../src/git/ambiente.js";
import { scrivi } from "../src/core/consegna.js";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => {
  try {
    chmodSync(d, 0o755);
  } catch {}
  rmSync(d, { recursive: true, force: true });
}));
const temp = (n: string) => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), n)));
  dirs.push(d);
  return d;
};

it("riconosce il disco di Windows visto da WSL", () => {
  expect(sulDiscoDiWindows("/mnt/c/Users/anna/sito")).toBe(true);
  expect(sulDiscoDiWindows("/mnt/d")).toBe(true);
  expect(sulDiscoDiWindows("/home/anna/sito")).toBe(false);
  expect(sulDiscoDiWindows("/mnt/data/sito")).toBe(false);
});

it("in WSL, per un repository sul disco di Windows: le fine riga di Git per Windows e niente permessi di esecuzione", () => {
  const chiedi = (comune: string, autocrlf?: string) => ({ cartellaGitComune: () => comune, autocrlfDiWindows: () => autocrlf });
  const env = ambienteGit("/mnt/c/Users/anna/sito", "wsl", chiedi("/mnt/c/Users/anna/sito/.git", "true"));
  expect(env).toMatchObject({
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: "core.fileMode",
    GIT_CONFIG_VALUE_0: "false",
    GIT_CONFIG_KEY_1: "core.autocrlf",
    GIT_CONFIG_VALUE_1: "true",
  });
  // Una copia di lavoro nella cartella dati di Continuity, di un repository di Windows.
  expect(ambienteGit("/home/anna/.local/share/Continuity/runs/x/worktree", "wsl", chiedi("/mnt/c/Users/anna/sito/.git", "input")).GIT_CONFIG_VALUE_1).toBe("input");
  // Un repository in Linux, o il Mac: nessuna aggiunta.
  expect(ambienteGit("/home/anna/sito", "wsl", chiedi("/home/anna/sito/.git", "true")).GIT_CONFIG_COUNT).toBeUndefined();
  expect(ambienteGit("/Users/anna/sito", "mac", chiedi("/mnt/c/x/.git", "true")).GIT_CONFIG_COUNT).toBeUndefined();
  // Senza Git per Windows: solo i permessi.
  expect(impostazioniPerWindows(undefined)).toEqual({ GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "core.fileMode", GIT_CONFIG_VALUE_0: "false" });
  expect(impostazioniPerWindows("qualcosa di strano").GIT_CONFIG_COUNT).toBe("1");
});

it("le impostazioni passate da ambienteGit cambiano davvero ciò che Git estrae: con autocrlf la copia ha le fine riga di Windows", () => {
  const repo = temp("wsl-crlf-");
  const base = { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };
  const git = (args: string[], cwd = repo, env: NodeJS.ProcessEnv = base) => execFileSync("git", args, { cwd, env, encoding: "utf8" });
  git(["init", "-q"]);
  writeFileSync(join(repo, "a.txt"), "uno\ndue\n");
  git(["add", "a.txt"]);
  git(["-c", "user.name=p", "-c", "user.email=p@p", "commit", "-qm", "base"]);
  const copia = join(temp("wsl-copia-"), "w");
  git(["worktree", "add", "-q", copia, "HEAD"], repo, { ...base, ...impostazioniPerWindows("true") });
  expect(readFileSync(join(copia, "a.txt"), "utf8")).toBe("uno\r\ndue\r\n");
  // E con quelle stesse impostazioni il file con CRLF non risulta modificato.
  expect(git(["status", "--porcelain"], copia, { ...base, ...impostazioniPerWindows("true") }).trim()).toBe("");
});

it("la pubblicazione di una cartella di Windows usa le fine riga di Git per Windows, solo in WSL", () => {
  const chiedi = { autocrlfDiWindows: () => "true" };
  expect(autocrlfPerCartella("/mnt/c/Users/anna/sito", "wsl", chiedi)).toBe("true");
  expect(autocrlfPerCartella("/home/anna/sito", "wsl", chiedi)).toBeUndefined();
  expect(autocrlfPerCartella("/mnt/c/Users/anna/sito", "linux", chiedi)).toBeUndefined();
});

it("un file che non si può scrivere (aperto in un programma di Windows, protetto): la consegna lo dice con il suo nome", () => {
  if (process.getuid?.() === 0) return; // da amministratore i permessi non fermano
  const radice = temp("wsl-bloccato-");
  mkdirSync(join(radice, "dentro"));
  chmodSync(join(radice, "dentro"), 0o555);
  try {
    expect(() => scrivi(radice, { path: "dentro/nuovo.txt", finale: Buffer.from("x") } as any)).toThrow(
      "Non posso scrivere dentro/nuovo.txt: è aperto in un altro programma o protetto. Chiudilo e riprova con /applica",
    );
  } finally {
    chmodSync(join(radice, "dentro"), 0o755);
  }
});

// Un piccolo «Windows» finto: cmd.exe che conosce %LOCALAPPDATA%, wslpath che
// traduce i percorsi, powershell.exe che annota gli script che riceve.
function windowsFinto() {
  const base = temp("wsl-win-");
  const bin = join(base, "bin");
  mkdirSync(bin);
  const disco = join(base, "c");
  const registro = join(base, "powershell.log");
  const scrivi = (nome: string, testo: string) => {
    writeFileSync(join(bin, nome), testo);
    chmodSync(join(bin, nome), 0o755);
  };
  scrivi("cmd.exe", `#!/bin/sh\nprintf 'C:\\\\Users\\\\anna\\\\AppData\\\\Local\\r\\n'\n`);
  scrivi(
    "wslpath",
    `#!/bin/sh
case "$1" in
-u) printf '%s\\n' "$2" | sed -e 's#^C:#${disco}#' -e 's#\\\\#/#g' ;;
-w) printf '%s\\n' "$2" | sed -e 's#^${disco}#C:#' -e 's#/#\\\\#g' ;;
esac
`,
  );
  scrivi(
    "powershell.exe",
    `#!/usr/bin/env node
const a = process.argv.slice(2);
require("fs").appendFileSync(${JSON.stringify(registro)}, Buffer.from(a[a.indexOf("-EncodedCommand") + 1], "base64").toString("utf16le") + "\\n");
`,
  );
  const esegui = (funzione: string, ...argomenti: string[]) =>
    spawnSync("sh", ["-c", `. "${process.cwd()}/scripts/windows.sh"; ${funzione} "$@"`, "_", ...argomenti], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    });
  return { disco, registro, esegui };
}

it("il comando continuity per PowerShell: un continuity.cmd che avvia Continuity in WSL nella cartella corrente, aggiunto al PATH dell'utente", () => {
  const { disco, registro, esegui } = windowsFinto();
  const r = esegui("continuity_installa_windows", "/home/anna/.local/bin/continuity", "Ubuntu");
  expect(r.status, r.stderr).toBe(0);
  expect(r.stdout.trim()).toBe("C:\\Users\\anna\\AppData\\Local\\Continuity\\bin");
  const cmd = join(disco, "Users/anna/AppData/Local/Continuity/bin/continuity.cmd");
  expect(readFileSync(cmd, "utf8")).toBe(
    '@echo off\r\nrem Continuity gira in WSL (Ubuntu): questo comando lo avvia nella cartella corrente.\r\nwsl.exe -d "Ubuntu" --cd "%CD%" -- "/home/anna/.local/bin/continuity" %*\r\n',
  );
  const script = readFileSync(registro, "utf8");
  expect(script).toContain("$d='C:\\Users\\anna\\AppData\\Local\\Continuity\\bin'");
  expect(script).toContain("SetEnvironmentVariable('Path'");
  expect(script).toContain("'User'");

  // Senza il nome della distribuzione: quella predefinita di WSL, senza -d
  // (prova di Lorenzo su Windows: «Ubuntu» scritto a mano non esisteva).
  esegui("continuity_installa_windows", "/home/anna/.local/bin/continuity", "");
  expect(readFileSync(cmd, "utf8")).toBe(
    '@echo off\r\nrem Continuity gira in WSL: questo comando lo avvia nella cartella corrente.\r\nwsl.exe --cd "%CD%" -- "/home/anna/.local/bin/continuity" %*\r\n',
  );

  // Con una cartella dati diversa da quella di serie, la porta con sé.
  esegui("continuity_installa_windows", "/home/anna/.local/bin/continuity", "Debian", "/home/anna/dati prova");
  expect(readFileSync(cmd, "utf8")).toContain('wsl.exe -d "Debian" --cd "%CD%" -- env "CONTINUITY_DATA_DIR=/home/anna/dati prova" "/home/anna/.local/bin/continuity" %*');

  // La disinstallazione lo toglie, e toglie la cartella dal PATH.
  const via = esegui("continuity_togli_windows");
  expect(via.status).toBe(0);
  expect(existsSync(cmd)).toBe(false);
  expect(readFileSync(registro, "utf8").split("\n").filter(Boolean).at(-1)).toContain("-ne $d");
});

it("senza Windows raggiungibile (cmd.exe non risponde) il comando non si crea e l'installatore lo dice", () => {
  const r = spawnSync("sh", ["-c", `. "${process.cwd()}/scripts/windows.sh"; continuity_installa_windows /x Ubuntu`], {
    encoding: "utf8",
    env: { ...process.env, PATH: "/usr/bin:/bin" },
  });
  expect(r.status).not.toBe(0);
  expect(readFileSync("scripts/install.sh", "utf8")).toContain("da PowerShell usa «wsl continuity»");
});

it("la disinstallazione in WSL toglie le chiavi dall'archivio di Windows, per nome, senza leggerle", () => {
  const { registro } = windowsFinto();
  const bin = join(registro, "..", "bin");
  // Il powershell.exe finto risponde quante voci ha tolto.
  writeFileSync(
    join(bin, "powershell.exe"),
    `#!/usr/bin/env node
const a = process.argv.slice(2);
require("fs").appendFileSync(${JSON.stringify(registro)}, Buffer.from(a[a.indexOf("-EncodedCommand") + 1], "base64").toString("utf16le") + "\\n");
process.stdout.write("2");
`,
  );
  const r = spawnSync("sh", ["-c", `. "${process.cwd()}/scripts/nome-chiavi.sh"; continuity_togli_chiavi "$1"`, "_", "Continuity · dati d'anna · 1a2b3c4d"], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, WSL_DISTRO_NAME: "Ubuntu" },
  });
  expect(r.stdout.trim()).toBe("2");
  const script = readFileSync(registro, "utf8");
  expect(script).toContain("FindAllByResource('Continuity · dati d''anna · 1a2b3c4d')");
  expect(script).not.toContain("RetrievePassword");
});
