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

it("l'installazione installa anche Codex e Claude Code, con i loro installatori ufficiali e senza domande, solo se mancano", () => {
  const dati = datiConToolchain();
  const casa = temp("versioni-casa-");
  const lanciatori = join(casa, "bin");
  // Un «installatore di Codex» finto: annota come è stato chiamato.
  const finto = join(temp("codex-finto-"), "install.sh");
  writeFileSync(finto, `#!/bin/sh\nmkdir -p "$HOME/.local/bin"\nprintf '#!/bin/sh\\necho codex\\n' > "$HOME/.local/bin/codex"\nchmod +x "$HOME/.local/bin/codex"\necho "non interattivo: $CODEX_NON_INTERACTIVE" > "$HOME/codex-chiamato"\n`);
  const fintoClaude = join(temp("claude-finto-"), "install.sh");
  writeFileSync(fintoClaude, `mkdir -p "$HOME/.local/bin"\nprintf '#!/bin/sh\\necho claude\\n' > "$HOME/.local/bin/claude"\nchmod +x "$HOME/.local/bin/claude"\necho "bash: $BASH_VERSION" > "$HOME/claude-chiamato"\n`);
  const ambiente = {
    // Niente Codex nel PATH né in ~/.local/bin.
    PATH: "/usr/bin:/bin",
    HOME: casa,
    CONTINUITY_DATA_DIR: dati,
    CONTINUITY_BIN_DIR: lanciatori,
    CONTINUITY_SENZA_CODEX: "",
    CONTINUITY_CODEX_INSTALLER: `file://${finto}`,
    // Anche Claude Code, con il suo installatore ufficiale (qui finto).
    CONTINUITY_SENZA_CLAUDE: "",
    CONTINUITY_CLAUDE_INSTALLER: `file://${fintoClaude}`,
  };
  // dash, la shell di Ubuntu, dove c'è anche sul Mac: più severa di bash (una
  // variabile mancante con «set -u» ferma lo script; SHELL qui non c'è).
  const shell = existsSync("/bin/dash") ? "/bin/dash" : "sh";
  const r = spawnSync(shell, ["scripts/install.sh"], { env: ambiente, encoding: "utf8" });
  expect(r.status, r.stderr + r.stdout).toBe(0);
  expect(r.stdout).toContain("Installo Codex: programma gratuito di OpenAI");
  expect(readFileSync(join(casa, "codex-chiamato"), "utf8").trim()).toBe("non interattivo: 1");
  expect(r.stdout).toContain("Installo Claude Code: programma ufficiale di Anthropic");
  expect(readFileSync(join(casa, "claude-chiamato"), "utf8")).toMatch(/^bash: \d/);
  // Già installato: la seconda volta non lo si richiama.
  rmSync(join(casa, "codex-chiamato"));
  const ancora = spawnSync(shell, ["scripts/install.sh"], { env: ambiente, encoding: "utf8" });
  expect(ancora.status).toBe(0);
  expect(ancora.stdout).not.toContain("Installo Codex");
  expect(ancora.stdout).toContain("Codex è già installato");
  expect(ancora.stdout).not.toContain("Installo Claude Code");
  expect(existsSync(join(casa, "codex-chiamato"))).toBe(false);
}, 60_000);

