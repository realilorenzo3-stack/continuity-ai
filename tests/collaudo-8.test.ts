// I difetti dell'ottavo collaudo (29 ottobre 2026): la chiave che sfuggiva per
// strade nuove, gli incarichi scambiati per controlli, i percorsi del
// Portachiavi, la disinstallazione, i nomi scelti dalla persona, la prova di
// NVIDIA con un modello assente, l'installatore eseguito davvero. Niente rete,
// niente chiavi vere, niente Portachiavi vero (un «security» finto).
import { it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Ponte, type EsitoPonte } from "../src/ponte/server.js";
import { chiediModello } from "../src/core/gratuiti.js";
import { providerNoto } from "../src/core/provider.js";
import { redact, ricordaSegreto } from "../src/persistence/redact.js";
import { incarichiDalMessaggio } from "../src/core/menzioni.js";
import { servizioPortachiavi } from "../src/core/portachiavi.js";
import { provaCollegamento } from "../src/core/collega.js";
import { impostaLingua, ricordaNomiScelti, traduci } from "../src/tui/lingua.js";
import { cartellaBaseDati } from "../src/piattaforma.js";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
// Le cartelle di prova sotto la cartella temporanea vera (su macOS /var è un
// collegamento a /private/var): i confronti dei percorsi restano chiari.
const temp = (n: string) => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), n)));
  dirs.push(d);
  return d;
};

// Una chiave senza prefisso noto: solo il valore esatto la riconosce.
const OPACA = "opaqueAuditSecret1234567890";

