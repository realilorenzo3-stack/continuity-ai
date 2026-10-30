// Pubblicare e aggiornare facilmente (piano di pubblicazione, punto 4): la
// copia pubblica di una versione, l'installazione con un comando da un
// «GitHub» finto (cartelle locali), l'aggiornamento e il ritorno indietro,
// l'avviso di versione nuova, il formato dei dati.
import { it, expect, afterEach } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { controllaAggiornamento, piuNuova } from "../src/core/aggiornamenti.js";
import { migraDati } from "../src/core/migrazioni.js";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
const temp = (n: string) => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), n)));
  dirs.push(d);
  return d;
};
const sha256 = (file: string) =>
  spawnSync("sh", ["-c", 'command -v sha256sum >/dev/null && sha256sum "$1" || shasum -a 256 "$1"', "_", file], { encoding: "utf8" }).stdout.split(" ")[0];

it("quale versione è più nuova, anteprime comprese", () => {
  expect(piuNuova("2.1.0", "2.0.9")).toBe(true);
  expect(piuNuova("2.0.0", "2.0.0-beta.3")).toBe(true);
  expect(piuNuova("2.0.0-beta.10", "2.0.0-beta.9")).toBe(true);
  expect(piuNuova("2.0.0-beta.2", "2.0.0")).toBe(false);
  expect(piuNuova("2.0.0", "2.0.0")).toBe(false);
  expect(piuNuova("v3.0.0", "2.9.9")).toBe(true);
});

it("l'avviso di versione nuova: a ogni apertura, solo con una versione installata; senza rete vale l'ultima risposta; si spegne", async () => {
  const dati = temp("agg-dati-");
  const app = temp("agg-app-");
  let chiamate = 0;
  let pubblicata = "v2.1.0";
  const github = (async () => {
    chiamate++;
    return new Response(JSON.stringify([{ tag_name: pubblicata }]));
  }) as any;
  // Versione di sviluppo (nessuna .continuity-version): nessun controllo.
  expect(await controllaAggiornamento(dati, app, github)).toBeUndefined();
  expect(chiamate).toBe(0);
  writeFileSync(join(app, ".continuity-version"), "2.0.0\n");
  expect(await controllaAggiornamento(dati, app, github)).toBe("2.1.0");
  // Una versione uscita poco dopo si vede alla prossima apertura (prima la
  // risposta restava valida per un giorno).
  pubblicata = "v2.1.1";
  expect(await controllaAggiornamento(dati, app, github)).toBe("2.1.1");
  expect(chiamate).toBe(2);
  // Senza rete: l'ultima risposta, senza errori.
  const senzaRete = (async () => {
    throw Error("offline");
  }) as any;
  expect(await controllaAggiornamento(dati, app, senzaRete)).toBe("2.1.1");
  expect(await controllaAggiornamento(temp("agg-off-"), app, senzaRete)).toBeUndefined();
  // Già aggiornato: niente avviso.
  writeFileSync(join(app, ".continuity-version"), "2.1.1\n");
  expect(await controllaAggiornamento(dati, app, github)).toBeUndefined();
  // Spento dalla persona.
  writeFileSync(join(app, ".continuity-version"), "2.0.0\n");
  writeFileSync(join(dati, "interfaccia.json"), JSON.stringify({ aggiornamenti: false }));
  expect(await controllaAggiornamento(dati, app, github)).toBeUndefined();
});