// Ubuntu di Lorenzo, 31 ottobre: il disco pieno ha fermato a metà
// l'installatore di Claude Code, che ha lasciato una copia che non si avvia.
// L'installazione diceva «installato» e Continuity poi solo «CLI non trovata».
it("Claude Code che non si installa per disco pieno: lo si dice, con il motivo; e con poco spazio si avvisa prima", () => {
  const dati = datiConToolchain();
  const casa = temp("versioni-casa-");
  const fintoClaude = join(temp("claude-pieno-"), "install.sh");
  writeFileSync(
    fintoClaude,
    `mkdir -p "$HOME/.local/share/claude/versions"\nprintf 'a metà' > "$HOME/.local/share/claude/versions/2.1.316"\necho "✘ Installation failed"\necho "ENOSPC: no space left on device, copyfile"\n`,
  );
  const ambiente = {
    PATH: "/usr/bin:/bin",
    HOME: casa,
    CONTINUITY_DATA_DIR: dati,
    CONTINUITY_BIN_DIR: join(casa, "bin"),
    CONTINUITY_SENZA_CODEX: "1",
    CONTINUITY_SENZA_CLAUDE: "",
    CONTINUITY_CLAUDE_INSTALLER: `file://${fintoClaude}`,
    CONTINUITY_SPAZIO_MB: "800",
  };
  const r = spawnSync("sh", ["scripts/install.sh"], { env: ambiente, encoding: "utf8" });
  expect(r.status, r.stderr + r.stdout).toBe(0);
  expect(r.stdout).toContain("Attenzione: spazio libero su disco 800 MB");
  expect(r.stdout).toContain("Claude Code non installato (spazio su disco esaurito");
  expect(r.stdout).not.toContain("Claude Code installato.");
  // Con meno di 400 MB non si comincia.
  const poco = spawnSync("sh", ["scripts/install.sh"], { env: { ...ambiente, CONTINUITY_SPAZIO_MB: "300" }, encoding: "utf8" });
  expect(poco.status).toBe(2);
  expect(poco.stderr).toContain("Spazio libero su disco: 300 MB");
}, 60_000);

it("con un pacchetto già pronto per il sistema: lo scarica, ne controlla l'impronta e lo installa senza npm né compilazione", () => {
  const g = github();
  // Un pacchetto pronto finto: il programma copiato, un «node» finto.
  const base = temp("pronto-");
  const v = "9.9.20";
  const nome = `continuity-${v}-prova-x64`;
  execFileSync("node", ["scripts/rilascio.mjs", v, "--prova", join(base, nome, "app"), "--senza-prove"], { stdio: "ignore" });
  writeFileSync(join(base, nome, "app", ".continuity-version"), `${v}\n`);
  mkdirSync(join(base, nome, "node", "bin"), { recursive: true });
  writeFileSync(join(base, nome, "node", "bin", "node"), "#!/bin/sh\nexit 0\n");
  chmodSync(join(base, nome, "node", "bin", "node"), 0o755);
  const dove = join(g.rilasci, `v${v}`);
  mkdirSync(dove, { recursive: true });
  execFileSync("tar", ["-czf", join(dove, `${nome}.tar.gz`), "-C", base, nome]);
  writeFileSync(join(dove, "SHA256SUMS"), `${sha256(join(dove, `${nome}.tar.gz`))}  ${nome}.tar.gz\n`);
  writeFileSync(join(g.api, "releases"), JSON.stringify([{ tag_name: `v${v}` }]));
  // Nessuna toolchain: un pnpm chiamato per sbaglio farebbe fallire.
  const dati = join(temp("pronto-dati-"), "dati");
  const lanciatori = join(temp("pronto-bin-"), "bin");
  const ambiente = {
    ...process.env,
    CONTINUITY_DATA_DIR: dati,
    CONTINUITY_BIN_DIR: lanciatori,
    CONTINUITY_API: `file://${g.api}`,
    CONTINUITY_RILASCI: `file://${g.rilasci}`,
    CONTINUITY_PIATTAFORMA: "prova-x64",
    PATH: `/usr/bin:/bin`,
  };
  const r = spawnSync(existsSync("/bin/dash") ? "/bin/dash" : "sh", ["-s"], { cwd: temp("pronto-altrove-"), input: readFileSync("scripts/install.sh"), env: ambiente, encoding: "utf8" });
  expect(r.status, r.stderr + r.stdout).toBe(0);
  expect(r.stdout).toContain(`Scarico Continuity ${v} (pronto per prova-x64)`);
  expect(r.stdout).toContain("Copia dell applicazione (già pronta)");
  expect(r.stdout).not.toContain("Installazione dipendenze");
  expect(execFileSync(join(lanciatori, "continuity"), ["version"], { env: ambiente, encoding: "utf8" }).trim()).toBe(v);
  expect(existsSync(join(dati, "toolchain", "node", "bin", "node"))).toBe(true);
  // Un pacchetto pronto alterato si rifiuta.
  writeFileSync(join(dove, "SHA256SUMS"), `${"0".repeat(64)}  ${nome}.tar.gz\n`);
  const guasto = spawnSync("sh", ["-s"], { cwd: temp("pronto-altrove-"), input: readFileSync("scripts/install.sh"), env: { ...ambiente, CONTINUITY_DATA_DIR: join(temp("pronto-dati2-"), "d") }, encoding: "utf8" });
  expect(guasto.status).not.toBe(0);
  expect(guasto.stderr).toContain("non corrisponde alla sua impronta");
}, 60_000);