it("CT-2.0-602: il registro del ponte non tiene la chiave messa dal servizio in error.code, né il testo di error.type", async () => {
  const registro: EsitoPonte[] = [];
  const ponte = new Ponte({
    chiave: () => OPACA,
    registra: (e) => registro.push(e),
    scarica: (async () =>
      new Response(JSON.stringify({ error: { code: OPACA, type: "testo privato della persona", message: "boom" } }), { status: 500 })) as any,
  });
  try {
    await ponte.avvia();
    const r = await fetch(`${ponte.indirizzo("groq")}/responses`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${ponte.gettone}` },
      body: JSON.stringify({ model: "openai/gpt-oss-120b", input: "ciao" }),
    });
    expect(await r.text()).not.toContain(OPACA);
    const scritto = JSON.stringify(registro);
    expect(scritto).not.toContain(OPACA);
    expect(scritto).not.toContain("testo privato");
  } finally {
    await ponte.ferma();
  }
});

it("CT-2.0-602: la strada diretta (revisore, passi a domanda) toglie la chiave dagli errori dello stream e della rete", async () => {
  const groq = providerNoto("groq")!;
  const domanda = (scarica: any) =>
    chiediModello({ provider: groq, chiave: OPACA, modello: "m", messaggi: [{ role: "user", content: "x" }] }, scarica).then(
      () => "",
      (e: Error) => e.message,
    );
  const nelloStream = await domanda(async () =>
    new Response(`data: ${JSON.stringify({ error: { message: `chiave ${OPACA} non valida` } })}\n\n`, {
      headers: { "content-type": "text/event-stream" },
    }),
  );
  expect(nelloStream).toMatch(/non valida/);
  expect(nelloStream).not.toContain(OPACA);
  const dallaRete = await domanda(async () => {
    throw new Error(`connect failed for ${OPACA}`);
  });
  expect(dallaRete).toMatch(/non raggiungibile/);
  expect(dallaRete).not.toContain(OPACA);
});

it("CT-2.0-602: una chiave letta dal Portachiavi non entra in nessun testo conservato, in qualsiasi forma arrivi", () => {
  const letta = "Zq9opaqueKeyRead0987654321";
  expect(redact(`errore: ${letta}`)).toContain(letta);
  ricordaSegreto(letta);
  expect(redact(`errore: ${letta}, di nuovo ${letta}`)).toBe("errore: [REDACTED], di nuovo [REDACTED]");
});

it("CT-2.0-701: un incarico di scrittura resta di scrittura anche se nomina audit o check nel contenuto o nel nome del file", () => {
  const tipo = (t: string) => incarichiDalMessaggio(t).incarichi.map((x) => x.tipo);
  expect(tipo("@nvidia crea result.txt contenente AUDIT_OK")).toEqual(["scrive"]);
  expect(tipo("@codex crea audit.txt")).toEqual(["scrive"]);
  expect(tipo("@codex scrivi check.txt")).toEqual(["scrive"]);
  expect(tipo("@codex scrivi un test che verifica il totale")).toEqual(["scrive"]);
  expect(tipo("@nvidia metti in result.txt la parola «audit»")).toEqual(["scrive"]);
  // I controlli restano controlli.
  expect(tipo("@groq controlla audit.txt")).toEqual(["legge"]);
  expect(tipo("@groq fai una revisione del lavoro")).toEqual(["legge"]);
  expect(tipo("@groq check everything after each change")).toEqual(["legge"]);
  expect(tipo("@google verifica l'app e l'html")).toEqual(["legge"]);
  expect(tipo("@nvidia scrivi un file @groq occupati della revisione e @codex costruisci un html")).toEqual(["scrive", "legge", "scrive"]);
});

// Lo script della disinstallazione con un «security» finto, che registra cosa
// gli si chiede e tiene le voci in una cartella.
function ambienteFinto() {
  const base = temp("c8-");
  const casa = join(base, "casa");
  mkdirSync(cartellaBaseDati(casa), { recursive: true });
  const bin = join(base, "bin");
  mkdirSync(bin);
  const voci = join(base, "voci");
  mkdirSync(voci);
  // Lo stesso archivio finto risponde come «security» (Mac) e come
  // «secret-tool» (Linux): lo script della disinstallazione sceglie da sé.
  writeFileSync(
    join(bin, "secret-tool"),
    `#!/bin/sh
# Il nome del servizio è l'ultimo argomento («search --all service S», «clear service S»).
for ultimo in "$@"; do :; done
f="${voci}/$(printf '%s' "$ultimo" | shasum | cut -c1-12)"
case "$1" in
search) [ -f "$f" ] && echo "[/1]" ; exit 0 ;;
clear) rm -f "$f" ;;
esac
`,
  );
  chmodSync(join(bin, "secret-tool"), 0o755);
  writeFileSync(
    join(bin, "security"),
    `#!/bin/sh
# delete-generic-password -s SERVIZIO
[ "$1" = delete-generic-password ] || exit 1
f="${voci}/$(printf '%s' "$3" | shasum | cut -c1-12)"
[ -f "$f" ] || exit 44
rm "$f"
`,
  );
  chmodSync(join(bin, "security"), 0o755);
  const aggiungiVoce = (servizio: string) =>
    writeFileSync(join(voci, spawnSync("sh", ["-c", `printf '%s' "$1" | shasum | cut -c1-12`, "_", servizio], { encoding: "utf8" }).stdout.trim()), servizio);
  const voceC = (servizio: string) =>
    existsSync(join(voci, spawnSync("sh", ["-c", `printf '%s' "$1" | shasum | cut -c1-12`, "_", servizio], { encoding: "utf8" }).stdout.trim()));
  const nomeShell = (cartella: string, cwd = base) =>
    spawnSync("sh", ["-c", `. "${process.cwd()}/scripts/nome-chiavi.sh"; continuity_nome_chiavi "$1"`, "_", cartella], {
      encoding: "utf8",
      cwd,
      env: { ...process.env, HOME: casa },
    }).stdout.trim();
  const disinstalla = (dati: string, risposta: string) =>
    spawnSync("sh", [join(process.cwd(), "scripts/uninstall.sh"), "--all"], {
      encoding: "utf8",
      input: risposta + "\n",
      env: { ...process.env, HOME: casa, PATH: `${bin}:${process.env.PATH}`, CONTINUITY_DATA_DIR: dati, CONTINUITY_BIN_DIR: join(base, "lanciatori") },
    });
  return { base, casa, aggiungiVoce, voceC, nomeShell, disinstalla };
}

// scripts/nome-chiavi.sh è del disinstallatore per Mac e Linux (sh).
it.skipIf(process.platform === "win32")("CT-2.0-702: scripts/nome-chiavi.sh e il programma danno lo stesso nome, anche con alias, «..», barre finali e cartelle che non esistono più", () => {
  const { base, casa, nomeShell } = ambienteFinto();
  const vera = join(base, "dati vèri");
  mkdirSync(vera);
  symlinkSync(vera, join(base, "alias"));
  mkdirSync(join(base, "figlio"));
  const casi = [
    vera,
    vera + "/",
    join(base, "figlio", "..", "dati vèri"),
    join(base, "alias"),
    join(base, "mai-creata", "dati"),
    join(cartellaBaseDati(casa), "Continuity_2.0"),
    "relativa/dati",
  ];
  for (const c of casi) expect(nomeShell(c), c).toBe(servizioPortachiavi(c.startsWith("/") ? c : join(base, c), casa));
  // L'alias e la cartella vera sono la stessa cartella: lo stesso nome.
  expect(servizioPortachiavi(join(base, "alias"), casa)).toBe(servizioPortachiavi(vera, casa));
  expect(servizioPortachiavi(join(cartellaBaseDati(casa), "Continuity_2.0"), casa)).toBe("Continuity · Continuity_2.0");
  // /tmp e /private/tmp (macOS): la stessa cartella.
  if (process.platform === "darwin") expect(servizioPortachiavi("/tmp/c8-x/dati", casa)).toBe(servizioPortachiavi("/private/tmp/c8-x/dati", casa));
});

// Il disinstallatore per Mac e Linux (sh).
it.skipIf(process.platform === "win32")("CT-2.0-605: uninstall --all chiede prima; con una risposta diversa da ELIMINA non tocca niente; con ELIMINA toglie dati e chiavi, anche di una cartella già cancellata", () => {
  const { base, casa, aggiungiVoce, voceC, disinstalla } = ambienteFinto();
  const dati = join(base, "dati");
  mkdirSync(join(dati, "app"), { recursive: true });
  writeFileSync(join(dati, "tieni"), "x");
  const servizio = servizioPortachiavi(dati, casa);
  aggiungiVoce(servizio);
  aggiungiVoce("Continuity · altra · 00000000");

  const no = disinstalla(dati, "no");
  expect(no.status).toBe(0);
  expect(no.stdout).toContain(`«${servizio}»`);
  expect(no.stdout).toContain("Annullato: non è stato rimosso niente.");
  expect(existsSync(join(dati, "app"))).toBe(true);
  expect(existsSync(join(dati, "tieni"))).toBe(true);
  expect(voceC(servizio)).toBe(true);

  const si = disinstalla(join(base, "x", "..", "dati"), "ELIMINA");
  expect(si.status, si.stderr).toBe(0);
  expect(si.stdout).toContain("Chiavi tolte dall'archivio delle chiavi: 1.");
  expect(existsSync(dati)).toBe(false);
  expect(voceC(servizio)).toBe(false);
  // Le chiavi di un'altra cartella restano.
  expect(voceC("Continuity · altra · 00000000")).toBe(true);

  // Cartella già cancellata a mano: le chiavi si tolgono lo stesso.
  const sparita = join(base, "sparita");
  aggiungiVoce(servizioPortachiavi(sparita, casa));
  const dopo = disinstalla(sparita, "ELIMINA");
  expect(dopo.status, dopo.stderr).toBe(0);
  expect(voceC(servizioPortachiavi(sparita, casa))).toBe(false);
});

// Il disinstallatore per Mac e Linux (sh).
it.skipIf(process.platform === "win32")("CT-2.0-605: uninstall --all non accetta la cartella di casa come cartella dati", () => {
  const { casa, disinstalla } = ambienteFinto();
  const r = disinstalla(casa, "ELIMINA");
  expect(r.status).toBe(2);
  expect(r.stderr).toMatch(/Cartella dati non valida/);
  expect(existsSync(casa)).toBe(true);
});

// L'installatore per Mac e Linux (sh).
it.skipIf(process.platform === "win32")("CT-2.0-703: l'installatore, eseguito davvero, compila la copia installata; se la compilazione fallisce mostra perché e tiene la versione di prima", () => {
  const base = temp("c8-install-");
  const dati = join(base, "dati");
  const lanciatori = join(base, "bin");
  const fintiBin = join(dati, "toolchain", "node_modules", ".bin");
  mkdirSync(fintiBin, { recursive: true });
  writeFileSync(join(fintiBin, "node"), "#!/bin/sh\nexit 0\n");
  // Il pnpm finto: «build» controlla nella copia installata i file che la
  // compilazione vera usa (quelli nominati dallo script build di package.json).
  writeFileSync(
    join(fintiBin, "pnpm"),
    `#!/bin/sh
case "$1" in
install) exit 0 ;;
build)
  [ -n "\${FINTO_ERRORE:-}" ] && { echo "src/x.ts(1,1): error TS2322: $FINTO_ERRORE"; exit 2; }
  for f in $(sed -n 's/.*"build": "\\(.*\\)",$/\\1/p' package.json | grep -o 'tsconfig[A-Za-z.]*json') index.html vite.config.ts src/server/main.ts src/tui; do
    [ -e "$f" ] || { echo "error TS5058: The specified path does not exist: '$f'"; exit 2; }
  done
  echo build-ok ;;
