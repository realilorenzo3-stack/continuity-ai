// L'installatore per Windows nativo (scripts/install.ps1, 31 ottobre) e il
// comando che crea: aggiornamento, ritorno indietro, disinstallazione
// (piattaforme/windows/aggiorna.ps1, disinstalla.ps1). Su Windows con un
// pacchetto finto: niente rete, niente Codex né Claude Code, niente PATH.
import { it, expect, afterEach } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const suWindows = process.platform === "win32";
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

it("l'installatore non chiude mai la finestra, controlla l'impronta e usa il pacchetto per Windows", () => {
  const ps = readFileSync("scripts/install.ps1", "utf8");
  // Con «irm | iex» un «exit» chiuderebbe la finestra della persona. Le righe
  // «exit /b» stanno nel testo del comando continuity.cmd, non nello script.
  const fuoriDalComando = ps.replace(/@'[\s\S]*?'@/g, "");
  expect(fuoriDalComando).not.toMatch(/^\s*exit\b/m);
  expect(ps).toContain("Get-FileHash -Algorithm SHA256");
  expect(ps).toContain("$piattaforma = 'win32-x64'");
  // aggiorna.ps1 ne carica solo le funzioni.
  expect(ps).toContain("if (-not $env:CONTINUITY_SOLO_FUNZIONI) { Installa-Continuity }");
  // Gli script eseguiti con -File hanno il BOM: Windows PowerShell 5.1
  // leggerebbe male le lettere accentate.
  for (const f of ["piattaforme/windows/aggiorna.ps1", "piattaforme/windows/disinstalla.ps1"])
    expect([...readFileSync(f).subarray(0, 3)], f).toEqual([0xef, 0xbb, 0xbf]);
});

// Un pacchetto come quello di scripts/pacchetto.sh, ridotto: il programma
// (solo i file che il comando e gli script usano) e node.exe.
function pacchetto(radice: string, versione: string) {
  const nome = `continuity-${versione}-win32-x64`;
  const dentro = join(radice, "costruzione-" + versione, nome);
  mkdirSync(join(dentro, "app", "src", "cli"), { recursive: true });
  mkdirSync(join(dentro, "app", "scripts"), { recursive: true });
  mkdirSync(join(dentro, "app", "piattaforme", "windows"), { recursive: true });
  mkdirSync(join(dentro, "node"), { recursive: true });
  writeFileSync(join(dentro, "app", "src", "cli", "main.ts"), "// finto\n");
  writeFileSync(join(dentro, "app", ".continuity-version"), versione + "\n");
  copyFileSync("scripts/install.ps1", join(dentro, "app", "scripts", "install.ps1"));
  for (const f of ["aggiorna.ps1", "disinstalla.ps1"])
    copyFileSync(join("piattaforme", "windows", f), join(dentro, "app", "piattaforme", "windows", f));
  copyFileSync(process.execPath, join(dentro, "node", "node.exe"));
  const file = join(radice, `${nome}.tar.gz`);
  execFileSync("tar.exe", ["-czf", file, "-C", join(radice, "costruzione-" + versione), nome]);
  return file;
}

it.runIf(suWindows)("Windows: installazione, seconda installazione, ritorno indietro e disinstallazione, con il comando creato", () => {
  const radice = mkdtempSync(join(tmpdir(), "continuity-install-win-"));
  dirs.push(radice);
  const dati = join(radice, "dati");
  const ambiente = (pacchetto?: string) => ({
    ...process.env,
    CONTINUITY_DATA_DIR: dati,
    CONTINUITY_SENZA_CODEX: "1",
    CONTINUITY_SENZA_CLAUDE: "1",
    CONTINUITY_SENZA_PATH: "1",
    ...(pacchetto ? { CONTINUITY_PACCHETTO: pacchetto } : {}),
  });
  // Come «irm | iex»: lo script letto come testo ed eseguito.
  const installa = (file: string) =>
    spawnSync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "iex ([IO.File]::ReadAllText('scripts\\install.ps1', [Text.Encoding]::UTF8))"],
      { encoding: "utf8", env: ambiente(file), timeout: 120_000 },
    );
  const prima = installa(pacchetto(radice, "9.0.0"));
  expect(prima.stdout).toContain("Continuity 9.0.0");
  expect(existsSync(join(dati, "app", "src", "cli", "main.ts"))).toBe(true);
  expect(existsSync(join(dati, "node", "node.exe"))).toBe(true);
  const comando = join(dati, "bin", "continuity.cmd");
  const versione = () => spawnSync("cmd.exe", ["/c", comando, "version"], { encoding: "utf8", env: ambiente() }).stdout.trim();
  expect(versione()).toBe("9.0.0");
  expect(readFileSync(join(dati, "launcher-dir"), "utf8").trim()).toBe(join(dati, "bin"));
  // La seconda: la prima resta da parte.
  installa(pacchetto(radice, "9.1.0"));
  expect(versione()).toBe("9.1.0");
  expect(readFileSync(join(dati, "app.precedente", ".continuity-version"), "utf8").trim()).toBe("9.0.0");
  // continuity update --indietro rimette la 9.0.0 e tiene da parte la 9.1.0.
  const indietro = spawnSync("cmd.exe", ["/c", comando, "update", "--indietro"], { encoding: "utf8", env: ambiente() });
  expect(indietro.stdout).toContain("Tornato a Continuity 9.0.0");
  expect(versione()).toBe("9.0.0");
  expect(readFileSync(join(dati, "app.precedente", ".continuity-version"), "utf8").trim()).toBe("9.1.0");
  // Un pacchetto che non è di Continuity non tocca nulla.
  const finto = join(radice, "finto.tar.gz");
  mkdirSync(join(radice, "vuoto", "x"), { recursive: true });
  execFileSync("tar.exe", ["-czf", finto, "-C", join(radice, "vuoto"), "x"]);
  // Senza la «è»: PowerShell scrive nella codifica della console, non in UTF-8.
  expect(installa(finto).stdout).toContain("quello di Continuity per Windows: installazione interrotta");
  expect(versione()).toBe("9.0.0");
  // Disinstallazione: via programma, Node e comando; i dati restano.
  writeFileSync(join(dati, "sessione-di-prova.txt"), "dati della persona");
  const via = spawnSync("cmd.exe", ["/c", comando, "uninstall"], { encoding: "utf8", env: ambiente() });
  expect(via.stdout).toContain("Rimossi il comando continuity e il programma");
  // Senza «Impossibile trovare il percorso»: il comando si toglie dopo.
  expect(via.stdout + via.stderr).not.toMatch(/Impossibile trovare|cannot find the path/i);
  for (const p of ["app", "app.precedente", "node"]) expect(existsSync(join(dati, p)), p).toBe(false);
  for (let i = 0; i < 40 && existsSync(join(dati, "bin")); i++) spawnSync("powershell.exe", ["-NoProfile", "-Command", "Start-Sleep -Milliseconds 250"]);
  expect(existsSync(join(dati, "bin", "continuity.cmd"))).toBe(false);
  expect(readFileSync(join(dati, "sessione-di-prova.txt"), "utf8")).toBe("dati della persona");
}, 240_000);
