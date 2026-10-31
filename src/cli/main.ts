import { PROVIDER_ESCLUSI, PROVIDER_SESSIONE } from "../core/catalogo.js";
import { dicitura, improntaApp, leggiBuild, vaSostituito } from "../core/build.js";
import { antigravityBinary } from "../adapters/antigravity.js";
import { GEMINI_PERSONAL_UNAVAILABLE } from "../adapters/exit.js";
import { providerStatus, providerLogin, type Provider } from "./providers.js";
import { inspectProject, openProject } from "../core/project.js";
import { cartellaAdatta } from "../core/detect.js";
import { createInterface } from "node:readline/promises";
// Una domanda sul lettore già aperto: aprirne un altro sullo stesso input fa
// comparire ogni tasto due volte, perché entrambi fanno l'eco.
async function chiediAlLettore(
  lettore: ReturnType<typeof createInterface> | undefined,
  invito: string,
) {
  if (lettore) return lettore.question(invito);
  const temporaneo = createInterface({ input: stdin, output: stdout });
  try {
    return await temporaneo.question(invito);
  } finally {
    temporaneo.close();
  }
}
import { stdin, stdout } from "node:process";
import { runSession, creaLettore } from "./session.js";
import { collega, scollega } from "./collega.js";
import { inSilenzio, uscitaLettore } from "./muto.js";
import { portachiaviDiSistema } from "../core/portachiavi.js";
import { providerNoto } from "../core/provider.js";
import { sequenzaPredefinita } from "../core/collegati.js";
import { schermataIniziale } from "./benvenuto.js";
import { scrivi } from "./schermo.js";
const versione = () => {
  try {
    return readFileSync(
      join(
        fileURLToPath(new URL("../..", import.meta.url)),
        ".continuity-version",
      ),
      "utf8",
    ).trim();
  } catch {
    return "0.1.0";
  }
};
import { execFileSync, spawn } from "node:child_process";
import {
  readFileSync,
  existsSync,
  mkdirSync,
  openSync,
  writeFileSync,
  realpathSync,
} from "node:fs";
import { join, resolve, basename } from "node:path";
import { resolveProvider } from "../adapters/resolve.js";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { apriLink, cartellaDatiPredefinita } from "../piattaforma.js";
const args = process.argv.slice(2);
// Senza argomenti si lavora qui: è il modo in cui la gente usa questi strumenti.
const primo = args[0] && !args[0].startsWith("-") ? args[0] : "session";
// «continuity setup» e «continuity configura»: la sessione nella cartella, con
// la configurazione iniziale aperta (piano di pubblicazione, punto 3).
const apriConfigurazione = primo === "setup" || primo === "configura";
const command = apriConfigurazione ? "session" : primo;
const value = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
// Dove si trova l'utente, non dove si trova l'applicazione.
const qui = process.env.CONTINUITY_CWD ?? process.cwd();
const root = resolve(cartellaDatiPredefinita());
// La versione di questo processo si fissa all'avvio: il codice in esecuzione
// è quello caricato allora. Rileggendola dal disco a ogni chiamata, un terminale
// rimasto aperto dopo un aggiornamento si credeva nuovo e abbatteva il servizio
// — anche in pieno turno.
const MIA_VERSIONE = improntaApp(fileURLToPath(new URL("../..", import.meta.url)));
async function service() {
  let config: any;
  try {
    config = JSON.parse(readFileSync(join(root, "service.json"), "utf8"));
    const health = await fetch(config.origin + "/api/v1/health", {
      signal: AbortSignal.timeout(1000),
    });
    // Un servizio avviato da un'installazione precedente risponde, ma con il
    // codice vecchio: la scritta «ultima modifica» direbbe il falso. Si ferma
    // e si riavvia quello nuovo, come fa l'installazione.
    const mia = MIA_VERSIONE;
    // Si sostituisce solo un servizio più vecchio: un terminale rimasto aperto
    // con la versione precedente non deve abbattere quello nuovo. E mai mentre
    // lavora: un aggiornamento che interrompe un turno fa perdere il lavoro.
    const stato: any = health.ok ? await health.json().catch(() => ({})) : {};
    if (
      health.ok &&
      vaSostituito(config.build, mia, stato.occupato !== false)
    ) {
      try {
        process.kill(config.pid, "SIGTERM");
      } catch {}
      for (let i = 0; i < 50; i++) {
        await new Promise((r) => setTimeout(r, 100));
        try {
          process.kill(config.pid, 0);
        } catch {
          break;
        }
      }
    } else if (health.ok) return config;
  } catch {}
  // Every command that acts on a run needs the service: refusing to start it
  // would leave a paused run impossible to reconcile.
  if (
    ![
      "ui",
      "demo",
      "run",
      "session",
      "live-smoke",
      "status",
      "events",
      "pause",
      "resume",
      "cancel",
      "switch",
      "restore",
      "handoff",
    ].includes(command)
  )
    throw Error("Servizio non disponibile: avviare pnpm start");
  const appRoot = fileURLToPath(new URL("../..", import.meta.url));
  if (!existsSync(join(appRoot, "dist", "index.html")))
    throw Error("GUI non compilata: eseguire pnpm build");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const log = openSync(join(root, "service.log"), "a", 0o600);
  const child = spawn(
    process.execPath,
    ["--import", "tsx", join(appRoot, "src/server/main.ts")],
    {
      cwd: appRoot,
      env: process.env,
      // Staccato: sopravvive al terminale (su Windows Node chiude i figli non
      // staccati quando il padre esce). Le sue finestre restano nascoste
      // (piattaforme/windows/processi.ts, nascondiFinestre).
      detached: true,
      windowsHide: true,
      stdio: ["ignore", log, log],
    },
  );
  child.unref();
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 100));
    try {
      config = JSON.parse(readFileSync(join(root, "service.json"), "utf8"));
      const health = await fetch(config.origin + "/api/v1/health", {
        signal: AbortSignal.timeout(300),
      });
      if (health.ok) return config;
    } catch {}
  }
  throw Error(
    "Avvio backend non riuscito: consultare service.log e server.lock",
  );
}
// La configurazione del servizio vale qualche secondo: rileggerla e rifare il
// controllo di salute a ogni chiamata erano circa 6 richieste ogni 400 ms
// mentre la nuova interfaccia segue un turno (revisione del 14 ottobre).
let configRecente: { config: any; quando: number } | undefined;
async function serviceRecente() {
  if (configRecente && Date.now() - configRecente.quando < 5000)
    return configRecente.config;
  const config = await service();
  configRecente = { config, quando: Date.now() };
  return config;
}
async function api(path: string, body?: unknown) {
  // Stessa chiave per l'eventuale secondo tentativo: il servizio non esegue
  // due volte la stessa richiesta.
  const chiave = randomUUID();
  const chiama = async () => {
    const config = await serviceRecente();
    return fetch(config.origin + "/api/v1" + path, {
      method: body ? "POST" : "GET",
      headers: {
        authorization: "Bearer " + config.apiToken,
        accept: "application/json",
        ...(body
          ? {
              "content-type": "application/json",
              "x-continuity-csrf": "same-origin",
              "idempotency-key": chiave,
            }
          : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  };
  let res: Response;
  try {
    res = await chiama();
  } catch {
    // Servizio non raggiungibile con la configurazione in memoria (riavviato,
    // porta cambiata): la si rilegge e si riprova una volta.
    configRecente = undefined;
    res = await chiama();
  }
  const data = (await res.json()) as any;
  if (!res.ok) throw Error(data.message ?? "Errore API");
  return data;
}
try {
  if (command === "doctor" || command === "init") {
    const check = (bin: string, params: string[], cwd?: string) => {
      try {
        return {
          status: "pass",
          detail: execFileSync(bin, params, {
            cwd,
            encoding: "utf8",
            timeout: 10000,
            stdio: ["ignore", "pipe", "pipe"],
          }).trim(),
        };
      } catch {
        return { status: "warn", detail: "Non disponibile" };
      }
    };
    const cliTrovata = (nome: "codex" | "claude") => {
      try {
        const p = resolveProvider(nome, root);
        return { status: "pass", detail: `${p.version} (${p.path})` };
      } catch {
        return { status: "warn", detail: "Non disponibile" };
      }
    };
    const project = value("--project");
    let projectStatus: unknown = "Fixture incorporata";
    if (project) {
      const path = realpathSync(resolve(qui, project));
      const git = check("git", ["status", "--porcelain=v1"], path);
      projectStatus = {
        path,
        git,
        baseline:
          git.status === "pass" && git.detail === "" ? "clean" : "blocked",
        note: "Repository arbitrari non eseguibili nel profilo fixture",
      };
    }
    console.log(
      JSON.stringify(
        {
          node: {
            // Node 26.4 o successivo (OpenTUI, package.json «engines»).
            status: process.versions.node.startsWith("26.") ? "pass" : "warn",
            version: process.versions.node,
          },
          git: check("git", ["--version"]),
          // Codex e Claude Code con la stessa ricerca dei turni (PATH,
          // installatori ufficiali, estensioni degli editor).
          codex: cliTrovata("codex"),
          gemini: check("gemini", ["--version"]),
          antigravity: check(antigravityBinary(), ["--version"]),
          claude: cliTrovata("claude"),
          project: projectStatus,
          live: "Non validato; nessuna chiamata LLM dal doctor",
          dataDir: root,
        },
        null,
        2,
      ),
    );
  } else if (command === "connect") {
    const target = args[1];
    if (target && !["codex", "claude", "antigravity"].includes(target))
      throw Error(
        "Provider non supportato: usare codex, claude o antigravity. Il percorso personale Gemini è dismesso dal servizio.",
      );
    if (target) {
      const login = providerLogin(target as Provider, root);
      console.log(login.note);
      const child = spawn(login.binary, login.args, {
        stdio: "inherit",
        env: login.env,
        cwd: login.cwd,
      });
      const code: number = await new Promise((done) =>
        child.on("close", (c) => done(c ?? 1)),
      );
      const after = providerStatus(target as Provider, root);
      console.log(
        after.connected
          ? `\n${target}: collegato · ${after.detail}`
          : `\n${target}: non collegato · ${after.detail}. La chiusura del programma non conferma il login.`,
      );
      process.exitCode = after.connected ? 0 : code || 4;
    } else {
      let missing = 0;
      console.log("Provider di Continuity\n");
      for (const name of PROVIDER_SESSIONE) {
        const s = providerStatus(name, root);
        if (!s.connected) missing++;
        console.log(
          `${s.connected ? "collegato    " : "da collegare "} ${name.padEnd(12)} ${s.detail}`,
        );
        if (!s.connected)
          console.log(`${" ".repeat(14)} → continuity connect ${name}`);
      }
      for (const [nome, motivo] of Object.entries(PROVIDER_ESCLUSI))
        console.log(`non usato     ${nome.padEnd(12)} ${motivo}`);
      console.log(
        "\nAltri provider (chiavi API, OpenRouter, Ollama, LM Studio…): continuity collega",
      );
      console.log(
        missing
          ? `\n${missing} provider da collegare. Continuity non legge né copia credenziali: il login avviene nel CLI ufficiale.`
          : "\nCodex e Claude sono collegati: scrivi «continuity» in una cartella per cominciare.",
      );
      process.exitCode = missing ? 3 : 0;
    }
  } else if (command === "collega") {
    const chiavi = portachiaviDiSistema(root);
    const rl = createInterface({
      input: stdin,
      output: uscitaLettore,
      terminal: Boolean(stdin.isTTY),
    });
    try {
      const esito = await collega(
        root,
        chiavi,
        {
          chiedi: (invito) => rl.question(invito),
          // La chiave non compare a schermo: si scrive solo l'invito.
          chiediNascosto: (invito) => inSilenzio(invito, () => rl.question("")),
          scrivi: (t) => void stdout.write(t),
        },
        args[1],
      );
      rl.close();
      if (esito.stato === "abbonamento") {
        console.log(
          `  Si collega con il login ufficiale: «continuity connect ${esito.provider.motore}».`,
        );
      } else if (esito.stato === "collegato") {
        console.log(
          `  ✓ ${esito.provider.id} collegato · ${esito.dettaglio}\n` +
            `  Nelle sessioni nuove entra in sequenza; in quelle aperte: «/ai ${esito.provider.id}».`,
        );
      } else if (esito.stato === "fallito") {
        console.log(`  ✗ ${esito.provider?.id ?? ""} ${esito.dettaglio ?? ""}`.trimEnd());
        process.exitCode = 3;
      } else console.log("  Nessun cambiamento.");
    } finally {
      rl.close();
    }
  } else if (command === "scollega") {
    if (!args[1]) throw Error("Quale provider? continuity scollega <nome>");
    const { provider, tolta } = scollega(root, portachiaviDiSistema(root), args[1]);
    console.log(
      `${provider.id} scollegato${tolta ? " · chiave tolta dall'archivio delle chiavi" : ""}`,
    );
  } else if (command === "gemini-login") {
    throw Error(GEMINI_PERSONAL_UNAVAILABLE);
  } else if (command === "ui") {
    const { url } = await api("/session/tickets", {});
    console.log(url);
    if (args.includes("--open")) apriLink(url);
  } else if (command === "session") {
    // Prima cosa in assoluto: da qui in poi ciò che viene digitato è in coda.
    const lettore = stdin.isTTY ? creaLettore() : undefined;
    // L'avvio del servizio può richiedere secondi: senza un ascoltatore subito,
    // ciò che viene digitato compare a schermo e poi sparisce.
    const anticipate: string[] = [];
    lettore?.on("line", (riga: string) => anticipate.push(riga));
    let dove = resolve(qui, value("--project") ?? ".");
    let controllo = cartellaAdatta(dove);
    // Meglio una domanda che partire sulla cartella sbagliata: succede a chi apre
    // il terminale e scrive continuity senza spostarsi.
    while (!controllo.adatta) {
      console.log(`\nQui non posso lavorare: ${controllo.motivo}.`);
      if (!stdin.isTTY)
        throw Error(
          "Spostati nella cartella del progetto, oppure: continuity --project /percorso",
        );
      // Si riusa il lettore già aperto: aprirne un secondo sullo stesso input
      // faceva comparire ogni tasto due volte.
      let risposta = "";
      try {
        risposta = (
          await chiediAlLettore(lettore, "In quale cartella vuoi lavorare? ")
        ).trim();
      } catch {
        risposta = "";
      }
      if (!risposta)
        throw Error(
          "Nessuna cartella indicata. Spostati nel progetto e riprova: cd /percorso && continuity",
        );
      dove = resolve(qui, risposta.replace(/^~/, homedir()));
      controllo = cartellaAdatta(dove);
    }
    const project = openProject(dove);
    // Sequenza predefinita (decisione di Lorenzo del 14 ottobre): gli
    // abbonamenti ChatGPT e Claude, poi i provider che la persona ha
    // collegato. Si cambia in ogni momento con «/ordine».
    const providers = (
      value("--providers") ?? sequenzaPredefinita(root).join(",")
    )
      .split(",")
      .map((p) => providerNoto(p)?.id ?? p);
    for (const name of providers)
      if (!providerNoto(name))
        throw Error(
          `Provider non supportato nella rotazione: ${name}` +
            (PROVIDER_ESCLUSI[name] ? ` (${PROVIDER_ESCLUSI[name]})` : ""),
        );
    const verifiche = project.config.verify;
    // Riprendere è il caso normale: si torna nella stessa cartella per continuare.
    const ultima = await api(
      `/sessions/last?project=${encodeURIComponent(project.root)}`,
    ).catch(() => ({ id: null }));
    // Una sessione rimasta bloccata altrove non deve essere un vicolo cieco:
    // si offre di chiuderla, spiegando dove si trova.
    const apri = async (): Promise<any> =>
      api("/sessions", {
        goal: value("--goal") ?? project.config.goal ?? "Sessione di lavoro",
        project: project.root,
        approvedCommands: project.commandsDigest,
        providers,
        mode: args.includes("--simulazione") ? "simulation" : "live",
      }).catch(async (e) => {
        const messaggio = e instanceof Error ? e.message : String(e);
        // Il testo dell'engine è cambiato: cercando la vecchia frase, l'offerta
        // di chiudere la sessione precedente non compariva più e restava solo
        // un errore senza via d'uscita.
        if (!/lavoro in corso|sessione da chiudere/i.test(messaggio)) throw e;
        console.log("\n" + messaggio);
        const bloccate = await api("/runs").then(
          (tutte: any[]) =>
            // Solo la run che sta lavorando davvero: le sessioni in pausa o
            // pronte di altre cartelle si possono riprendere, e annullarle
            // tutte le perdeva insieme alla loro copia di lavoro.
            tutte.filter(
              (r) =>
                ![
                  "SUCCEEDED",
                  "CANCELLED",
                  "FAILED",
                  "PAUSED",
                  "READY",
                  "BLOCKED",
                ].includes(r.state),
            ),
          () => [],
        );
        const risposta = await chiediAlLettore(
          lettore,
          "La chiudo e apro qui? [s/n] ",
        ).catch(() => "");
        if (!/^s|^y/i.test(risposta.trim()))
          throw Error("Sessione precedente lasciata aperta");
        for (const vecchia of bloccate)
          await api(`/runs/${vecchia.id}/actions`, {
            action: "cancel",
            expectedVersion: vecchia.version,
          }).catch(() => null);
        return apri();
      });
    const run = ultima.id ? { id: ultima.id } : await apri();
    // Riprendendo, le verifiche seguono la cartella com'è adesso: test nati
    // dopo l'apertura della sessione devono essere eseguiti anche loro.
    if (ultima.id && ultima.verifiche !== project.commandsDigest)
      await api(`/runs/${ultima.id}/verifiche`, {
        approvedCommands: project.commandsDigest,
      }).catch(() => null);
    const intestazione = () =>
      schermataIniziale({
        versione: versione(),
        aggiornamento: dicitura(
          leggiBuild(fileURLToPath(new URL("../..", import.meta.url))),
        ),
        cartella: project.root,
        senzaGit: Boolean(project.senzaGit),
        verifiche: verifiche.map((v) => v.command.join(" ")),
        origineVerifiche: project.origine,
        modificati: project.modificati.length,
        rotazione: providers,
        ripresa: ultima.id
          ? {
              turni: ultima.turni,
              recuperata: ultima.stato === "BLOCKED",
              quando: new Date(ultima.quando).toLocaleString("it-IT", {
                day: "numeric",
                month: "long",
                hour: "2-digit",
                minute: "2-digit",
              }),
            }
          : undefined,
      });
    // La nuova interfaccia a schermo intero (Fase 2), se c'è un terminale;
    // quella a righe resta con --righe o CONTINUITY_INTERFACCIA=righe.
    if (
      stdin.isTTY &&
      stdout.isTTY &&
      !args.includes("--righe") &&
      process.env.CONTINUITY_INTERFACCIA !== "righe"
    ) {
      lettore?.close();
      // Il JSX dell'interfaccia passa da Babel (src/tui/hook.mjs).
      await import(new URL("../tui/carica.mjs", import.meta.url).href);
      const { avviaTui } = await import(
        new URL("../tui/avvio.tsx", import.meta.url).href
      );
      const { configurazioneFatta } = await import(
        new URL("../tui/configura.ts", import.meta.url).href
      );
      await avviaTui({
        api,
        id: run.id,
        cartella: project.root,
        cartellaDati: root,
        anticipate,
        configura: apriConfigurazione,
        proponiConfigurazione: !apriConfigurazione && !configurazioneFatta(root),
      });
    } else await runSession(api, run.id, intestazione, lettore, anticipate);
  } else if (command === "demo" || command === "run") {
    const projectPath = value("--project");
    const task = value("--task-file");
    let goal = task
      ? readFileSync(resolve(qui, task), "utf8").trim()
      : (value("--task") ?? "Validare quantità e totale del carrello");
    let approvedDigest: string | undefined;
    if (projectPath) {
      const project = inspectProject(resolve(qui, projectPath));
      goal = task || value("--task") ? goal : (project.config.goal ?? goal);
      if (!task && !value("--task") && !project.config.goal)
        throw Error(
          'Obiettivo assente: usare --task "..." oppure il campo goal in continuity.json',
        );
      console.log(
        [
          `Progetto: ${project.root}`,
          `Ramo ${project.branch} · commit ${project.head.slice(0, 10)} · albero pulito`,
          `Obiettivo: ${goal}`,
          "",
          "Continuity eseguirà questi comandi nel worktree per verificare il risultato:",
          ...project.config.verify.map(
            (v) => `  ${v.id.padEnd(12)} ${v.command.join(" ")}   (${v.label})`,
          ),
          "",
          "Il tuo repository non viene modificato: il lavoro avviene in un worktree separato.",
        ].join("\n"),
      );
      if (!args.includes("--approve-commands"))
        throw Error(
          "Comandi non approvati: ripetere con --approve-commands dopo averli letti.",
        );
      approvedDigest = project.commandsDigest;
    }
    const live = args.includes("--live");
    if (live && !projectPath)
      throw Error("--live richiede --project: la fixture usa live-smoke");
    if (live)
      console.log(
        "Modalità live: i provider reali lavoreranno sul worktree e consumeranno quota dei tuoi abbonamenti.\n",
      );
    const r = await api("/demo", {
      goal,
      successor: value("--successor") ?? "claude",
      ...(live ? { mode: "live" } : {}),
      ...(projectPath
        ? {
            project: resolve(qui, projectPath),
            approvedCommands: approvedDigest,
          }
        : {}),
    });
    console.log(
      JSON.stringify(
        {
          runId: r.id,
          state: r.state,
          mode: r.mode,
          note: "Avvio asincrono, risultato non ancora verificato",
        },
        null,
        2,
      ),
    );
  } else if (command === "live-smoke") {
    if (
      !args.includes("--no-paid-api") &&
      !args.includes("--subscriptions-only")
    )
      throw Error(
        "Richiesto --no-paid-api e autorizzazione di una prova nel servizio",
      );
    const r = await api("/live-smoke", {
      successor: value("--successor") ?? "claude",
    });
    console.log(
      JSON.stringify({ runId: r.id, state: r.state, mode: r.mode }, null, 2),
    );
  } else if (command === "status") {
    const id = value("--run");
    console.log(
      JSON.stringify(await api(id ? "/runs/" + id : "/runs"), null, 2),
    );
  } else if (command === "events") {
    const id = value("--run");
    if (!id) throw Error("--run richiesto");
    console.log(
      JSON.stringify(
        await api(
          `/runs/${id}/events?afterSeq=${Number(value("--after-seq") ?? 0)}`,
        ),
        null,
        2,
      ),
    );
  } else if (
    ["pause", "resume", "cancel", "switch", "restore"].includes(command)
  ) {
    const id = value("--run");
    if (!id) throw Error("--run richiesto");
    const r = await api("/runs/" + id);
    console.log(
      JSON.stringify(
        await api(`/runs/${id}/actions`, {
          action: command === "restore" ? "restore-copy" : command,
          expectedVersion: r.version,
        }),
        null,
        2,
      ),
    );
  } else if (command === "handoff" && args[1] === "export") {
    const id = value("--run"),
      output = value("--output");
    if (!id || !output) throw Error("--run e --output richiesti");
    const bundle = await api("/runs/" + id + "/export");
    writeFileSync(resolve(qui, output), JSON.stringify(bundle, null, 2), {
      flag: "wx",
      mode: 0o600,
    });
    console.log("Pacchetto esportato in " + resolve(qui, output));
  } else {
    console.log(
      [
        "Continuity — continuità del lavoro fra AI di coding.",
        "",
        "  continuity setup | configura        configurazione iniziale: lingua, sistema, le tue AI",
        "  continuity connect                  stato di Codex e Claude, e come collegarli",
        "  continuity connect <provider>       apre il login ufficiale del provider",
        "  continuity collega [provider]       collega un provider: chiave API, server locale o abbonamento",
        "  continuity scollega <provider>      toglie la chiave dall'archivio delle chiavi",
        "  continuity doctor                   diagnosi di ambiente e CLI",
        "  continuity demo [--successor X]     prova simulata sulla fixture, nessuna quota consumata",
        "  continuity session --project DIR --approve-commands",
        "                                      sessione interattiva: scrivi i prompt uno dopo l'altro,",
        "                                      il passaggio fra AI a crediti esauriti è automatico",
        '  continuity run --project DIR --task "..." --approve-commands [--live]',
        "                                 lavora sul tuo repository; --live usa i provider reali",
        "  continuity ui [--open]              apre il pannello locale",
        "  continuity live-smoke --successor X --no-paid-api    prova reale, richiede autorizzazione",
        "  continuity status [--run ID] | events --run ID",
        "  continuity pause|resume|cancel|switch|restore --run ID",
        "  continuity handoff export --run ID --output FILE",
      ].join("\n"),
    );
    if (command !== "help") process.exitCode = 2;
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 4;
}