it("l'ultima versione è la più alta, non la prima che GitHub elenca (per nome «beta.9» viene prima di «beta.11»)", async () => {
  const api = temp("ultima-api-");
  const dati = temp("ultima-dati-");
  mkdirSync(join(dati, "app"));
  writeFileSync(join(dati, "app", ".continuity-version"), "2.0.0-beta.2\n");
  const controlla = (tags: string[]) => {
    // Come GitHub: un oggetto per riga, con altri campi intorno.
    writeFileSync(join(api, "releases"), "[\n" + tags.map((t) => `  {"url": "x", "tag_name": "${t}", "draft": false}`).join(",\n") + "\n]\n");
    return spawnSync(existsSync("/bin/dash") ? "/bin/dash" : "sh", ["scripts/aggiorna.sh", "--controlla"], {
      encoding: "utf8",
      env: { ...process.env, CONTINUITY_DATA_DIR: dati, CONTINUITY_API: `file://${api}` },
    }).stdout;
  };
  expect(controlla(["v2.0.0-beta.9", "v2.0.0-beta.8", "v2.0.0-beta.11", "v2.0.0-beta.10"])).toContain("È disponibile Continuity 2.0.0-beta.11");
  expect(controlla(["v2.0.0-beta.11", "v2.0.0", "v2.0.0-rc.1", "v1.9.9"])).toContain("È disponibile Continuity 2.0.0 ");
  expect(controlla(["v2.0.10", "v2.0.9", "v2.1.0-beta.1"])).toContain("È disponibile Continuity 2.1.0-beta.1");
  // L'avviso nell'interfaccia, con lo stesso confronto.
  const app = temp("ultima-app-");
  writeFileSync(join(app, ".continuity-version"), "2.0.0-beta.2\n");
  const github = (async () => new Response(JSON.stringify([{ tag_name: "v2.0.0-beta.9" }, { tag_name: "v2.0.0-beta.11" }]))) as any;
  expect(await controllaAggiornamento(temp("ultima-dati2-"), app, github)).toBe("2.0.0-beta.11");
});

it("prima di installare Codex o Claude Code si cerca con la ricerca di Continuity: uno che funziona si usa, uno che non risponde si segnala", () => {
  const casa = temp("trova-casa-");
  const bin = join(casa, "bin");
  mkdirSync(bin);
  const trova = () =>
    spawnSync(process.execPath, ["--import", "tsx", "scripts/trova-cli.ts", "codex", temp("trova-dati-")], {
      encoding: "utf8",
      env: { ...process.env, HOME: casa, PATH: `${bin}:/usr/bin:/bin` },
    });
  // Sul computer ce n'è già uno (sul Mac di Lorenzo, quello dell'app
  // ChatGPT): la ricerca lo trova anche fuori dal PATH.
  const giaPresente = trova().status === 0;
  // Uno che non risponde a --version: non viene mai scelto; se è l'unico,
  // esce 1 e lo indica.
  writeFileSync(join(bin, "codex"), "#!/bin/sh\nexit 3\n");
  chmodSync(join(bin, "codex"), 0o755);
  let r = trova();
  if (giaPresente) expect(r.stdout).not.toContain(join(bin, "codex"));
  else {
    expect(r.status).toBe(1);
    expect(r.stdout.trim()).toBe(join(bin, "codex"));
  }
  // Uno che funziona, più recente: esce 0 con percorso e versione.
  writeFileSync(join(bin, "codex"), '#!/bin/sh\n[ "$1" = --version ] && echo "codex-cli 9.9.9"\n');
  r = trova();
  expect(r.status).toBe(0);
  expect(r.stdout.trim()).toBe(`${join(bin, "codex")}\tcodex-cli 9.9.9`);
});