it("il formato dei dati: numero alla prima apertura, copia di sicurezza prima di convertire, stop con dati di una versione più nuova", () => {
  const nuova = temp("migra-nuova-");
  expect(migraDati(nuova)).toEqual({ da: 1, a: 1, copia: undefined });
  expect(JSON.parse(readFileSync(join(nuova, "versione-dati.json"), "utf8"))).toEqual({ versione: 1 });

  const vecchia = temp("migra-vecchia-");
  writeFileSync(join(vecchia, "continuity.sqlite"), "database");
  writeFileSync(join(vecchia, "flussi.json"), '{"vecchio":true}');
  mkdirSync(join(vecchia, "runs"));
  const conversione = {
    a: 2,
    descrizione: "prova",
    esegui: (d: string) => writeFileSync(join(d, "flussi.json"), '{"nuovo":true}'),
  };
  const esito = migraDati(vecchia, [conversione], new Date("2026-11-01T10:00:00Z"));
  expect(esito.da).toBe(1);
  expect(esito.a).toBe(2);
  expect(readFileSync(join(esito.copia!, "flussi.json"), "utf8")).toBe('{"vecchio":true}');
  expect(readFileSync(join(esito.copia!, "continuity.sqlite"), "utf8")).toBe("database");
  expect(existsSync(join(esito.copia!, "runs"))).toBe(false);
  expect(readFileSync(join(vecchia, "flussi.json"), "utf8")).toBe('{"nuovo":true}');

  // Tornati indietro a una versione che conosce solo il formato 1.
  expect(() => migraDati(vecchia, [])).toThrow(/più nuova di quella in uso \(formato 2, questa versione conosce fino al 1\)/);
});

// Un «GitHub» finto: cartelle locali per le versioni e per l'elenco.
function github() {
  const base = temp("github-");
  const rilasci = join(base, "rilasci");
  const api = join(base, "api");
  mkdirSync(rilasci);
  mkdirSync(api);
  const pubblica = (versione: string, guasta = false) => {
    const cartella = join(base, "costruzione", `continuity-${versione}`);
    execFileSync("node", ["scripts/rilascio.mjs", versione, "--prova", cartella, "--senza-prove"], { stdio: "ignore" });
    const dove = join(rilasci, `v${versione}`);
    mkdirSync(dove, { recursive: true });
    const pacchetto = join(dove, `continuity-${versione}.tar.gz`);
    execFileSync("tar", ["-czf", pacchetto, "-C", join(base, "costruzione"), `continuity-${versione}`]);
    const impronta = guasta ? "0".repeat(64) : sha256(pacchetto);
    writeFileSync(join(dove, "SHA256SUMS"), `${impronta}  continuity-${versione}.tar.gz\n`);
    writeFileSync(join(api, "releases"), JSON.stringify([{ tag_name: `v${versione}` }]));
  };
  return { rilasci, api, pubblica };
}