esac
`,
  );
  chmodSync(join(fintiBin, "node"), 0o755);
  chmodSync(join(fintiBin, "pnpm"), 0o755);
  const installa = (extra: Record<string, string> = {}) =>
    spawnSync("sh", ["scripts/install.sh"], {
      encoding: "utf8",
      env: { ...process.env, CONTINUITY_DATA_DIR: dati, CONTINUITY_BIN_DIR: lanciatori, ...extra },
    });
  const prima = installa();
  expect(prima.status, prima.stderr + prima.stdout).toBe(0);
  expect(readFileSync(join(dati, "installazione.log"), "utf8")).toContain("build-ok");
  const versione = spawnSync(join(lanciatori, "continuity"), ["version"], { encoding: "utf8", env: { ...process.env, CONTINUITY_DATA_DIR: dati } });
  expect(versione.stdout.trim()).toBe(JSON.parse(readFileSync("package.json", "utf8")).version);

  const rotta = installa({ FINTO_ERRORE: "Type 'x' is not assignable" });
  expect(rotta.status).toBe(1);
  expect(rotta.stderr).toContain("Compilazione non riuscita");
  expect(rotta.stderr).toContain("error TS2322: Type 'x' is not assignable");
  // La versione installata prima resta e funziona.
  expect(existsSync(join(dati, "app", "package.json"))).toBe(true);
  expect(spawnSync(join(lanciatori, "continuity"), ["version"], { encoding: "utf8", env: { ...process.env, CONTINUITY_DATA_DIR: dati } }).status).toBe(0);
});

it("CT-2.0-610: NVIDIA, se il primo modello consigliato non c'è per l'account (404) si prova il seguente", async () => {
  const nvidia = providerNoto("nvidia")!;
  const provati: string[] = [];
  const esito = await provaCollegamento(nvidia, "nvapi-buona", (async (url: any, init: any) => {
    if (String(url).endsWith("/models"))
      return new Response(JSON.stringify({ data: [{ id: "nvidia/nemotron-3-super-120b-a12b" }, { id: "nvidia/nemotron-3.5-super-vl-120b-a12b" }] }));
    const m = JSON.parse(init.body).model;
    provati.push(m);
    return new Response("{}", { status: m === "nvidia/nemotron-3-super-120b-a12b" ? 404 : 200 });
  }) as any);
  expect(provati).toEqual(["nvidia/nemotron-3-super-120b-a12b", "nvidia/nemotron-3.5-super-vl-120b-a12b"]);
  expect(esito).toEqual({ ok: true, dettaglio: "chiave valida" });
});

it("CT-2.0-606: un nome scelto dalla persona uguale a uno predefinito resta com'è; quelli predefiniti si traducono", () => {
  const dati = temp("lingua-c8-");
  impostaLingua(dati, "en");
  try {
    ricordaNomiScelti({ flussi: [{ id: "x1", nome: "Scrive" }], ruoli: [{ id: "scrive", nome: "Rivede", predefinito: true }] });
    expect(traduci("Scrive")).toBe("Scrive");
    expect(traduci("Flusso «Scrive»")).toBe("Workflow ‘Scrive’");
    expect(traduci("Rivede")).toBe("Review");
    expect(traduci("Pianifica.md")).toBe("Pianifica.md");
  } finally {
    ricordaNomiScelti({ flussi: [], ruoli: [] });
    impostaLingua(dati, "it");
  }
});