// La toolchain finta già presente (Node e pnpm), come in tests/collaudo-8.
function datiConToolchain() {
  const dati = join(temp("versioni-dati-"), "dati");
  const bin = join(dati, "toolchain", "node_modules", ".bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "node"), "#!/bin/sh\nexit 0\n");
  writeFileSync(join(bin, "pnpm"), '#!/bin/sh\ncase "$1" in build) [ -f tsconfig.tui.json ] || exit 2 ;; esac\nexit 0\n');
  chmodSync(join(bin, "node"), 0o755);
  chmodSync(join(bin, "pnpm"), 0o755);
  return dati;
}

it("il ciclo di vita: installazione con un comando, aggiornamento, ritorno indietro; un pacchetto alterato si rifiuta", () => {
  const g = github();
  g.pubblica("9.9.8");
  const dati = datiConToolchain();
  const lanciatori = join(temp("versioni-bin-"), "bin");
  const ambiente = {
    ...process.env,
    CONTINUITY_DATA_DIR: dati,
    CONTINUITY_BIN_DIR: lanciatori,
    CONTINUITY_API: `file://${g.api}`,
    CONTINUITY_RILASCI: `file://${g.rilasci}`,
  };
  // «curl … | sh»: lo script arriva dallo standard input, da una cartella
  // qualsiasi (qui una con un package.json che non è Continuity).
  const altrove = temp("versioni-altrove-");
  writeFileSync(join(altrove, "package.json"), '{"name":"progetto-della-persona"}');
  mkdirSync(join(altrove, "src"));
  const installa = spawnSync("sh", ["-s"], { cwd: altrove, input: readFileSync("scripts/install.sh"), env: ambiente, encoding: "utf8" });
  expect(installa.status, installa.stderr + installa.stdout).toBe(0);
  expect(installa.stdout).toContain("Scarico Continuity 9.9.8");
  const continuity = join(lanciatori, "continuity");
  const versione = () => execFileSync(continuity, ["version"], { env: ambiente, encoding: "utf8" }).trim();
  expect(versione()).toBe("9.9.8");

  // Già aggiornato.
  expect(execFileSync(continuity, ["update"], { env: ambiente, encoding: "utf8" })).toContain("Continuity è aggiornato (9.9.8)");
  // Una versione nuova: --controlla lo dice, update la installa.
  g.pubblica("9.9.9");
  expect(execFileSync(continuity, ["update", "--controlla"], { env: ambiente, encoding: "utf8" })).toContain("È disponibile Continuity 9.9.9 (ora: 9.9.8)");
  const aggiorna = spawnSync(continuity, ["update"], { env: ambiente, encoding: "utf8" });
  expect(aggiorna.status, aggiorna.stderr + aggiorna.stdout).toBe(0);
  expect(versione()).toBe("9.9.9");
  expect(readFileSync(join(dati, "app.precedente", ".continuity-version"), "utf8").trim()).toBe("9.9.8");
  // Indietro, e di nuovo avanti.
  expect(execFileSync(continuity, ["update", "--indietro"], { env: ambiente, encoding: "utf8" })).toContain("Tornato a Continuity 9.9.8");
  expect(versione()).toBe("9.9.8");
  execFileSync(continuity, ["update", "--indietro"], { env: ambiente });
  expect(versione()).toBe("9.9.9");

  // Un pacchetto che non corrisponde alla sua impronta non si installa.
  g.pubblica("9.9.10", true);
  const guasta = spawnSync(continuity, ["update"], { env: ambiente, encoding: "utf8" });
  expect(guasta.status).not.toBe(0);
  expect(guasta.stderr).toContain("non corrisponde alla sua impronta");
  expect(versione()).toBe("9.9.9");

  // continuity uninstall toglie programma e comando.
  const via = spawnSync(continuity, ["uninstall"], { env: ambiente, encoding: "utf8" });
  expect(via.status, via.stderr).toBe(0);
  expect(existsSync(continuity)).toBe(false);
  expect(existsSync(join(dati, "app"))).toBe(false);
}, 60_000);

it("la copia pubblica: solo programma, prove, script e documenti per gli utenti; la versione nelle note e in package.json", () => {
  const cartella = join(temp("copia-pubblica-"), "c");
  execFileSync("node", ["scripts/rilascio.mjs", "3.4.5-beta.1", "--prova", cartella, "--senza-prove"], { stdio: "ignore" });
  for (const interno of ["AGENTS.md", "CONTINUITY_2.0.md", "docs/CONTEXT.md", "docs/MARKET_RESEARCH.md", "docs/legale", "agents", "prototipi", "bin"])
    expect(existsSync(join(cartella, interno)), interno).toBe(false);
  for (const pubblico of ["LICENSE", "NOTICE", "README.md", "PRIVACY.md", "SECURITY.md", "CHANGELOG.md", "src/cli/main.ts", "scripts/install.sh", "scripts/install.ps1", ".github/workflows/versione.yml"])
    expect(existsSync(join(cartella, pubblico)), pubblico).toBe(true);
  expect(JSON.parse(readFileSync(join(cartella, "package.json"), "utf8")).version).toBe("3.4.5-beta.1");
  expect(readFileSync(join(cartella, "CHANGELOG.md"), "utf8")).toMatch(/## Prossima versione\n\n## 3\.4\.5-beta\.1 — \d{4}-\d{2}-\d{2}\n\n\S/);
  // La versione deve avere un formato valido.
  const sbagliata = spawnSync("node", ["scripts/rilascio.mjs", "nuova"], { encoding: "utf8" });
  expect(sbagliata.status).toBe(1);
  expect(sbagliata.stderr).toContain("Uso: pnpm rilascio <versione>");
});
