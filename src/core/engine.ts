import {
  LETTORI,
  scopriConnettori,
  type Connettore,
} from "../adapters/connettori.js";
import { resolveProvider } from "../adapters/resolve.js";
import {
  motoreDi,
  nuovaSequenza,
  providerNoto,
  type ProviderNoto,
} from "./provider.js";
import { portachiaviDiSistema, type Portachiavi } from "./portachiavi.js";
import { chiediModello, ErroreGratuito, inOrdine, modelliGratuiti, primoCheFunziona, siPassaAlProssimo, type ModelloGratuito } from "./gratuiti.js";
import { collegati } from "./collegati.js";
import {
  accorcia,
  caratteriPer,
  NESSUN_SUGGERIMENTO,
  rivedeConUnTurno,
  chiediRevisione,
  differenze,
  leggiSuggerimenti,
  messaggiRevisione,
  revisorePredefinito,
  normalizzaRevisore,
  descriviOgniTurni,
  TURNI_MASSIMI,
  sceltaRevisore,
  serveConsenso,
  PREFERITI_REVISORE,
  type ConfigRevisore,
  type Differenze,
} from "./revisore.js";
import { assicuraOllama, binarioOllama, eseguiCompito, leggiIbrida, liberaModello, nomeLocale } from "./ibrida.js";
// Il provider del modello locale nella riserva e nei turni «sui file».
const PROVIDER_IBRIDO = "ollama";
export const ATTESA_PERMESSO_MS = 170_000;
// Il segno con cui un modello che risponde soltanto dice «serve un'AI che
// lavori sui file» (decisione del 25 ottobre: lo dice e propone Codex/Claude).
export const SEGNO_FILE = "[SERVE-AI-SUI-FILE]";
// «Groq (gratuito)» → «Groq»: il nome breve per la conversazione.
function nomeServizio(p: { nome: string }) {
  return p.nome.split(" · ")[0].replace(/\s*\(.*\)\s*$/, "").trim();
}
// Il modello proposto da solo, senza chiedere: il primo che corrisponde ai
// preferiti del servizio, altrimenti il primo dell'elenco.
export function modelloConsigliato(p: { consigliati?: RegExp[] }, elenco: string[]) {
  for (const r of p.consigliati ?? []) {
    const m = elenco.find((x) => r.test(x));
    if (m) return m;
  }
  return elenco[0];
}
// I nomi dei file della copia, per dare un'idea del progetto a chi non li
// può leggere (al massimo 300, senza dipendenze e cartelle nascoste).
function elencoFile(radice: string, massimo = 300) {
  const fuori: string[] = [];
  const giro = (cartella: string, prefisso: string) => {
    for (const voce of readdirSync(cartella, { withFileTypes: true })) {
      if (fuori.length >= massimo) return;
      if (voce.name.startsWith(".") || ["node_modules", "dist", "build", "allegati"].includes(voce.name)) continue;
      const nome = prefisso + voce.name;
      if (voce.isDirectory()) giro(join(cartella, voce.name), nome + "/");
      else fuori.push(nome);
    }
  };
  giro(radice, "");
  return fuori;
}

import { PROVIDER as PROVIDER_REGISTRO } from "./provider.js";
import {
  caricaCatalogo,
  costoStimato,
  dollari,
  prezziDi,
  type Catalogo,
} from "./modelsdev.js";
import { percorsoSensibile } from "./sensibili.js";
import { copiaVeloce } from "../piattaforma.js";
import {
  CARTELLA_CONTINUITY,
  leggiAgenti,
  preparaCartellaContinuity,
} from "./agenti.js";
import {
  eseguiPubblicazione,
  indirizzoWeb,
  preparaPubblicazione,
  risolviDestinazione,
} from "./pubblica.js";
import { redact } from "../persistence/redact.js";
import { LIMITE_RICHIESTA } from "./limiti.js";
import {
  allineaPermessi,
  controllaConfinamento,
  eseguiPiano,
  ignoratiDaConsegnare,
  impronta,
  pianoConsegna,
  potaVuote,
  cambiamentiDellaPersona,
} from "./consegna.js";
import { FigliCodex } from "../adapters/codex-figli.js";
import {
  AntigravityStream,
  antigravityEnvironment,
  antigravityInput,
} from "../adapters/antigravity.js";
import { liveExitFailure } from "../adapters/exit.js";
import { geminiEnvironment } from "../adapters/gemini.js";
import type { Successor } from "../adapters/live.js";
import {
  MODELLI_NOTI,
  MODELLI_CLAUDE,
  MODELLI_CODEX,
  catalogoCodex,
  type ModelloNoto,
  RICARICA_ORE,
  quotaExhausted,
  quotaSuErrore,
  liveCommand,
  livePrompt,
  normalizedLiveEvent,
  controllaAbbonamentoClaude,
  requisitiProvider,
  ambienteProvider,
  cartellaCodexProvider,
  creditoEsaurito,
  projectPrompt,
  subscriptionEnvironment,
  requireSubscriptions,
  ambienteCache,
  RAGIONAMENTO_PREDEFINITO,
  type Ragionamento,
} from "../adapters/live.js";
import { ambienteGit } from "../git/ambiente.js";
import { randomUUID } from "node:crypto";
import {
  execFileSync,
  spawn,
  spawnSync,
  type ChildProcess,
} from "node:child_process";
import {
  chmodSync,
  cpSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  copyFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  lstatSync,
  statSync,
  appendFileSync,
  renameSync,
} from "node:fs";
import { join, resolve, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { validateHandoff, validatePackage } from "../handoff/schema.js";
import { Store } from "../persistence/store.js";
import {
  snapshot,
  hash,
  inventory,
  verify,
  restore,
  atomic,
  ripristinaSulPosto,
} from "../git/snapshot.js";
import {
  fermo,
  fermaProcessiNellaCartella,
  identificaGruppo,
  launch,
  stop,
} from "../supervisor/process.js";
import { JsonLines } from "../adapters/detector.js";
import { cartellaCanonica, commandsDigest, stessaCartella } from "./project.js";
import type { ProjectConfig } from "./project.js";
export type ProjectContext = {
  root: string;
  head: string;
  branch: string;
  verify: ProjectConfig["verify"];
  commandsDigest: string;
  modificati?: string[];
  senzaGit?: boolean;
};
// Cartelle che non sono il lavoro: copiarle sarebbe lento e inutile.
const ESCLUSI = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "out",
  "target",
  ".next",
  ".nuxt",
  ".venv",
  "venv",
  "__pycache__",
  ".cache",
  ".DS_Store",
  ".continuity",
]);
function copiaCartella(da: string, a: string) {
  mkdirSync(a, { recursive: true });
  for (const voce of readdirSync(da, { withFileTypes: true })) {
    if (ESCLUSI.has(voce.name) || voce.name.startsWith(".env")) continue;
    const origine = join(da, voce.name),
      destinazione = join(a, voce.name);
    if (voce.isSymbolicLink()) continue;
    if (voce.isDirectory()) copiaCartella(origine, destinazione);
    else if (voce.isFile()) copyFileSync(origine, destinazione);
  }
}
import { z } from "zod";
import { Ponte, type EsitoPonte } from "../ponte/server.js";
import { istruzioneLingua, leggiLingua, linguaScritta, type Lingua } from "./lingua.js";
import { scriviCatalogo, voceDiBase } from "../ponte/catalogo.js";
import { flussoDaIncarichi, incarichiDalMessaggio, nomeCorto, problemaIncarichi, type Incarico } from "./menzioni.js";
import {
  chiScrivePrima,
  descriviFlusso,
  FLUSSO_PREDEFINITO,
  idDaNome,
  leggiFlussi,
  leggiVerdetto,
  salvaFlussi,
  messaggiPasso,
  nomeAI as nomeAIPasso,
  promptPasso,
  soloUnTurno,
  type Esecuzione,
  type Flusso,
  type Ruolo,
} from "./flussi.js";
const verificationResults = z
  .array(
    z
      .object({
        id: z.enum(["positive", "negative", "empty"]),
        label: z.string().min(1),
        passed: z.boolean(),
      })
      .strict(),
  )
  .length(3)
  .refine((checks) => new Set(checks.map((check) => check.id)).size === 3);
const worker = fileURLToPath(
  new URL("../adapters/mock-worker.mjs", import.meta.url),
);
const checker = fileURLToPath(
  new URL("../verification/cart-check.mjs", import.meta.url),
);
// Non è lavoro da consegnare: le dipendenze sono condivise dalla cartella
// dell'utente e gli allegati sono materiale che ha dato lui.
// Dopo quanto silenzio totale l'AI viene segnalata alla persona (mai fermata).
const SILENZIO_DA_SEGNALARE = 20 * 60 * 1000;
// Cartelle che non sono lavoro da consegnare: dipendenze, allegati e le cache
// che strumenti e AI creano dentro il progetto (una prova reale del 7 ottobre
// ha consegnato un'intera .npm-cache con i log di npm).
const FUORI_CONSEGNA = [
  "node_modules",
  ".venv",
  "venv",
  "allegati",
  ".npm-cache",
  ".npm",
  ".yarn-cache",
  ".pnpm-store",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
];
// Dipendenze installate che la copia condivide con la cartella dell'utente,
// solo quando nella copia non esistono già. vendor/ ci rientra solo così: in
// molti progetti (Go, PHP) è codice tracciato, e allora è lavoro da consegnare.
const CONDIVISE = ["node_modules", ".venv", "venv", "vendor"];
// Lo stato di una voce, confrontabile: assente, cartella, collegamento, o file
// con contenuto e permesso di esecuzione. «Assente» e «cartella» erano la
// stessa cosa, e /annulla cancellava una cartella nuova della persona (CT-020).
function statoVoce(contenuto: Buffer | null, modo?: number) {
  return contenuto === null
    ? "assente"
    : `file:${impronta(contenuto)}:${modo !== undefined && (modo & 0o111) !== 0 ? "x" : "-"}`;
}
// Una cartella dove la consegna ha eliminato un file è opera della consegna
// stessa se tutto ciò che contiene è stato consegnato così com'è (l'AI ha
// sostituito un file con una cartella). Se dentro c'è altro, è della persona.
function cartellaDellaConsegna(
  radice: string,
  percorso: string,
  consegnato: Record<string, string>,
) {
  const dentro: string[] = [];
  // La consegna non crea mai cartelle vuote: se ce n'è una, l'ha creata la
  // persona (CT-023).
  let vuote = false;
  const scendi = (rel: string) => {
    const voci = readdirSync(join(radice, rel), { withFileTypes: true });
    if (!voci.length) vuote = true;
    for (const voce of voci) {
      const figlio = rel + "/" + voce.name;
      if (voce.isDirectory()) scendi(figlio);
      else dentro.push(figlio);
    }
  };
  try {
    scendi(percorso);
  } catch {
    return false;
  }
  if (vuote || !dentro.length) return false;
  return dentro.every(
    (f) => f in consegnato && statoAttuale(radice, f) === consegnato[f],
  );
}
function diversoDalConsegnato(
  radice: string,
  percorso: string,
  consegnato: Record<string, string>,
) {
  const ora = statoAttuale(radice, percorso);
  if (ora === consegnato[percorso]) return false;
  return !(
    consegnato[percorso] === "assente" &&
    ora === "cartella" &&
    cartellaDellaConsegna(radice, percorso, consegnato)
  );
}
function statoAttuale(radice: string, percorso: string) {
  const pieno = join(radice, percorso);
  try {
    const s = lstatSync(pieno);
    if (s.isDirectory()) return "cartella";
    if (s.isSymbolicLink()) return "collegamento";
    return statoVoce(readFileSync(pieno), s.mode);
  } catch {
    return "assente";
  }
}
// Esiste come voce, anche se è un collegamento che punta al vuoto.
const lstatOpzionale = (p: string) => {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
};
// Rimette una radice com'era al momento del deposito: prima elimina i file
// che allora non esistevano (dai più profondi, togliendo le cartelle rimaste
// vuote), poi ricopia quelli salvati, sostituendo un'eventuale cartella.
function ripristinaDeposito(
  radice: string,
  deposito: { deposito: string; file: { path: string; esisteva: boolean }[] },
) {
  // Ogni ripristino — /annulla, /annulla forza, il recupero dopo una consegna
  // fallita — passa dallo stesso controllo della scrittura: nessun percorso
  // attraverso un collegamento (CT-021).
  controllaConfinamento(
    radice,
    deposito.file.map((v) => v.path),
  );
  const assenti = deposito.file
    .filter((v) => !v.esisteva)
    .sort((x, y) => y.path.split("/").length - x.path.split("/").length);
  for (const voce of assenti) {
    rmSync(join(radice, voce.path), { recursive: true, force: true });
    potaVuote(radice, voce.path);
  }
  for (const voce of deposito.file.filter((v) => v.esisteva)) {
    const destinazione = join(radice, voce.path);
    if (existsSync(destinazione) && lstatSync(destinazione).isDirectory())
      rmSync(destinazione, { recursive: true, force: true });
    mkdirSync(dirname(destinazione), { recursive: true });
    copyFileSync(join(deposito.deposito, voce.path), destinazione);
  }
}
// Dipendenze e cache si escludono a qualunque profondità (src/__pycache__,
// packages/x/node_modules); «allegati» è la cartella di Continuity, alla radice.
const daConsegnare = (percorso: string) =>
  !(
    percorso === "allegati" ||
    percorso.startsWith("allegati/") ||
    percorso
      .split("/")
      .some((parte) => parte !== "allegati" && FUORI_CONSEGNA.includes(parte))
  );
const terminal = ["SUCCEEDED", "CANCELLED", "FAILED"];
const attive = [
  "STARTING",
  "RUNNING",
  "QUIESCING",
  "SNAPSHOTTING",
  "VERIFYING",
  "HANDOFF_READY",
];
export class Engine {
  children = new Map<string, ChildProcess>();
  busy = new Set<string>();
  // Testo che l'AI sta scrivendo adesso: serve solo a mostrarlo, quindi non
  // viene registrato né conservato.
  parziali = new Map<string, string>();
  // Ciò che l'AI sta facendo in questo momento (un comando appena partito):
  // si legge da /live e non entra nel registro.
  attivita = new Map<string, string>();
  // L'ultimo segno di vita dell'AI e l'ultima azione: se resta ferma a lungo
  // su uno strumento (un connettore che non risponde), l'interfaccia dice
  // quale (prova di Lorenzo del 23 ottobre, «rea: capture_browser_scenario»).
  ultimoSegno = new Map<string, number>();
  ultimaAzione = new Map<string, string>();
  stopRequests = new Map<string, "pause" | "cancel">();
  constructor(public store: Store) {
    // Le sessioni chiuse in precedenza possono aver lasciato worktree montati:
    // si smontano all'avvio, quando nessuno ci sta lavorando.
    for (const run of store.list())
      if (terminal.includes(run.state)) {
        try {
          this.smontaWorktree(run);
        } catch {}
      }
    for (const run of store.list()) {
      if (!terminal.includes(run.state) && run.state !== "PAUSED") {
        run.statoPrimaDelRiavvio = run.state;
        run.state = "BLOCKED";
        run.error =
          "Ripresa dopo riavvio: avvio precedente da riconciliare. Nessun processo rilanciato.";
        this.event(run, "recovery.completed", run.error);
      }
    }
  }
  event(run: any, type: string, message: string, source = "continuity") {
    try {
      return this.store.save(run, type, message, source);
    } catch (e) {
      // Persistence failure cannot leave an unsupervised writer running.
      for (const child of this.children.values())
        if (child.pid) {
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch {}
        }
      throw e;
    }
  }
  run(id: string) {
    const r = this.store.get(id);
    if (!r) throw Error("Run non trovata");
    return r;
  }
  current(id: string) {
    const r = this.run(id);
    // Il riquadro deve dire chi risponderà al prossimo messaggio: l'agente
    // memorizzato è quello dell'ultimo turno, e dopo un cambio di sequenza
    // mostrerebbe il nome sbagliato.
    if (r.session) r.modelliNonDisponibili = this.modelliNonDisponibili();
    // L'elenco dei connettori si prepara mentre la persona scrive: il turno
    // dopo lo trova pronto.
    if (r.session && r.mode === "live" && r.project)
      void this.connettoriSessione(r).catch(() => {});
    // Durante un turno risponde chi lavora: il valore salvato prima poteva
    // essere vecchio, e l'interfaccia scriveva «Codex sta lavorando» mentre
    // lavorava Claude (prova di Lorenzo del 19 ottobre).
    if (r.session)
      r.prossimo = this.children.has(id) || ["STARTING", "RUNNING", "QUIESCING"].includes(r.state)
        ? r.agent
        : (r.providers ?? []).find((p: string) => this.disponibile(r, p)) ??
          r.agent;
    if (
      !this.children.has(id) &&
      r.checks?.some((c: any) => c.status === "passed" || c.status === "failed")
    ) {
      let digest: string | undefined;
      try {
        digest = hash(JSON.stringify(inventory(r.work, Boolean(r.project))));
      } catch {}
      if (digest !== r.snapshotId) {
        r.checks = r.checks.map((c: any) => ({ ...c, status: "stale" }));
        if (r.state === "SUCCEEDED") r.state = "BLOCKED";
        r.error = "File modificati dopo la verifica: evidenze obsolete";
        this.event(r, "verification.stale", r.error);
      }
    }
    return r;
  }
  async create(
    goal: string,
    mode: "simulation" | "live" = "simulation",
    successor: Successor = "claude",
    project?: ProjectContext,
    session?: { providers: string[] },
  ) {
    // Nelle sessioni ogni AI si controlla al suo turno (requisitiProvider):
    // chi usa solo i servizi gratuiti, senza abbonamenti, deve poter aprire
    // Continuity (Fase 4, 28 ottobre). Il «successore» e il login ChatGPT
    // obbligatorio restano solo per la prova dimostrativa.
    if (session && !["gemini", "claude", "antigravity"].includes(successor)) successor = "claude";
    if (!["gemini", "claude", "antigravity"].includes(successor))
      throw Error("Successore non supportato");
    const compatibility =
      mode === "live" && !session
        ? requireSubscriptions(successor, this.store.root)
        : undefined;
    // Blocca solo ciò che ha davvero un processo dietro. Una sessione appena
    // aperta o parcheggiata non ne ha: il vincolo di un solo writer vale
    // all'avvio di un turno, dove lo fa rispettare start().
    // Una run bloccata non ha processi vivi: chiedere cosa farne ogni volta
    // trasformava un residuo di ieri in un ostacolo per lavorare oggi.
    // Due terminali aperti insieme nella stessa cartella: entrambi non
    // trovano una sessione e ne chiedono una. La seconda richiesta riceve la
    // stessa sessione, invece di dividere la conversazione in due.
    if (session && project) {
      const gemella = this.store
        .list()
        .find(
          (r) =>
            r.session &&
            stessaCartella(r.project?.root, project.root) &&
            ["READY", "PAUSED", "BLOCKED"].includes(r.state),
        );
      if (gemella) return this.run(gemella.id);
    }
    const occupata = this.store.list().find((r) => attive.includes(r.state));
    if (occupata)
      throw Error(
        `C'è già un lavoro in corso in ${occupata.project?.root ?? "un'altra cartella"}`,
      );
    const id = randomUUID(),
      dir = join(this.store.root, "runs", id),
      // The user's repository is never written to: only a worktree of it, created
      // under Continuity's own data directory, is given to the agents.
      repo = project ? project.root : join(dir, "fixture"),
      work = join(dir, "worktree");
    mkdirSync(project ? dir : repo, { recursive: true });
    const git = (args: string[], cwd = repo) =>
      execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
        cwd,
        encoding: "utf8",
        env: ambienteGit(cwd),
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
    // La cartella standard del progetto (agenti condivisi fra le AI), alla
    // prima sessione: prima della copia, così la copia la contiene già.
    if (project && session) {
      try {
        preparaCartellaContinuity(project.root);
      } catch {}
    }
    if (project?.senzaGit) {
      // Nessun repository: si lavora su una copia, versionata solo dentro
      // Continuity, così diff e ritorno del lavoro funzionano lo stesso.
      copiaCartella(project.root, work);
      git(["init", "-q"], work);
      git(["add", "-A"], work);
      git(
        [
          "-c",
          "user.name=Continuity",
          "-c",
          "user.email=continuity@localhost",
          "commit",
          "--allow-empty",
          "-qm",
          "Stato di partenza della cartella",
        ],
        work,
      );
    } else if (!project) {
      git(["init", "-q"]);
      writeFileSync(
        join(repo, "cart.mjs"),
        "export function total(items) { return 0; }\n",
      );
      git(["add", "cart.mjs"]);
      git([
        "-c",
        "user.name=Continuity fixture",
        "-c",
        "user.email=fixture@localhost",
        "-c",
        "core.hooksPath=/dev/null",
        "commit",
        "-qm",
        "Fixture baseline",
      ]);
    }
    const base = project?.senzaGit
      ? git(["rev-parse", "HEAD"], work)
      : project
        ? project.head
        : git(["rev-parse", "HEAD"]);
    if (!project?.senzaGit)
      git(["worktree", "add", "-b", "continuity/" + id, work, base]);
    // Uncommitted work is what the person is actually looking at: the agent must
    // see it too, or it would be working on a version that exists nowhere.
    // Se qualcosa va storto qui, il ramo e il worktree appena creati nel
    // repository dell'utente vanno tolti: prima restavano lì a ogni tentativo.
    try {
      if (!project?.senzaGit && project?.modificati?.length) {
        const patch = execFileSync("git", ["diff", "--binary", "HEAD"], {
          cwd: repo,
          encoding: "utf8",
          maxBuffer: 32 * 1024 * 1024,
          env: ambienteGit(repo),
        });
        if (patch.trim())
          execFileSync("git", ["apply", "--whitespace=nowarn", "-"], {
            cwd: work,
            input: patch,
            env: ambienteGit(work),
          });
        for (const file of git(["ls-files", "--others", "--exclude-standard"])
          .split("\n")
          .filter(Boolean)) {
          mkdirSync(dirname(join(work, file)), { recursive: true });
          copyFileSync(join(repo, file), join(work, file));
        }
        // Il punto di partenza diventa un commit nel worktree: così "cosa ha fatto
        // l'agente" è la differenza da lì, e la patch si applica sul progetto
        // dell'utente, che quello stato ce l'ha già.
        git(["add", "-A"], work);
        git(
          [
            "-c",
            "user.name=Continuity",
            "-c",
            "user.email=continuity@localhost",
            "commit",
            "-qm",
            "Stato di partenza: lavoro non salvato dell'utente",
          ],
          work,
        );
      }
    } catch (e) {
      if (project && !project.senzaGit) {
        try {
          git(["worktree", "remove", "--force", work]);
        } catch {}
        try {
          git(["branch", "-D", "continuity/" + id]);
        } catch {}
      }
      throw e;
    }
    // Le dipendenze installate non sono il lavoro, ma senza di esse i comandi del
    // progetto falliscono: la copia le condivide invece di reinstallarle.
    if (project) {
      const collegate: string[] = [];
      for (const dipendenze of CONDIVISE) {
        const origine = join(project.root, dipendenze);
        const destinazione = join(work, dipendenze);
        if (existsSync(origine) && !existsSync(destinazione)) {
          // Le AI ora installano pacchetti nella copia: attraverso un
          // collegamento avrebbero scritto nelle dipendenze della persona (o
          // la sandbox le avrebbe fermate). Si clona con APFS, istantaneo e
          // senza spazio in più (su Linux una copia, src/piattaforma.ts); gli ambienti Python restano collegati perché
          // contengono percorsi assoluti, e chi deve installare ne crea uno.
          if (!["venv", ".venv"].includes(dipendenze))
            try {
              copiaVeloce(origine, destinazione);
              collegate.push(dipendenze);
              continue;
            } catch {
              rmSync(destinazione, { recursive: true, force: true });
            }
          try {
            symlinkSync(origine, destinazione);
            collegate.push(dipendenze);
          } catch {}
        }
      }
      // L'esclusione vive nel worktree, non nel repository dell'utente: le
      // dipendenze condivise non devono finire fra i file da consegnare.
      try {
        const cartellaGit = execFileSync("git", ["rev-parse", "--git-dir"], {
          cwd: work,
          encoding: "utf8",
          env: ambienteGit(work),
        }).trim();
        const assoluta = cartellaGit.startsWith("/")
          ? cartellaGit
          : join(work, cartellaGit);
        mkdirSync(join(assoluta, "info"), { recursive: true });
        // Senza Git le cartelle generate e i file .env non vengono copiati:
        // per coerenza non vengono nemmeno consegnati. Altrimenti un build
        // dell'AI in dist/ sembrava un conflitto con la dist/ dell'utente e
        // bloccava l'intera consegna.
        const generate = project.senzaGit
          ? [...ESCLUSI]
              .filter((d) => d !== ".git")
              .map((d) => d + "/")
              .concat(".env*")
          : [];
        writeFileSync(
          join(assoluta, "info", "exclude"),
          [...new Set([...FUORI_CONSEGNA, ...collegate])]
            .map((d) => (d === "allegati" ? "/" + d : d + "/"))
            .concat(generate)
            .join("\n") + "\n",
        );
      } catch {}
    }
    const r: any = {
      id,
      projectId: project ? basename(project.root) : "fixture-cart",
      taskId: id,
      goal,
      version: 0,
      state: "READY",
      agent: session ? session.providers[0] : "codex",
      successor,
      switches: 0,
      mode,
      compatibility,
      project,
      session: session ? true : undefined,
      providers: session?.providers,
      transcript: session ? [] : undefined,
      criteria: project
        ? project.verify.map((v) => ({ id: v.id, description: v.label }))
        : [
            {
              id: "positive",
              description: "Totale corretto delle quantità positive",
            },
            { id: "negative", description: "Rifiutare quantità negative" },
            { id: "empty", description: "Totale carrello vuoto uguale a zero" },
          ],
      constraints: project
        ? [
            "Modificare soltanto i file del worktree indicato",
            "Comandi, test e rete solo dentro la sandbox, senza cambiare la storia Git della copia: la consegna la fa Continuity",
            "Il repository originale dell'utente non va toccato",
          ]
        : ["Nessun servizio esterno", "Fixture carrello"],
      createdAt: new Date().toISOString(),
      // Com'è fatto Git nella copia appena creata: a fine turno lo si
      // ripristina, perché l'AI può riscriverlo e Continuity ci esegue comandi.
      puntatoreGit: (() => {
        try {
          return lstatSync(join(work, ".git")).isFile()
            ? readFileSync(join(work, ".git"), "utf8")
            : undefined;
        } catch {
          return undefined;
        }
      })(),
      dir,
      repo,
      work,
      base,
      checks: [],
      snapshots: [],
      policy: {
        id: project
          ? "project-worktree-v1"
          : mode === "live"
            ? successor === "gemini" || successor === "antigravity"
              ? "live-google-fixture-v1"
              : "live-subscription-fixture-v1"
            : "demo-local-v1",
        providers: mode === "live" ? ["codex", successor] : ["mock"],
        externalEffects: "deny",
        maxSwitches: 1,
        quota: "unknown",
      },
      error: null,
    };
    this.event(
      r,
      "task.created",
      project
        ? `Progetto ${basename(project.root)} · ramo ${project.branch} · commit ${project.head.slice(0, 10)}; worktree isolato, repository originale non toccato. Verifiche approvate: ${project.verify.map((v) => v.label).join(", ")}.`
        : mode === "live"
          ? `Fixture autorizzata: Codex → ${successor}; nessuna API a consumo; passaggio per quota autentica se il provider la segnala, altrimenti interruzione indotta.`
          : "Task persistito; fixture isolata, nessun provider remoto.",
    );
    const s = this.checkpoint(r);
    r.baseline = s.id;
    this.event(
      r,
      "preflight.completed",
      "Baseline Git e checkpoint iniziale salvati.",
    );
    if (session) {
      this.store.save(
        r,
        "session.ready",
        "Sessione pronta: in attesa del primo messaggio",
      );
      return this.run(id);
    }
    await this.start(r);
    return this.run(id);
  }
  // A session keeps its own transcript: each provider turn is a fresh process, so
  // the thread cannot live inside the model. Continuity carries it and replays it,
  // which is exactly what makes swapping provider mid-conversation possible.
  // Un fatto accaduto ai file fuori dalle risposte dell'AI: un conflitto, una
  // consegna forzata, un'unione, un /annulla, un turno interrotto. Senza,
  // l'AI successiva credeva ancora presenti modifiche annullate dalla persona
  // e descriveva file che non esistevano più (collaudo utente del 5 ottobre).
  // Chi chiama registra subito dopo un evento, che rende persistente la nota.
  annota(r: any, testo: string) {
    if (r.session) this.remember(r, "continuity", testo);
  }
  remember(r: any, role: string, text: string, agent?: string) {
    // La richiesta dell'utente si conserva intera fino al limite che il
    // terminale accetta: prima la memoria ne teneva 100.000 caratteri su
    // 200.000 ammessi, e la coda di un mandato lungo spariva dai turni
    // successivi (collaudo del 3 ottobre, CT-006). Una risposta dell'AI si
    // riassume, ma il taglio è dichiarato. In memoria vanno anche oscurati i
    // segreti, come nel registro (CT-009).
    const limite = role === "utente" ? LIMITE_RICHIESTA : 16000;
    const pulito = redact(String(text));
    const voce = {
      role,
      agent,
      at: new Date().toISOString(),
      text:
        pulito.length <= limite
          ? pulito
          : pulito.slice(0, limite) +
            ` [… ${(pulito.length - limite).toLocaleString("it-IT")} caratteri omessi]`,
    };
    const storia = [...(r.transcript ?? []), voce];
    // La prima richiesta dell'utente è il mandato del lavoro e non si butta
    // mai: è ciò che permette a un'altra AI di continuare. Si pota il resto,
    // dalle voci più vecchie, finché la conversazione sta nel budget.
    const prima = storia.findIndex((t: any) => t.role === "utente");
    const testa = prima >= 0 ? [storia[prima]] : [];
    const coda = storia.filter((_: any, i: number) => i !== prima);
    const peso = () =>
      [...testa, ...coda].reduce((s: number, t: any) => s + t.text.length, 0);
    // L'ultima voce non si pota mai: è ciò a cui si sta rispondendo.
    while (
      coda.length > 1 &&
      (coda.length > 40 || peso() > LIMITE_RICHIESTA * 2)
    )
      coda.shift();
    r.transcript = [...testa, ...coda];
  }

  // Un provider esaurito non va riprovato a ogni turno. L'orario di ritorno lo
  // dice il provider stesso quando può; altrimenti si usano i tempi di ricarica
  // degli abbonamenti.
  segnaEsaurito(
    r: any,
    provider: string,
    ricaricaA?: string,
    credito = false,
  ) {
    // Il credito di una chiave non torna da solo a un orario: il provider resta
    // fuori finché la persona non lo ricarica e lo rimette in sequenza
    // («/ordine …») o lo ricollega.
    if (credito) {
      r.esauriti = {
        ...(r.esauriti ?? {}),
        [provider]: { da: new Date().toISOString(), credito: true },
      };
      return undefined;
    }
    const ore = RICARICA_ORE[provider] ?? 5;
    // Un orario non interpretabile escluderebbe il provider per sempre, perché
    // il confronto con una data non valida è sempre falso.
    const dichiarato = ricaricaA ? Date.parse(ricaricaA) : NaN;
    const plausibile =
      Number.isFinite(dichiarato) &&
      dichiarato > Date.now() - 3600000 &&
      dichiarato < Date.now() + 30 * 86400000;
    const riprendi = plausibile
      ? new Date(dichiarato).toISOString()
      : new Date(Date.now() + ore * 3600000).toISOString();
    r.esauriti = {
      ...(r.esauriti ?? {}),
      [provider]: { da: new Date().toISOString(), riprendi },
    };
    return riprendi;
  }
  disponibile(r: any, provider: string) {
    const voce = (r.esauriti ?? {})[provider];
    if (voce?.credito) return false;
    if (voce && Date.now() < new Date(voce.riprendi).getTime()) return false;
    // Un provider a chiave senza chiave nel Portachiavi non si prova: si salta,
    // e «collega» dice come rimediare.
    const profilo = providerNoto(provider);
    if (profilo?.accesso === "chiave" && !this.chiavi.esiste(profilo.id))
      return false;
    // Ollama in sequenza senza Ollama installato: si salta, come una chiave
    // mancante (nelle simulazioni e nei test non conta).
    if (provider === PROVIDER_IBRIDO && r.mode === "live" && !binarioOllama())
      return false;
    return true;
  }
  // Il Portachiavi della cartella dati: sostituibile nei test.
  private _chiavi?: Portachiavi;
  get chiavi(): Portachiavi {
    return (this._chiavi ??= portachiaviDiSistema(this.store.root));
  }
  set chiavi(p: Portachiavi) {
    this._chiavi = p;
  }
  // Il catalogo dei prezzi (models.dev), caricato quando serve: i costi dei
  // provider a consumo si stimano con quello, mai a occhio.
  catalogoModelli?: Catalogo;
  private caricamentoCatalogo?: Promise<void>;
  assicuraCatalogo() {
    this.caricamentoCatalogo ??= caricaCatalogo(this.store.root)
      .then((c) => {
        if (c) this.catalogoModelli = c;
      })
      .catch(() => {});
    return this.caricamentoCatalogo;
  }
  // I servizi con modelli gratuiti (Fase 1, docs/MODELLI_GRATUITI.md): chi è
  // collegato si vede senza leggere le chiavi; i modelli si leggono dal
  // servizio e restano in memoria dieci minuti.
  serviziGratuiti() {
    return PROVIDER_REGISTRO.filter((p) => p.gratis && p.diretto).map((p) => ({
      id: p.id,
      nome: p.nome,
      locale: p.accesso === "locale",
      collegato:
        p.accesso === "locale"
          ? collegati(this.store.root).includes(p.id)
          : this.chiavi.esiste(p.id),
      lavoraSuiFile: p.motore !== "diretto",
      dati: p.dati,
      nota: p.nota,
      console: p.console,
    }));
  }
  // Le chiamate ai servizi gratuiti: sostituibili nei test, che non vanno in rete.
  scaricaGratuiti: typeof fetch = (...a) => fetch(...a);
  // Il ponte (Fase 4): i servizi gratuiti lavorano sui file attraverso Codex.
  // Si avvia al primo turno di un gratuito e usa le chiavi del Portachiavi.
  private ponte?: Ponte;
  private registraPonte(e: EsitoPonte) {
    if (e.stato === 200 && e.modello && !e.dettaglio) this.ricordaModelloBuono(e.servizio, e.modello);
    try {
      const file = join(this.store.root, "ponte", "registro.log");
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
      try {
        if (statSync(file).size > 1_000_000) renameSync(file, file + ".1");
      } catch {}
      // Ultima rete: le chiavi lette in questo processo non entrano nel registro.
      appendFileSync(file, redact(JSON.stringify({ quando: new Date().toISOString(), ...e })) + "\n", { mode: 0o600 });
    } catch {}
  }
  async assicuraPonte(): Promise<Ponte> {
    if (!this.ponte)
      this.ponte = new Ponte({
        chiave: (id) => this.chiavi.leggi(id),
        scarica: (...a) => this.scaricaGratuiti(...a),
        // Se il modello scelto non c'è per l'account, il ponte prova i
        // seguenti, nell'ordine consigliato, e quello scartato non si
        // sceglie più (28 ottobre: NVIDIA, 404 «Not found for account»).
        candidati: (id) => {
          const p = providerNoto(id);
          const tenuti = this.modelliGratisInMemoria.get(id)?.elenco.map((m) => m.id) ?? [];
          return p ? inOrdine(p, tenuti) : tenuti;
        },
        // Il limite al minuto: lo si dice nelle sessioni in cui quel
        // servizio sta lavorando.
        attesa: (id, secondi) => {
          for (const runId of this.children.keys())
            if (this.run(runId).agent === id)
              this.event(this.run(runId), "provider.waiting", `${nomeServizio(providerNoto(id)!)}: limite al minuto del piano gratuito, aspetto ${secondi} s e riprovo`);
        },
        // Un registro locale delle richieste del ponte: numeri e stati, mai
        // chiavi né testi (cartella dati, ponte/registro.log).
        registra: (e) => this.registraPonte(e),
        scarta: (id, modello) => this.scartaModello(id, modello),
      });
    await this.ponte.avvia();
    return this.ponte;
  }
  private modelliGratisInMemoria = new Map<string, { quando: number; elenco: ModelloGratuito[] }>();
  // I modelli che un servizio ha detto di non avere per questo account.
  private modelliScartati = new Map<string, Set<string>>();
  // L'ultimo modello di un servizio che ha risposto davvero: si prova per
  // primo nei passi che fanno una domanda diretta (28 ottobre: NVIDIA aveva
  // lavorato sui file con un modello e il controllo dopo ne sceglieva un altro
  // che non rispondeva).
  private modelloBuono = new Map<string, string>();
  // Modelli buoni e scartati restano su disco: al riavvio del servizio (o
  // dopo un aggiornamento) non si ricomincia dai modelli che non rispondono.
  private memoriaModelliLetta = false;
  private leggiMemoriaModelli() {
    if (this.memoriaModelliLetta) return;
    this.memoriaModelliLetta = true;
    try {
      const m = JSON.parse(readFileSync(join(this.store.root, "ponte", "modelli.json"), "utf8"));
      for (const [k, v] of Object.entries(m.buoni ?? {})) if (typeof v === "string") this.modelloBuono.set(k, v);
      for (const [k, v] of Object.entries(m.scartati ?? {})) if (Array.isArray(v)) this.modelliScartati.set(k, new Set(v.map(String)));
    } catch {}
  }
  private salvaMemoriaModelli() {
    try {
      mkdirSync(join(this.store.root, "ponte"), { recursive: true, mode: 0o700 });
      writeFileSync(
        join(this.store.root, "ponte", "modelli.json"),
        JSON.stringify({ buoni: Object.fromEntries(this.modelloBuono), scartati: Object.fromEntries([...this.modelliScartati].map(([k, v]) => [k, [...v]])) }, null, 2) + "\n",
        { mode: 0o600 },
      );
    } catch {}
  }
  private ricordaModelloBuono(servizio: string, modello: string) {
    this.leggiMemoriaModelli();
    if (this.modelloBuono.get(servizio) === modello) return;
    this.modelloBuono.set(servizio, modello);
    this.salvaMemoriaModelli();
  }
  private scartaModello(servizio: string, modello: string) {
    this.leggiMemoriaModelli();
    this.modelliScartati.set(servizio, new Set([...(this.modelliScartati.get(servizio) ?? []), modello]));
    const tenuti = this.modelliGratisInMemoria.get(servizio);
    if (tenuti) tenuti.elenco = tenuti.elenco.filter((m) => m.id !== modello);
    if (this.modelloBuono.get(servizio) === modello) this.modelloBuono.delete(servizio);
    this.salvaMemoriaModelli();
  }
  async modelliGratuitiDi(id: string, aggiorna = false) {
    const p = providerNoto(id);
    if (!p?.gratis || !p.diretto) throw Error(`${id} non ha modelli gratuiti`);
    const tenuti = this.modelliGratisInMemoria.get(p.id);
    if (!aggiorna && tenuti && Date.now() - tenuti.quando < 600_000) return tenuti.elenco;
    // Il catalogo (5 MB da models.dev) serve solo a chi decide i gratuiti dal
    // prezzo; per Groq, Google e gli altri «tutti» rallentava ogni risposta.
    if (p.gratis === "prezzo-zero") await this.assicuraCatalogo();
    const chiave = p.accesso === "chiave" ? this.chiavi.leggi(p.id) : undefined;
    if (p.accesso === "chiave" && !chiave && !p.prova?.pubblica && p.id !== "openrouter")
      throw Error(`Collega prima ${p.id}: /collega ${p.id}`);
    this.leggiMemoriaModelli();
    const scartati = this.modelliScartati.get(p.id);
    const elenco = (await modelliGratuiti(p, chiave, this.catalogoModelli, this.scaricaGratuiti)).filter((m) => !scartati?.has(m.id));
    this.modelliGratisInMemoria.set(p.id, { quando: Date.now(), elenco });
    return elenco;
  }
  // Una domanda di prova a un modello gratuito: dice se la chiave funziona e
  // quanto è veloce, senza toccare progetti né sessioni.
  async provaGratuito(id: string, modello: string, domanda: string) {
    const p = providerNoto(id);
    if (!p?.diretto) throw Error(`${id} non si chiama direttamente`);
    const chiave = p.accesso === "chiave" ? this.chiavi.leggi(p.id) : undefined;
    if (p.accesso === "chiave" && !chiave) throw Error(`Collega prima ${p.id}: /collega ${p.id}`);
    const inizio = Date.now();
    const risposta = await chiediModello({
      provider: p,
      chiave,
      modello,
      messaggi: [
        { role: "system", content: `${istruzioneLingua(leggiLingua(this.store.root))} Be brief and precise.` },
        { role: "user", content: domanda },
      ],
      massimo: 800,
      segnale: AbortSignal.timeout(120_000),
    }, this.scaricaGratuiti);
    return { risposta, millisecondi: Date.now() - inizio, modello, provider: p.id };
  }
  // Dopo «collega»: il credito ricaricato rimette il provider in gioco in
  // tutte le sessioni.
  sbloccaCredito(provider: string) {
    for (const elenco of this.store.list()) {
      if (!elenco.esauriti?.[provider]?.credito) continue;
      const r = this.run(elenco.id);
      const { [provider]: _, ...resto } = r.esauriti;
      r.esauriti = resto;
      this.event(
        r,
        "provider.reconnected",
        `${provider} ricollegato: torna disponibile`,
      );
    }
  }
  prossimaRicarica(r: any) {
    return Object.values(r.esauriti ?? {})
      .filter((v: any) => !v.credito)
      .map((v: any) => new Date(v.riprendi).getTime())
      .filter((t) => t > Date.now())
      .sort((a, b) => a - b)[0];
  }
  // La sequenza è una preferenza, non una scelta irreversibile: si cambia durante
  // la sessione e vale dal turno successivo, senza interrompere chi sta lavorando.
  // Google vieta per iscritto, nominando strumenti terzi, l'accesso ad
  // Antigravity con software non suo, e ha sospeso account in modo permanente.
  // La sua stessa documentazione indica la chiave API come strada consentita:
  // finché non la sosteniamo, questa gamba resta chiusa.
  static readonly ANTIGRAVITY_VIETATO =
    "Antigravity non è disponibile: i termini di Google vietano di accedervi con software di terzi e gli account vengono sospesi. La loro documentazione indica come strada consentita una chiave API (Gemini API o Gemini Enterprise), che Continuity non sostiene ancora.";
  // Un elenco è la sequenza esatta (come prima); un testo segue le regole
  // brevi di «/ordine» (nuovaSequenza): «claude» la mette in testa e basta.
  impostaSequenza(id: string, sequenza: string[] | string) {
    const r = this.run(id);
    if (!r.session) throw Error("La run non è una sessione");
    const testo = Array.isArray(sequenza)
      ? "solo " + sequenza.join(", ")
      : sequenza;
    if (/\bantigravity\b/i.test(testo)) throw Error(Engine.ANTIGRAVITY_VIETATO);
    const attuale = (r.providers ?? [r.agent]).filter((p: string) =>
      providerNoto(p),
    );
    const puliti = nuovaSequenza(attuale, testo);
    // Nominare un provider rimasto senza credito vuol dire «l'ho ricaricato».
    for (const nome of testo.replace(/^solo\b/i, "").split(/[\s,→>]+/)) {
      const id = providerNoto(nome)?.id;
      if (id && r.esauriti?.[id]?.credito) {
        const { [id]: _, ...resto } = r.esauriti;
        r.esauriti = resto;
      }
    }
    r.providers = puliti;
    this.event(
      r,
      "sequence.changed",
      `Sequenza aggiornata: ${puliti.join(" → ")}`,
    );
    return this.run(id);
  }
  // Il turno finisce quando il numero avanza e la run torna in pausa: senza
  // aspettarlo si consegnerebbe il lavoro a metà.
  // Nessuna scadenza: allo scadere la consegna falliva perché l'AI stava ancora
  // scrivendo, e il lavoro andava perso lo stesso.
  async attendiFineTurno(
    id: string,
    turnoPrima: number,
    limiteMs = Number.POSITIVE_INFINITY,
  ) {
    const scadenza = Date.now() + limiteMs;
    for (;;) {
      const r = this.run(id);
      const finito =
        (r.turnNumber ?? 0) > turnoPrima &&
        ["PAUSED", "BLOCKED", "SUCCEEDED", "FAILED", "CANCELLED"].includes(
          r.state,
        );
      if (finito || Date.now() > scadenza) return r;
      await new Promise((risolvi) => setTimeout(risolvi, 1000));
    }
  }
  // Il modello si sceglie per provider e vale dal turno successivo: cambiarlo a
  // metà lavoro interromperebbe chi sta scrivendo.
  // Un modello che il piano dell'utente non ha non va riproposto come se fosse
  // disponibile: lo si ricorda, per questa macchina.
  get schedarioModelli() {
    return join(this.store.root, "modelli-non-disponibili.json");
  }
  // I modelli fra cui scegliere: il catalogo ufficiale di Codex (tenuto un'ora)
  // e l'elenco di Claude, con gli alias dell'ultima versione in cima.
  private catalogo?: { quando: number; codex?: ModelloNoto[] };
  modelliDisponibili(): Record<string, ModelloNoto[]> {
    if (!this.catalogo || Date.now() - this.catalogo.quando > 3_600_000) {
      let codex: ModelloNoto[] | undefined;
      try {
        codex = catalogoCodex(resolveProvider("codex", this.store.root).path);
      } catch {}
      this.catalogo = { quando: Date.now(), codex };
    }
    const elenco: Record<string, ModelloNoto[]> = {
      codex: this.catalogo.codex ?? MODELLI_CODEX,
      claude: MODELLI_CLAUDE,
    };
    // Gli altri dal catalogo models.dev, i gratuiti in cima. I server locali
    // non hanno elenco: vale qualunque modello scaricato sul Mac.
    for (const p of PROVIDER_REGISTRO) {
      if (p.accesso === "abbonamento" || !p.catalogo || p.motore === "diretto") continue;
      const modelli = Object.values(this.catalogoModelli?.[p.catalogo] ?? {});
      if (!modelli.length) continue;
      elenco[p.id] = modelli
        .sort((a, b) => Number(b.gratuito) - Number(a.gratuito))
        .map((m) => ({
          nome: m.id,
          descrizione: m.gratuito
            ? `${m.nome} · gratuito`
            : m.prezzi
              ? `${m.nome} · ${m.prezzi.input} $ / ${m.prezzi.output} $ per milione di token`
              : m.nome,
        }));
    }
    return elenco;
  }
  modelliNonDisponibili(): Record<string, string[]> {
    try {
      return JSON.parse(readFileSync(this.schedarioModelli, "utf8"));
    } catch {
      return {};
    }
  }
  segnaModelloNonDisponibile(provider: string, modello: string) {
    if (!provider || !modello) return;
    const schedario = this.modelliNonDisponibili();
    schedario[provider] = [
      ...new Set([...(schedario[provider] ?? []), modello]),
    ];
    try {
      writeFileSync(this.schedarioModelli, JSON.stringify(schedario, null, 2));
    } catch {}
  }
  impostaModello(
    id: string,
    provider: string,
    modello: string,
    forzato = false,
  ) {
    const r = this.run(id);
    if (!r.session) throw Error("La run non è una sessione");
    if (!providerNoto(provider) && provider !== "antigravity")
      throw Error("AI non supportata: " + provider);
    provider = providerNoto(provider)?.id ?? provider;
    const pulito = modello.trim();
    // Un modello di un'altra AI è un errore che il provider scoprirebbe solo a
    // turno avviato, dopo aver fatto attendere: si ferma qui.
    const noti =
      this.modelliDisponibili()[provider]?.map((m) => m.nome) ??
      MODELLI_NOTI[provider] ??
      [];
    if (pulito && noti.length && !noti.includes(pulito) && !forzato)
      throw Error(
        `${provider} non ha un modello «${pulito}». Disponibili: ${noti.slice(0, 12).join(", ")}${noti.length > 12 ? ` e altri ${noti.length - 12} (elenco completo con «/modello»)` : ""}`,
      );
    // Un nome forzato finisce fra gli argomenti del CLI: un «-…» o uno
    // spazio lo trasformerebbero in un'opzione.
    if (pulito && !/^[A-Za-z0-9][\w.:\[\]\/-]{0,119}$/.test(pulito))
      throw Error("Nome di modello non valido: " + pulito);
    r.modelli = { ...(r.modelli ?? {}) };
    if (pulito) r.modelli[provider] = pulito;
    else delete r.modelli[provider];
    this.event(
      r,
      "model.changed",
      pulito
        ? `Modello di ${provider}: ${pulito}`
        : `${provider} torna al modello predefinito`,
    );
    return this.run(id);
  }
  // Un allegato entra nella copia di lavoro, non resta un percorso sul disco
  // dell'utente: così l'AI può leggerlo davvero senza uscire dalla cartella.
  allega(id: string, percorso: string) {
    const r = this.run(id);
    if (!r.session) throw Error("La run non è una sessione");
    const origine = resolve(percorso.replace(/^~/, homedir()));
    if (!existsSync(origine) || !lstatSync(origine).isFile())
      throw Error("File non trovato: " + origine);
    const sensibile = percorsoSensibile(origine);
    if (sensibile)
      throw Error(
        `Non allego ${basename(origine)}: sembra un file di credenziali (${sensibile}). ` +
          "Finirebbe a disposizione dell'AI. Se ti serve un dato preciso, scrivilo nella richiesta togliendo chiavi e password.",
      );
    const dimensione = lstatSync(origine).size;
    if (dimensione > 20 * 1024 * 1024)
      throw Error("File troppo grande (oltre 20 MB): " + basename(origine));
    const cartella = join(r.work, "allegati");
    mkdirSync(cartella, { recursive: true });
    // Due file con lo stesso nome da cartelle diverse non devono
    // sovrascriversi: il secondo prende un suffisso.
    const originale = basename(origine);
    let nome = originale;
    const contenuto = readFileSync(origine);
    for (
      let n = 2;
      existsSync(join(cartella, nome)) &&
      !readFileSync(join(cartella, nome)).equals(contenuto);
      n++
    ) {
      const punto = originale.lastIndexOf(".");
      nome =
        punto > 0
          ? `${originale.slice(0, punto)}-${n}${originale.slice(punto)}`
          : `${originale}-${n}`;
    }
    copyFileSync(origine, join(cartella, nome));
    r.allegati = [...new Set([...(r.allegati ?? []), nome])];
    this.event(r, "attachment.added", `Allegato: ${nome}`);
    return this.run(id);
  }
  // Un compito dell'AI ibrida: il modello locale risponde, senza toccare i
  // file e senza turno. Parte in sottofondo; il testo in arrivo si legge da
  // /live, la fine è l'evento «local.message» (o «local.failed»).
  // I compiti locali in corso, con il modo di fermarli (doppio esc, uscita,
  // spegnimento del servizio): prima non si potevano fermare (CT-2.0-001).
  locali = new Map<string, AbortController>();
  fermaCompitoLocale(id: string) {
    const c = this.locali.get(id);
    if (!c) return false;
    c.abort();
    return true;
  }
  // Chi risponde ai messaggi quando la persona sceglie un modello che non
  // lavora sui file (Groq, Gemini, Zen…, con /ai): resta finché non ne sceglie
  // un'altra. Prima /gratuiti faceva una sola domanda di prova, e il messaggio
  // dopo tornava a Codex (prova di Lorenzo del 25 ottobre).
  async impostaRisponde(id: string, provider: string | null, modello?: string) {
    const r = this.run(id);
    if (!r.session) throw Error("La run non è una sessione");
    if (!provider) {
      if (r.risponde) {
        r.risponde = undefined;
        this.event(r, "responder.changed", `Da ora rispondono le AI della sequenza (${(r.providers ?? []).join(" → ")})`);
      }
      return this.run(id);
    }
    const p = providerNoto(provider);
    if (!p?.diretto || p.motore !== "diretto") throw Error(`${provider} lavora sui file: sceglilo con /ordine`);
    if (p.accesso === "chiave" && !this.chiavi.esiste(p.id)) throw Error(`Collega prima ${p.nome}: /collega ${p.id}`);
    // Si sceglie solo un modello che risponde davvero: una domanda minima
    // («ok») al consigliato, e se è sovraccarico o muto al successivo. Prima
    // si sceglieva a occhio e Google, sovraccarico, non rispondeva mai (25
    // ottobre). Con un modello indicato dalla persona si prova solo quello.
    const elenco = modello ? [modello] : inOrdine(p, (await this.modelliGratuitiDi(p.id)).map((m) => m.id));
    if (!elenco.length) throw Error(`${p.nome}: nessun modello gratuito in questo momento`);
    const chiave = p.accesso === "chiave" ? this.chiavi.leggi(p.id) : undefined;
    let esito: { modello: string; saltati: string[] };
    try {
      esito = await primoCheFunziona(p, chiave, elenco, this.scaricaGratuiti);
    } catch (e) {
      throw Error(
        `${nomeServizio(p)} non risponde in questo momento (${e instanceof Error ? e.message : String(e)}). Riprova più tardi o scegli un altro servizio con /ai.`,
      );
    }
    const r2 = this.run(id);
    r2.risponde = { provider: p.id, modello: esito.modello };
    this.event(
      r2,
      "responder.changed",
      `Da ora risponde ${nomeServizio(p)} · ${esito.modello} (risponde soltanto: non modifica i file)` +
        (esito.saltati.length ? ` · ${esito.saltati.join(", ")} non rispondevano` : ""),
    );
    return this.run(id);
  }
  // Libera la memoria del modello locale quando nessuno lo sta usando: niente
  // risposta locale in corso e nessun turno di Ollama al lavoro.
  async liberaModelloLocale(): Promise<boolean> {
    if (this.locali.size) return false;
    for (const id of this.children.keys())
      if (this.store.get(id)?.agent === PROVIDER_IBRIDO) return false;
    return liberaModello(leggiIbrida(this.store.root).modello);
  }
  // Una sessione la cui copia di lavoro non funziona più: il repository Git
  // del progetto è sparito o spostato (cartella svuotata, 26 ottobre). Prima
  // si andava avanti con un avviso a ogni turno, l'AI non vedeva i file e il
  // revisore taceva.
  copiaInutilizzabile(r: any): string | undefined {
    if (!r?.project || !r.work) return undefined;
    if (!existsSync(r.project.root)) return `la cartella ${r.project.root} non esiste più`;
    if (!existsSync(r.work)) return "la copia di lavoro non esiste più";
    if (r.project.senzaGit) return undefined;
    try {
      const puntatore = readFileSync(join(r.work, ".git"), "utf8");
      const gitdir = /^gitdir:\s*(.+)$/m.exec(puntatore)?.[1]?.trim();
      if (gitdir && !existsSync(gitdir))
        return `il repository Git di ${r.project.root} non c'è più (cartella svuotata o spostata)`;
    } catch {}
    return undefined;
  }
  // Il revisore (Fase 2, CONTINUITY_2.0.md §5.16): legge le modifiche e
  // suggerisce, senza toccare i file. Configurazione per sessione.
  configRevisore(r: any): ConfigRevisore {
    return normalizzaRevisore(r.revisore);
  }
  // I controlli sempre attivi (Fase 3, passo 4): il revisore è il primo; gli
  // altri hanno il loro nome, le istruzioni, il servizio e il momento. Il
  // consenso sui dati è uno per progetto e servizio, per tutti.
  controlli(r: any): { chiave: string; nome: string; config: ConfigRevisore }[] {
    const principale = this.configRevisore(r);
    return [
      { chiave: "revisore", nome: "Revisore", config: principale },
      ...(r.controlli ?? []).map((c: any) => ({
        chiave: String(c.id),
        nome: String(c.nome),
        config: { ...normalizzaRevisore(c), consensi: principale.consensi },
      })),
    ];
  }
  aggiungiControllo(id: string, nome: string, istruzioni: string) {
    const r = this.run(id);
    if (!r.session) throw Error("La run non è una sessione");
    const presenti: any[] = r.controlli ?? [];
    if (presenti.length >= 6) throw Error("Al massimo 6 controlli oltre al revisore");
    const nuovo = {
      ...revisorePredefinito(),
      id: idDaNome(nome, ["revisore", ...presenti.map((c) => c.id)]),
      nome: nome.trim().slice(0, 40),
      istruzioni: istruzioni.trim().slice(0, 4000),
      quando: "fine" as const,
    };
    if (!nuovo.nome || !nuovo.istruzioni) throw Error("Servono un nome e le istruzioni");
    delete (nuovo as any).consensi;
    r.controlli = [...presenti, nuovo];
    this.event(r, "review.settings", `Controllo «${nuovo.nome}» aggiunto (spento): accendilo in /revisore`);
    return this.run(id);
  }
  impostaRevisore(id: string, modifiche: Partial<ConfigRevisore> & { togli?: boolean }, chiave = "revisore") {
    const r = this.run(id);
    if (!r.session) throw Error("La run non è una sessione");
    const { togli, ...resto } = modifiche;
    modifiche = resto;
    const controllo = chiave === "revisore" ? undefined : (r.controlli ?? []).find((c: any) => c.id === chiave);
    if (chiave !== "revisore" && !controllo) throw Error("Controllo non trovato");
    if (togli) {
      if (!controllo) throw Error("Il revisore non si toglie: si spegne");
      r.controlli = (r.controlli ?? []).filter((c: any) => c.id !== chiave);
      // La sua revisione in corso si ferma: un controllo tolto non porta più
      // suggerimenti (collaudo del 26 ottobre, CT-2.0-301).
      this.revisioniInCorso.get(`${id}#${chiave}`)?.controllo.abort();
      this.event(r, "review.settings", `Controllo «${controllo.nome}» tolto`);
      return this.run(id);
    }
    // Il consenso sui dati vale per il progetto, per tutti i controlli.
    if (controllo && modifiche.consensi) {
      r.revisore = { ...this.configRevisore(r), consensi: modifiche.consensi };
      delete modifiche.consensi;
    }
    const prima = controllo ? this.controlli(r).find((c) => c.chiave === chiave)!.config : this.configRevisore(r);
    if (modifiche.ogniTurni !== undefined && !(Number.isInteger(modifiche.ogniTurni) && modifiche.ogniTurni >= 1 && modifiche.ogniTurni <= TURNI_MASSIMI))
      throw Error(`Ogni quanti turni: da 1 a ${TURNI_MASSIMI}`);
    const dopo: ConfigRevisore = normalizzaRevisore({ ...prima, ...modifiche });
    if (dopo.provider) {
      const p = providerNoto(dopo.provider);
      if (!p) throw Error(`Non conosco «${dopo.provider}»`);
      dopo.provider = p.id;
    }
    dopo.corregge = Boolean(dopo.corregge);
    if (controllo) {
      const { consensi: _c, ...salvato } = dopo;
      r.controlli = (r.controlli ?? []).map((c: any) => (c.id === chiave ? { ...c, ...salvato } : c));
    } else r.revisore = dopo;
    const chi = sceltaRevisore(dopo, (x) => this.chiavi.esiste(x));
    const chiè = controllo ? `Controllo «${controllo.nome}»` : "Revisore";
    this.event(
      r,
      "review.settings",
      dopo.attivo
        ? `${chiè} acceso: ${chi ? nomeServizio(chi) : "nessun servizio gratuito collegato"} · ${descriviOgniTurni(dopo.ogniTurni)}`
        : `${chiè} spento`,
    );
    return this.run(id);
  }
  // Il flusso attivo della sessione (Fase 3): resta finché la persona non lo
  // cambia; «diretto» è Continuity com'era prima dei flussi.
  flussoAttivo(r: any) {
    const { flussi } = leggiFlussi(this.store.root);
    return flussi.find((f) => f.id === r.flusso) ?? flussi.find((f) => f.id === FLUSSO_PREDEFINITO)!;
  }
  impostaFlusso(id: string, flusso: string) {
    const r = this.run(id);
    if (!r.session) throw Error("La run non è una sessione");
    const scelto = leggiFlussi(this.store.root).flussi.find((f) => f.id === flusso);
    if (!scelto) throw Error(`Non conosco il flusso «${flusso}»: /flusso e scegli dall'elenco`);
    if (r.flusso !== scelto.id) {
      r.flusso = scelto.id;
      r.flussoNome = scelto.nome;
      this.event(r, "flow.changed", `Flusso attivo: ${scelto.nome}`);
    }
    return this.run(id);
  }
  // ---- L'esecuzione dei flussi (Fase 3, passo 2) ----
  // La catena di passi: ognuno è un turno vero (chi scrive, o chi legge con
  // Codex, Claude o Qwen in sola lettura) oppure una domanda a un modello
  // gratuito (chi legge). Chi rivede può rimandare il lavoro a chi scrive
  // fino a «giri» volte; il piano aspetta il sì della persona.
  // Una sessione bloccata da un guasto (servizio caduto a metà turno), senza
  // processi di questo servizio: si ferma il processo rimasto, se c'è, e la
  // sessione torna utilizzabile. Lo stesso recupero dei turni normali, anche
  // per i flussi (ricollaudo del 27–28 ottobre, CT-2.0-401).
  async recuperaBloccata(id: string) {
    const r = this.run(id);
    if (r.state !== "BLOCKED" || this.children.has(id)) return;
    await this.assicuraNessunWriter(r);
    const r2 = this.run(id);
    r2.state = "PAUSED";
    r2.error = undefined;
    this.event(r2, "recovery.completed", "Sessione recuperata dopo un guasto: il lavoro nella copia è intatto");
  }
  async avviaFlusso(id: string, flusso: Flusso, ruoli: Ruolo[], richiesta: string) {
    await this.recuperaBloccata(id);
    const r = this.run(id);
    if (!r.session) throw Error("La run non è una sessione");
    if (r.esecuzione) throw Error("Un flusso è già in corso");
    if (!["READY", "PAUSED"].includes(r.state)) throw Error("Un'AI sta lavorando: il messaggio parte a fine turno");
    const guasto = this.copiaInutilizzabile(r);
    if (guasto)
      throw Error(`Questa sessione non può continuare: ${guasto}. Esci (/esci) e riapri Continuity nella cartella: si apre una sessione nuova.`);
    const usati = new Set(flusso.passi.map((p) => p.ruolo));
    r.esecuzione = {
      flusso: JSON.parse(JSON.stringify(flusso)),
      ruoli: JSON.parse(JSON.stringify(ruoli.filter((x) => usati.has(x.id)))),
      richiesta,
      passo: 0,
      giro: 0,
      uscite: [],
    } satisfies Esecuzione;
    this.event(r, "user.request", richiesta);
    this.remember(r, "utente", richiesta);
    this.event(r, "flow.started", `Flusso «${flusso.nome}»: ${descriviFlusso(flusso, ruoli)}`);
    setImmediate(() => void this.eseguiPasso(id));
    return this.run(id);
  }
  // All'avvio del servizio: un flusso rimasto a metà senza niente che lo
  // porti avanti (servizio spento o caduto durante un passo) si chiude e lo si
  // dice. Restano quelli che aspettano il sì sul piano o i crediti: ripartono
  // da soli o con la risposta della persona (CT-2.0-303).
  riconciliaFlussi() {
    const chiusi: string[] = [];
    for (const salvata of this.store.list()) {
      const e = (salvata as any).esecuzione;
      if (!salvata.session || !e || e.attesa || (salvata as any).inAttesa) continue;
      if (this.children.has(salvata.id) || this.passiDiretti.has(salvata.id) || this.busy.has(salvata.id)) continue;
      if (["RUNNING", "STARTING", "QUIESCING"].includes(salvata.state)) continue;
      try {
        this.chiudiFlusso(salvata.id, "fermato", "il servizio si è fermato a metà flusso: il lavoro fatto resta nella copia; riscrivi il messaggio per ripartire");
        chiusi.push(salvata.id);
      } catch {}
      // Il processo dell'AI rimasto vivo dal servizio caduto si ferma subito,
      // non al prossimo messaggio: niente scrive più nella copia (CT-2.0-401).
      void this.recuperaBloccata(salvata.id).catch((e) => {
        try {
          this.event(this.run(salvata.id), "engine.warning", e instanceof Error ? e.message : String(e));
        } catch {}
      });
    }
    return chiusi;
  }
  // Il turno di un passo: separato perché le prove possano sostituirlo.
  async avviaPassoTurno(id: string, testo: string, opzioni: { provider?: string; soloLettura: boolean }) {
    await this.turn(id, testo, { provider: opzioni.provider, passoFlusso: { soloLettura: opzioni.soloLettura } });
  }
  private passoCorrente(r: any) {
    const e: Esecuzione | undefined = r.esecuzione;
    if (!e) return undefined;
    const passo = e.flusso.passi[e.passo];
    const ruolo = passo && e.ruoli.find((x) => x.id === passo.ruolo);
    return passo && ruolo ? { e, passo, ruolo } : undefined;
  }
  // La lingua delle risposte: quella in cui la persona scrive (gli ultimi
  // suoi messaggi), altrimenti quella scelta con /language.
  linguaPer(r?: any, altri: string[] = []): Lingua {
    const suoi = ((r?.transcript ?? []) as any[]).filter((t) => t.role === "utente").slice(-5).map((t) => String(t.text ?? ""));
    return linguaScritta([...suoi, ...altri, ...(r?.request ? [String(r.request)] : [])]) ?? leggiLingua(this.store.root);
  }
  // L'AI che prende un passo quando quella scelta non risponde: la prima della
  // sequenza che non è quella e non è senza quota.
  private altraAIPerIlPasso(r: any, tranne: string): string | undefined {
    return ((r.providers ?? [r.agent]) as string[]).find((x) => x !== tranne && providerNoto(x) && !r.esauriti?.[x]);
  }
  // Chi legge con un modello che risponde soltanto: «gratuito» o un servizio diretto.
  private passoDiretto(ai: string) {
    if (ai === "gratuito") return true;
    const p = providerNoto(ai);
    return Boolean(p && p.motore === "diretto");
  }
  async eseguiPasso(id: string) {
    let r = this.run(id);
    const corrente = this.passoCorrente(r);
    if (!r.esecuzione) return;
    if (!corrente) return this.chiudiFlusso(id, "completato");
    const { e, passo, ruolo } = corrente;
    const correzione = e.correzioni && ruolo.tipo === "scrive";
    e.seqPasso = (r.version ?? 0) + 1;
    this.event(
      r,
      "flow.step",
      `Passo ${e.passo + 1} di ${e.flusso.passi.length} · ${ruolo.nome} · ${nomeAIPasso(passo.ai)}` +
        (correzione ? ` · correzione, giro ${e.giro} di ${e.flusso.giri}` : ""),
    );
    // Chi controlla da solo, senza nessuno che lavori nel flusso («@google fai
    // una revisione del lavoro fatto»), deve poter leggere i file: un turno
    // vero in sola lettura. La domanda diretta vede solo le modifiche non
    // ancora consegnate, e il 28 ottobre erano zero.
    const daSolo = !e.flusso.passi.some((x) => e.ruoli.find((y) => y.id === x.ruolo)?.tipo === "scrive");
    if (ruolo.tipo === "legge" && this.passoDiretto(passo.ai) && !daSolo) return this.passoGratuito(id);
    // «Un gratuito» che lavora sui file: il primo collegato, attraverso il
    // ponte (Fase 4).
    const chi =
      passo.ai === "gratuito" ? PREFERITI_REVISORE.find((x) => this.chiavi.esiste(x)) : passo.ai === "sequenza" ? undefined : passo.ai;
    if (passo.ai === "gratuito" && !chi)
      return this.chiudiFlusso(id, "fermato", `${ruolo.nome}: nessun servizio gratuito collegato. Collegane uno con /collega groq (o google), oppure scegli un'altra AI per questo passo in /flusso`);
    try {
      await this.avviaPassoTurno(id, promptPasso(e), {
        provider: chi,
        soloLettura: ruolo.tipo === "legge",
      });
    } catch (err) {
      r = this.run(id);
      r.passoSoloLettura = false;
      this.chiudiFlusso(id, "fermato", `${ruolo.nome} non è partito: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  async dopoTurnoDiFlusso(id: string, fallito: boolean, nota?: string) {
    const r = this.run(id);
    const corrente = this.passoCorrente(r);
    if (!corrente) return;
    if (fallito)
      return this.chiudiFlusso(id, "fermato", `${corrente.ruolo.nome} non è riuscito (${(nota ?? "turno interrotto").slice(0, 200)}): il lavoro fatto finora resta nella copia`);
    // Ciò che l'AI ha detto in questo passo: l'ultimo messaggio.
    const messaggi = this.store
      .events(id, (corrente.e.seqPasso ?? 1) - 1)
      .filter((x: any) => x.type === "agent.message" || x.type === "agent.reported");
    const testo = String(messaggi.at(-1)?.payload?.message ?? "");
    this.esitoPasso(id, testo, nomeAIPasso(r.agent));
  }
  // Una domanda a un modello gratuito per un passo che legge.
  private passoGratuito(id: string) {
    const r = this.run(id);
    const { e, passo, ruolo } = this.passoCorrente(r)!;
    const config = this.configRevisore(r);
    const p =
      passo.ai === "gratuito"
        ? // Il primo collegato che non aspetta un sì, poi quelli già consentiti.
          PREFERITI_REVISORE.map((x) => providerNoto(x)!).find(
            (x) => x && this.chiavi.esiste(x.id) && !serveConsenso(x, config),
          ) ?? sceltaRevisore({ ...config, provider: undefined }, (x) => this.chiavi.esiste(x))
        : providerNoto(passo.ai);
    if (!p || !this.chiavi.esiste(p.id))
      return this.chiudiFlusso(
        id,
        "fermato",
        `${ruolo.nome}: ${p ? `${nomeServizio(p)} non è collegato` : "nessun servizio gratuito collegato"}. Collegane uno con /collega groq (o google), oppure scegli un'altra AI per questo passo in /flusso`,
      );
    if (serveConsenso(p, config)) {
      this.event(r, "flow.consent_needed", `${nomeServizio(p)} riceverebbe il codice cambiato: ${p.dati ?? ""}`, nomeServizio(p));
      return this.chiudiFlusso(id, "fermato", `Serve il tuo sì perché ${nomeServizio(p)} riceva il codice: sceglilo di nuovo per quel passo in /flusso (o chiamalo con @) e rispondi «Sì», poi rimanda il messaggio`);
    }
    const caratteri = caratteriPer(p);
    let foto: Differenze;
    try {
      foto = differenze(r.work, caratteri);
    } catch (err) {
      return this.chiudiFlusso(id, "fermato", `${ruolo.nome} non può leggere le modifiche: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (ruolo.esito === "suggerimenti" && !foto.testo.trim()) {
      this.event(r, "flow.review", "Niente da rivedere: nessuna modifica", nomeServizio(p));
      return this.avanti(id);
    }
    const controllo = new AbortController();
    let finita!: () => void;
    this.passiDiretti.set(id, { controllo, fatta: new Promise<void>((ok) => (finita = ok)) });
    const domanda = (testo: string, file: number, troncato: boolean) =>
      messaggiPasso(e, { modifiche: testo, file, troncato, verifiche: r.checks, lingua: this.linguaPer(r, [e.richiesta]) });
    void (async () => {
      try {
        const chiave = p.accesso === "chiave" ? this.chiavi.leggi(p.id) : undefined;
        let modelli: string[] = [];
        try {
          modelli = (await this.modelliGratuitiDi(p.id)).map((m) => m.id);
        } catch {}
        const esito = await chiediRevisione({
          provider: p,
          chiave,
          modelli: modelli.length ? modelli : passo.modello ? [passo.modello] : [],
          primo: passo.modello ?? (this.leggiMemoriaModelli(), this.modelloBuono.get(p.id)),
          scarta: (m) => this.scartaModello(p.id, m),
          messaggi: domanda(foto.testo, foto.file.length, foto.troncato),
          caratteri,
          segnale: controllo.signal,
          piuCorti: (quanti) => {
            const corta = accorcia(foto.pezzi, quanti);
            return domanda(corta.testo, corta.file.length, true);
          },
          scarica: this.scaricaGratuiti,
        });
        if (controllo.signal.aborted) return;
        this.passiDiretti.delete(id);
        this.ricordaModelloBuono(p.id, esito.modello);
        this.esitoPasso(id, esito.risposta, `${nomeServizio(p)} · ${esito.modello}`);
      } catch (err) {
        if (controllo.signal.aborted) return;
        const motivo = err instanceof Error ? err.message : String(err);
        // Nessun modello del servizio risponde: il passo lo fa l'AI dopo
        // nella sequenza, come quando finisce la quota (28 ottobre: il
        // controllo di NVIDIA fermava tutto il flusso).
        const altra = siPassaAlProssimo(err) || err instanceof ErroreGratuito ? this.altraAIPerIlPasso(r, p.id) : undefined;
        if (altra && (e.ripieghi ?? 0) < 2) {
          e.ripieghi = (e.ripieghi ?? 0) + 1;
          e.flusso = { ...e.flusso, passi: e.flusso.passi.map((x, i) => (i === e.passo ? { ...x, ai: altra } : x)) };
          this.passiDiretti.delete(id);
          this.event(r, "switch.started", `${nomeServizio(p)} non risponde (${motivo.slice(0, 160)}): questo passo lo fa ${nomeAIPasso(altra)}`);
          setImmediate(() => void this.eseguiPasso(id));
          return;
        }
        this.chiudiFlusso(id, "fermato", `${ruolo.nome} (${nomeServizio(p)}): ${motivo}`);
      } finally {
        this.passiDiretti.delete(id);
        finita();
      }
    })();
  }
  // Che cosa fa il flusso con ciò che un passo ha prodotto.
  esitoPasso(id: string, testo: string, da: string) {
    const r = this.run(id);
    const corrente = this.passoCorrente(r);
    if (!corrente) return;
    const { e, ruolo } = corrente;
    switch (ruolo.esito) {
      case "piano": {
        e.piano = testo.trim() || "(il piano è vuoto)";
        e.modificaPiano = undefined;
        // «Approva sempre» per questo flusso: il piano si vede, il lavoro
        // parte senza chiedere (decisione di Lorenzo del 27 ottobre). Vale
        // l'impostazione di adesso, anche se cambiata a flusso avviato.
        const salvato = leggiFlussi(this.store.root).flussi.find((f) => f.id === e.flusso.id);
        if (salvato?.approvaPiano ?? e.flusso.approvaPiano) {
          this.event(r, "flow.plan_ready", e.piano, da);
          this.event(r, "flow.plan_approved", "Piano approvato da solo (Approva sempre · /flusso per tornare a chiedere)");
          return this.avanti(id, r);
        }
        e.attesa = "piano";
        this.event(r, "flow.plan_ready", e.piano, da);
        return;
      }
      case "suggerimenti": {
        const problemi = leggiSuggerimenti(testo);
        this.event(
          r,
          "flow.review",
          problemi.length ? problemi.map((x) => `• ${x}`).join("\n") : "Nessun problema: il lavoro sembra a posto",
          da,
        );
        if (!problemi.length) return this.avanti(id, r);
        const scrive = chiScrivePrima(e, e.passo);
        if (e.giro < e.flusso.giri && scrive >= 0) {
          e.giro++;
          e.correzioni = { da, testo: problemi };
          e.segnalati = [...(e.segnalati ?? []), ...problemi].slice(-24);
          e.ritorno = e.passo;
          e.passo = scrive;
          this.event(
            r,
            "flow.correction",
            `Rimando ${problemi.length === 1 ? "il problema" : `i ${problemi.length} problemi`} a chi scrive · giro ${e.giro} di ${e.flusso.giri}`,
          );
          setImmediate(() => void this.eseguiPasso(id));
          return;
        }
        // Finiti i giri: i problemi restano come suggerimenti per il prossimo
        // messaggio (si possono scartare in /revisore), e lo si dice. Se il
        // flusso ha altri passi, continua (28 ottobre: «@codex fai l'html»
        // dopo la revisione di Groq non partiva mai).
        r.suggerimenti = [
          ...(r.suggerimenti ?? []),
          ...problemi.map((x) => ({
            id: randomUUID().slice(0, 8),
            testo: x,
            da,
            quando: new Date().toISOString(),
            stato: "nuovo" as const,
            motivo: "flusso",
          })),
        ].slice(-40);
        const restano = `${problemi.length === 1 ? "esta 1 problema: lo passo" : `estano ${problemi.length} problemi: li passo`} all'AI con il prossimo messaggio (puoi scartar${problemi.length === 1 ? "lo" : "li"} in /revisore)`;
        if (e.passo + 1 < e.flusso.passi.length) {
          this.event(r, "flow.correction", `${e.flusso.giri ? `Dopo ${e.flusso.giri === 1 ? "1 giro" : `${e.flusso.giri} giri`} di correzione r` : "R"}${restano}; il flusso continua`);
          return this.avanti(id, r);
        }
        return this.chiudiFlusso(
          id,
          "problemi",
          `${e.flusso.giri ? `Dopo ${e.flusso.giri === 1 ? "1 giro" : `${e.flusso.giri} giri`} di correzione r` : "R"}${problemi.length === 1 ? "esta 1 problema: lo passo" : `estano ${problemi.length} problemi: li passo`} all'AI con il prossimo messaggio (puoi scartar${problemi.length === 1 ? "lo" : "li"} in /revisore)`,
          r,
        );
      }
      case "verdetto": {
        e.verdetto = { pronto: leggiVerdetto(testo), da };
        this.event(r, "flow.verdict", testo.trim() || (e.verdetto.pronto ? "PRONTO" : "NON PRONTO"), da);
        return this.avanti(id, r);
      }
      case "testo": {
        if (testo.trim()) e.uscite.push({ ruolo: ruolo.nome, da, testo: testo.trim().slice(0, 6000) });
        this.event(r, "flow.output", testo.trim() || "(nessuna risposta)", da);
        return this.avanti(id, r);
      }
      default:
        return this.avanti(id, r);
    }
  }
  // Al passo dopo; dopo una correzione, di nuovo a chi rivede.
  private avanti(id: string, r = this.run(id)) {
    const e: Esecuzione | undefined = r.esecuzione;
    if (!e) return;
    if (e.correzioni && e.ritorno !== undefined && e.flusso.passi[e.passo] && e.ruoli.find((x) => x.id === e.flusso.passi[e.passo].ruolo)?.tipo === "scrive") {
      e.passo = e.ritorno;
      e.ritorno = undefined;
      e.correzioni = undefined;
    } else {
      // Finita una revisione, il pezzo di lavoro dopo ha i suoi giri.
      if (e.ruoli.find((x) => x.id === e.flusso.passi[e.passo]?.ruolo)?.tipo === "legge") {
        e.giro = 0;
        e.segnalati = undefined;
      }
      e.passo++;
    }
    // Si salva prima di partire: il passo dopo rilegge la sessione.
    this.event(r, "flow.progress", `Avanti: passo ${Math.min(e.passo + 1, e.flusso.passi.length)} di ${e.flusso.passi.length}`);
    setImmediate(() => void this.eseguiPasso(id));
  }
  chiudiFlusso(id: string, come: "completato" | "fermato" | "problemi", nota?: string, r = this.run(id)) {
    const e: Esecuzione | undefined = r.esecuzione;
    if (!e) return;
    r.esecuzione = undefined;
    r.passoSoloLettura = false;
    const verdetto = e.verdetto ? (e.verdetto.pronto ? " · pronto" : " · NON pronto") : "";
    // Con problemi rimasti il flusso è comunque concluso: tutti i passi sono
    // stati fatti, i problemi restano detti (settimo collaudo, CT-2.0-609).
    this.event(
      r,
      come === "fermato" ? "flow.stopped" : "flow.completed",
      come === "completato"
        ? `Flusso «${e.flusso.nome}» concluso${verdetto}${nota ? ` · ${nota}` : ""}`
        : `Flusso «${e.flusso.nome}» ${come === "problemi" ? "concluso con problemi" : "fermato"}: ${nota ?? ""}`,
    );
  }
  // La risposta della persona al piano.
  rispondiPiano(id: string, azione: "approva" | "sempre" | "modifica" | "annulla", testo?: string) {
    const r = this.run(id);
    const e: Esecuzione | undefined = r.esecuzione;
    if (!e || e.attesa !== "piano") throw Error("Nessun piano aspetta una risposta");
    // «Approva sempre»: si salva nel flusso, poi è un'approvazione normale.
    if (azione === "sempre") {
      const config = leggiFlussi(this.store.root);
      const f = config.flussi.find((x) => x.id === e.flusso.id);
      if (f) {
        f.approvaPiano = true;
        salvaFlussi(this.store.root, config);
      }
      e.flusso.approvaPiano = true;
      azione = "approva";
    }
    if (azione === "annulla") {
      this.chiudiFlusso(id, "fermato", "piano annullato da te", r);
      return this.run(id);
    }
    e.attesa = undefined;
    if (azione === "modifica") {
      if (!testo?.trim()) throw Error("Scrivi che cosa cambiare nel piano");
      e.modificaPiano = testo.trim();
      this.event(r, "flow.plan_change", testo.trim());
      setImmediate(() => void this.eseguiPasso(id));
      return this.run(id);
    }
    e.modificaPiano = undefined;
    this.event(r, "flow.plan_approved", e.flusso.approvaPiano ? "Piano approvato · da ora i piani di questo flusso partono da soli (/flusso per tornare a chiedere)" : "Piano approvato");
    this.avanti(id, r);
    return this.run(id);
  }
  // Fermare il flusso: il turno in corso si interrompe, la domanda a un
  // gratuito si annulla, il lavoro fatto resta nella copia.
  async fermaFlusso(id: string) {
    const r = this.run(id);
    if (!r.esecuzione) throw Error("Nessun flusso in corso");
    const diretto = this.passiDiretti.get(id);
    if (diretto) {
      diretto.controllo.abort();
      await diretto.fatta;
    }
    if (this.children.has(id) || ["RUNNING", "STARTING"].includes(r.state)) await this.action(id, "pause");
    this.chiudiFlusso(id, "fermato", "fermato da te: il lavoro fatto finora resta nella copia");
    return this.run(id);
  }
  // Scartare (o rimettere) un suggerimento prima che vada all'AI.
  segnaSuggerimento(id: string, sid: string, scartato: boolean) {
    const r = this.run(id);
    const x = (r.suggerimenti ?? []).find((y: any) => y.id === sid);
    if (!x) throw Error("Suggerimento non trovato");
    if (x.stato === "inviato") throw Error("Questo suggerimento è già stato passato all'AI");
    x.stato = scartato ? "scartato" : "nuovo";
    this.event(r, "review.marked", `${scartato ? "Scartato" : "Rimesso"}: ${String(x.testo).slice(0, 120)}`);
    return this.run(id);
  }
  // Le revisioni in corso, con il modo di fermarle e di aspettarle allo
  // spegnimento (collaudo del 25 ottobre, CT-2.0-107).
  revisioniInCorso = new Map<string, { controllo: AbortController; fatta: Promise<void> }>();
  // I passi dei flussi fatti da un modello che risponde soltanto.
  passiDiretti = new Map<string, { controllo: AbortController; fatta: Promise<void> }>();
  // Qualunque lavoro in corso: turni, chiusure, risposte locali o gratuite,
  // revisioni, permessi in attesa. Chi aggiorna il servizio non deve
  // interromperli (CT-2.0-102: contava solo i turni).
  occupato() {
    return (
      this.children.size > 0 ||
      this.busy.size > 0 ||
      this.locali.size > 0 ||
      this.revisioniInCorso.size > 0 ||
      this.passiDiretti.size > 0 ||
      this.permessiInAttesa.size > 0
    );
  }
  // Una revisione delle modifiche: a fine turno («fine») o durante il lavoro
  // («periodo»). Non parte se il revisore è spento, se ne è già in corso una,
  // se non c'è niente di nuovo da guardare o se manca il consenso sui dati.
  // Restituisce il motivo per cui non parte, oppure «avviata».
  // La prossima revisione a turno in coda (chi corregge, o Codex, Claude,
  // Qwen come revisori): un turno vero con quell'AI, in sola lettura se deve
  // solo suggerire.
  async prossimaRevisioneATurno(id: string) {
    let r = this.run(id);
    if (r.esecuzione || r.revisioneATurno || !["READY", "PAUSED"].includes(r.state) || this.busy.has(id)) return;
    const coda: string[] = r.codaRevisioni ?? [];
    const chiave = coda[0];
    if (!chiave) return;
    r.codaRevisioni = coda.slice(1);
    const controllo = this.controlli(r).find((c) => c.chiave === chiave);
    const p = controllo && controllo.config.attivo ? sceltaRevisore(controllo.config, (x) => this.chiavi.esiste(x)) : undefined;
    if (!controllo || !p) {
      this.event(r, "review.settings", "Revisione a turno saltata: il controllo è spento o non ha chi rivede");
      return void setImmediate(() => void this.prossimaRevisioneATurno(id));
    }
    const corregge = Boolean(controllo.config.corregge);
    let file: string[] = [];
    try {
      file = differenze(r.work, 4000).file;
    } catch {}
    const nome = controllo.chiave === "revisore" ? nomeServizio(p) : `${controllo.nome} · ${nomeServizio(p)}`;
    const richiesta = String((r.transcript ?? []).filter((t: any) => t.role === "utente").at(-1)?.text ?? r.request ?? "");
    const testo = [
      `Sei ${controllo.chiave === "revisore" ? "il revisore" : `il controllo «${controllo.nome}»`} di Continuity: ricontrolli il lavoro appena fatto da un'altra AI in questo progetto.`,
      controllo.config.istruzioni,
      `Richiesta della persona:\n${richiesta.slice(0, 4000)}`,
      file.length ? `File cambiati e non ancora consegnati: ${file.slice(0, 40).join(", ")}` : "Guarda le modifiche recenti del progetto.",
      corregge
        ? `Se trovi errori, correggili direttamente nei file. Alla fine elenca in breve che cosa hai corretto, una riga per correzione che comincia con «- »; se è tutto a posto scrivi esattamente ${NESSUN_SUGGERIMENTO}.`
        : `Non modificare i file. Rispondi con al massimo 8 suggerimenti, uno per riga, nella forma «- file:riga — problema → che cosa fare»; se è tutto a posto scrivi esattamente ${NESSUN_SUGGERIMENTO}.`,
    ].join("\n\n");
    r.revisioneATurno = { chiave, corregge, da: nome, seq: (r.version ?? 0) + 2 };
    this.event(r, "review.started", `${nome} ${corregge ? "ricontrolla e corregge" : "ricontrolla"} il lavoro${file.length ? ` (${file.length} file)` : ""}`, nome);
    try {
      await this.turn(id, testo, { provider: p.id, passoFlusso: { soloLettura: !corregge } });
    } catch (e) {
      r = this.run(id);
      r.revisioneATurno = undefined;
      this.event(r, "review.failed", `${nome}: ${e instanceof Error ? e.message : String(e)}`, nome);
    }
  }
  esitoRevisioneATurno(id: string, r: any, revisione: { chiave: string; corregge: boolean; da: string; seq: number }, fallito: boolean, note?: string) {
    if (fallito) {
      this.event(r, "review.failed", `${revisione.da}: ${note ?? "turno interrotto"}`, revisione.da);
      return;
    }
    const messaggi = this.store
      .events(id, revisione.seq - 1)
      .filter((x: any) => x.type === "agent.message" || x.type === "agent.reported");
    const voci = leggiSuggerimenti(String(messaggi.at(-1)?.payload?.message ?? ""));
    if (revisione.corregge) {
      this.event(r, "review.completed", voci.length ? `Corretto da ${revisione.da}:\n${voci.map((x) => `• ${x}`).join("\n")}` : "Nessuna correzione: il lavoro sembra a posto", revisione.da);
      return;
    }
    const nuovi = voci.map((testo) => ({
      id: randomUUID().slice(0, 8),
      testo,
      da: revisione.da,
      quando: new Date().toISOString(),
      stato: "nuovo" as const,
      motivo: "fine",
    }));
    r.suggerimenti = [...(r.suggerimenti ?? []), ...nuovi].slice(-40);
    this.event(r, "review.completed", nuovi.length ? nuovi.map((x) => `• ${x.testo}`).join("\n") : "Nessun suggerimento: le modifiche sembrano a posto", revisione.da);
  }
  // Tutti i controlli accesi, ognuno per conto suo.
  avviaRevisioni(id: string, motivo: "fine", diff?: Differenze): Record<string, string> {
    const esiti: Record<string, string> = {};
    for (const c of this.controlli(this.run(id))) esiti[c.chiave] = this.avviaRevisione(id, motivo, diff, c.chiave);
    return esiti;
  }
  avviaRevisione(id: string, motivo: "fine", diff?: Differenze, chiave = "revisore"): string {
    const r = this.run(id);
    const controllo = this.controlli(r).find((c) => c.chiave === chiave);
    if (!controllo) return "spento";
    const config = controllo.config;
    const principale = chiave === "revisore";
    // Il nome nei messaggi: «Revisore» resta com'era, gli altri si presentano.
    const chi = principale ? "Il revisore" : `Il controllo «${controllo.nome}»`;
    const inCorso = principale ? id : `${id}#${chiave}`;
    if (!r.session || !r.project || !config.attivo) return "spento";
    if (this.revisioniInCorso.has(inCorso)) return "già in corso";
    // Ogni N turni: si contano i turni finiti con modifiche dall'ultima
    // revisione di questo controllo.
    // Il conto si salva con la sessione (un evento che la conversazione non
    // mostra).
    const contati = { ...(r.turniDaRevisione ?? {}), [chiave]: ((r.turniDaRevisione ?? {})[chiave] ?? 0) + 1 };
    if (contati[chiave] < config.ogniTurni) {
      r.turniDaRevisione = contati;
      this.event(r, "review.counted", `${chi}: rivede fra ${config.ogniTurni - contati[chiave]} turni`);
      return `fra ${config.ogniTurni - contati[chiave]} turni`;
    }
    if ((r.turniDaRevisione ?? {})[chiave]) {
      r.turniDaRevisione = { ...contati, [chiave]: 0 };
      this.event(r, "review.counted", `${chi}: rivede a questo turno`);
    }
    const p = sceltaRevisore(config, (x) => this.chiavi.esiste(x));
    if (!p) {
      this.event(r, "review.failed", `${principale ? "Revisore" : `Controllo «${controllo.nome}»`} acceso ma nessun servizio gratuito collegato: /collega groq (o google)`);
      return "nessun revisore";
    }
    // Chi corregge, o un'AI che lavora attraverso un programma: un turno vero
    // dopo quello di chi ha lavorato, mai durante (due AI sugli stessi file).
    if (rivedeConUnTurno(p, config)) {
      if (!(r.codaRevisioni ?? []).includes(chiave)) {
        r.codaRevisioni = [...(r.codaRevisioni ?? []), chiave];
        this.event(r, "review.queued", `${principale ? "Il revisore" : `Il controllo «${controllo.nome}»`} (${nomeServizio(p)}) ${config.corregge ? "ricontrolla e corregge" : "ricontrolla"} appena finisce il turno`);
      }
      return "a turno";
    }
    if (serveConsenso(p, config)) {
      // Una volta sola per progetto e servizio: la risposta arriva da /revisore.
      if (!r.consensoChiesto?.includes(p.id)) {
        r.consensoChiesto = [...(r.consensoChiesto ?? []), p.id];
        this.event(r, "review.consent_needed", `${nomeServizio(p)} riceverebbe il codice cambiato: ${p.dati} Serve il tuo sì in /revisore.`);
      }
      return "consenso";
    }
    // La misura delle modifiche dipende dal servizio (Groq accetta poco).
    const caratteri = caratteriPer(p);
    let foto: Differenze;
    try {
      foto = diff ? { ...accorcia(diff.pezzi, caratteri), esclusi: diff.esclusi ?? [] } : differenze(r.work, caratteri);
    } catch (e) {
      // Senza Git che funziona il revisore non vede le modifiche: lo dice,
      // invece di concludere in silenzio che non c'è niente (26 ottobre).
      this.event(r, "review.failed", `${chi} non può leggere le modifiche: ${e instanceof Error ? e.message : String(e)}`);
      return "modifiche illeggibili";
    }
    if (!foto.testo.trim()) return "niente da guardare";
    const ultima = principale ? r.ultimaRevisione : r.ultimeRevisioni?.[chiave];
    if (ultima?.impronta === foto.impronta) return "già vista";
    const nome = principale ? nomeServizio(p) : `${controllo.nome} · ${nomeServizio(p)}`;
    this.event(
      r,
      "review.started",
      `${nome} rivede le modifiche (${foto.file.length} file${foto.troncato ? ", solo in parte: sono molte" : ""})` +
        (foto.esclusi.length ? ` · non gli mando ${foto.esclusi.length === 1 ? "1 file" : `${foto.esclusi.length} file`} di credenziali o collegamenti (${foto.esclusi.slice(0, 3).join(", ")})` : ""),
      nome,
    );
    const arresto = new AbortController();
    let finita!: () => void;
    this.revisioniInCorso.set(inCorso, { controllo: arresto, fatta: new Promise<void>((ok) => (finita = ok)) });
    const richiesta = String(r.request ?? (r.transcript ?? []).filter((t: any) => t.role === "utente").at(-1)?.text ?? "");
    const conversazione = (r.transcript ?? [])
      .slice(-8)
      .map((t: any) => `${t.role === "utente" ? "Persona" : t.agent ?? "AI"}: ${String(t.text).slice(0, 400)}`)
      .join("\n");
    void (async () => {
      try {
        const segreto = p.accesso === "chiave" ? this.chiavi.leggi(p.id) : undefined;
        let modelli: string[] = [];
        try {
          modelli = (await this.modelliGratuitiDi(p.id)).map((m) => m.id);
        } catch {}
        const esito = await chiediRevisione({
          provider: p,
          chiave: segreto,
          modelli: modelli.length ? modelli : config.modello ? [config.modello] : [],
          primo: config.modello,
          messaggi: messaggiRevisione({ richiesta, conversazione, diff: foto, istruzioni: config.istruzioni, lingua: this.linguaPer(r, [richiesta]) }),
          caratteri,
          segnale: arresto.signal,
          piuCorti: (quanti) =>
            messaggiRevisione({ richiesta, conversazione, diff: accorcia(foto.pezzi, quanti), istruzioni: config.istruzioni, lingua: this.linguaPer(r, [richiesta]) }),
          scarica: this.scaricaGratuiti,
        });
        if (arresto.signal.aborted) return;
        const r2 = this.run(id);
        // Tolto mentre rivedeva: il risultato non vale più (CT-2.0-301).
        if (!principale && !(r2.controlli ?? []).some((c: any) => c.id === chiave)) return;
        const da = `${nome} · ${esito.modello}`;
        const nuovi = esito.suggerimenti.map((testo) => ({
          id: randomUUID().slice(0, 8),
          testo,
          da,
          quando: new Date().toISOString(),
          stato: "nuovo" as const,
          motivo,
        }));
        r2.suggerimenti = [...(r2.suggerimenti ?? []), ...nuovi].slice(-40);
        // Vista solo se la revisione è riuscita: dopo un errore la stessa
        // fotografia si può rivedere (CT-2.0-104).
        const vista = { impronta: foto.impronta, quando: new Date().toISOString() };
        if (principale) r2.ultimaRevisione = vista;
        else r2.ultimeRevisioni = { ...(r2.ultimeRevisioni ?? {}), [chiave]: vista };
        this.event(
          r2,
          "review.completed",
          (nuovi.length
            ? nuovi.map((x) => `• ${x.testo}`).join("\n")
            : "Nessun suggerimento: le modifiche sembrano a posto") +
            (esito.ridotto || foto.troncato ? "\n(Ha guardato solo una parte delle modifiche: sono troppe per il piano gratuito)" : ""),
          da,
        );
      } catch (e) {
        // Fermata dallo spegnimento: niente da scrivere su un registro che si chiude.
        if (!arresto.signal.aborted)
          this.event(this.run(id), "review.failed", `${nome}: ${e instanceof Error ? e.message : String(e)}`, nome);
      } finally {
        this.revisioniInCorso.delete(inCorso);
        finita();
      }
    })();
    return "avviata";
  }
  // La domanda vera al modello che risponde soltanto, con il suo contesto.
  private chiediAlModello(
    p: ProviderNoto,
    chiave: string | undefined,
    modello: string,
    testo: string,
    contesto: string,
    ogniPezzo: (pezzo: string) => void,
    segnale: AbortSignal,
  ) {
    return chiediModello(
      {
        provider: p,
        chiave,
        modello,
        messaggi: [
          {
            role: "system",
            content:
              `Sei un'AI dentro Continuity. ${istruzioneLingua(this.linguaPer(undefined, [testo]))} Non puoi leggere né modificare i file del progetto e non puoi eseguire comandi: conosci solo i nomi dei file e la conversazione qui sotto. ` +
              `Se la richiesta chiede di creare, modificare o cancellare file, scrivi come prima riga esattamente ${SEGNO_FILE} e poi, in poche righe, che cosa andrebbe fatto.\n\n` +
              contesto,
          },
          { role: "user", content: testo },
        ],
        ogniPezzo,
        segnale,
      },
      this.scaricaGratuiti,
    );
  }
  // Un messaggio al modello che risponde: come un compito locale, fuori dai
  // turni, con la conversazione e l'elenco dei file come contesto.
  chiediDiretto(id: string, testo: string) {
    const r = this.run(id);
    if (!r.session) throw Error("La run non è una sessione");
    if (!r.risponde) throw Error("Nessun modello scelto: /ai");
    if (this.busy.has(id) || ["RUNNING", "STARTING"].includes(r.state))
      throw Error("Un'AI sta lavorando: il messaggio parte a fine turno");
    if (this.locali.has(id)) throw Error("C'è già una risposta in arrivo");
    const p = providerNoto(r.risponde.provider);
    // Un servizio tolto da Continuity (Zen gratuito, GitHub Models, 28
    // ottobre): risponde di nuovo la sequenza, e lo si dice.
    if (!p) {
      const tolto = r.risponde.provider;
      r.risponde = undefined;
      this.event(r, "responder.changed", `${tolto} non è più disponibile in Continuity: da ora risponde la sequenza`);
      throw Error(`${tolto} non è più disponibile: il messaggio va alle AI della sequenza, rimandalo (o scegli un'altra AI con /ai)`);
    }
    const nome = `${nomeServizio(p)} · ${r.risponde.modello}`;
    // Un messaggio che da solo supera la misura del piano gratuito non si
    // manda: lo si dice subito, con che cosa fare (CT-2.0-106).
    const massimo = caratteriPer(p, 1_500);
    if (p.massimoToken && testo.length > massimo)
      throw Error(
        `Il messaggio è troppo lungo per il piano gratuito di ${nomeServizio(p)} (${testo.length.toLocaleString("it-IT")} caratteri, al massimo circa ${massimo.toLocaleString("it-IT")}): accorcialo, oppure scegli un'AI della sequenza con /ai e allega il testo.`,
      );
    this.event(r, "direct.request", testo, nome);
    this.remember(r, "utente", testo);
    const controllo = new AbortController();
    this.locali.set(id, controllo);
    let file = "";
    try {
      file = elencoFile(r.work).join("\n");
    } catch {}
    const contestoIntero = [
      `Progetto: ${r.project?.root ?? ""}`,
      ...(file ? [`File del progetto (solo i nomi):\n${file}`] : []),
      "Conversazione recente:",
      ...(r.transcript ?? [])
        .slice(-12)
        .map((t: any) => `${t.role === "utente" ? "Persona" : t.agent ?? "AI"}: ${String(t.text).slice(0, 800)}`),
    ].join("\n");
    // Dentro la misura del servizio (Groq gratuito: 8.000 token al minuto):
    // si tiene la parte finale, la conversazione più recente.
    const spazio = Math.max(1_000, caratteriPer(p, 1_500) - testo.length);
    let contesto = contestoIntero.length > spazio ? "…\n" + contestoIntero.slice(-spazio) : contestoIntero;
    let riduzioni = 0;
    void (async () => {
      try {
        const chiave = p.accesso === "chiave" ? this.chiavi.leggi(p.id) : undefined;
        let parziale = "";
        // Se il modello è sovraccarico o non risponde prima di aver scritto
        // qualcosa, si passa al prossimo modello gratuito dello stesso
        // servizio, lo si dice, e si resta su quello.
        const candidati = [r.risponde.modello];
        try {
          for (const m of inOrdine(p, (await this.modelliGratuitiDi(p.id)).map((x) => x.id)))
            if (!candidati.includes(m)) candidati.push(m);
        } catch {}
        let usato = r.risponde.modello;
        let risposta = "";
        for (let i = 0; i < Math.min(candidati.length, 3); i++) {
          usato = candidati[i];
          try {
            risposta = await this.chiediAlModello(p, chiave, usato, testo, contesto, (pezzo) => {
              parziale += pezzo;
              this.parziali.set(id, parziale.replace(SEGNO_FILE, "").trimStart());
            }, controllo.signal);
            break;
          } catch (e) {
            // Troppo grande: stesso modello, metà del contesto (al massimo due volte).
            if (e instanceof ErroreGratuito && e.tipo === "troppo" && !parziale && riduzioni < 2 && contesto.length > 500) {
              riduzioni++;
              contesto = "…\n" + contesto.slice(-Math.floor(contesto.length / 2));
              i--;
              continue;
            }
            if (e instanceof ErroreGratuito && e.tipo === "troppo")
              throw Error(`Il messaggio è troppo lungo per il piano gratuito di ${nomeServizio(p)}: accorcialo, oppure scegli un'AI della sequenza con /ai.`);
            if (!siPassaAlProssimo(e) || parziale || i === Math.min(candidati.length, 3) - 1) throw e;
            this.event(
              this.run(id),
              "responder.changed",
              `${usato}: ${e instanceof Error ? e.message.replace(/^[^:]*:\s*/, "") : e} · continuo con ${candidati[i + 1]}`,
            );
          }
        }
        if (usato !== r.risponde.modello) {
          const r3 = this.run(id);
          r3.risponde = { provider: p.id, modello: usato };
          this.event(r3, "engine.warning", `Da ora risponde ${nomeServizio(p)} · ${usato}`);
        }
        const nomeUsato = `${nomeServizio(p)} · ${usato}`;
        const sulFile = risposta.trimStart().startsWith(SEGNO_FILE);
        const pulita = risposta.replace(SEGNO_FILE, "").trim();
        const r2 = this.run(id);
        this.parziali.delete(id);
        this.remember(r2, "ai", pulita, nomeUsato);
        this.event(r2, "direct.message", pulita || "(nessuna risposta)", nomeUsato);
        if (sulFile)
          this.event(this.run(id), "direct.files", testo, nomeUsato);
      } catch (e) {
        this.parziali.delete(id);
        // L'errore vero: «interrotta» solo se l'ha fermata la persona.
        this.event(
          this.run(id),
          "direct.failed",
          controllo.signal.aborted
            ? "Risposta interrotta da te"
            : (e instanceof Error ? e.message : String(e)) + " · riprova, o scegli un altro modello con /modello",
          nome,
        );
      } finally {
        this.locali.delete(id);
      }
    })();
    return { ok: true, provider: p.id, modello: r.risponde.modello };
  }
  avviaCompitoLocale(id: string, testo: string, compitoId?: string) {
    const r = this.run(id);
    if (!r.session) throw Error("La run non è una sessione");
    if (this.busy.has(id) || ["RUNNING", "STARTING"].includes(r.state))
      throw Error("Un'AI sta lavorando: il compito parte a fine turno");
    if (this.locali.has(id)) throw Error("C'è già un compito locale in corso");
    const config = leggiIbrida(this.store.root);
    if (!config.attiva) throw Error("L'AI ibrida è spenta: accendila con /ibrida");
    const compito =
      config.compiti.find((c) => c.id === (compitoId ?? "chiedi")) ??
      config.compiti[0];
    if (!compito) throw Error("Nessun compito disponibile: aggiungine uno con /ibrida");
    this.event(r, "local.request", testo, "persona");
    this.remember(r, "utente", testo);
    const controllo = new AbortController();
    this.locali.set(id, controllo);
    const contesto = [
      `Progetto: ${r.project?.root ?? ""}`,
      ...(r.transcript ?? [])
        .slice(-12)
        .map((t: any) => `${t.role === "utente" ? "Persona" : t.agent ?? "AI"}: ${String(t.text).slice(0, 600)}`),
    ].join("\n");
    void (async () => {
      try {
        if (!(await assicuraOllama()))
          throw Error("Ollama non risponde: aprilo dal Launchpad, poi riprova");
        let parziale = "";
        const risposta = await eseguiCompito({
          modello: config.modello,
          // Il modello sa dove gira e che cosa non può fare (25 ottobre: diceva
          // «non posso sapere se giro in locale», inventava una ricerca).
          istruzioni:
            `Sei ${nomeLocale(config.modello)} (${config.modello}), un modello che gira sul Mac della persona con Ollama, senza internet: non puoi cercare sul web, non puoi leggere né modificare i file e non esegui comandi. ` +
            `Se ti chiedono una ricerca o notizie recenti, dillo e rispondi con ciò che sai, avvertendo che su date, nomi e fatti puoi sbagliare. ${istruzioneLingua(this.linguaPer(r, [testo]))} Non mescolare parole o caratteri di altre lingue.\n\n` +
            compito.istruzioni,
          contesto,
          testo,
          ogniPezzo: (pezzo) => {
            parziale += pezzo;
            this.parziali.set(id, parziale);
          },
          segnale: controllo.signal,
        });
        const r2 = this.run(id);
        this.parziali.delete(id);
        this.remember(r2, "ai", risposta, nomeLocale(config.modello));
        this.event(r2, "local.message", risposta || "(nessuna risposta)", nomeLocale(config.modello));
      } catch (e) {
        this.parziali.delete(id);
        this.event(
          this.run(id),
          "local.failed",
          controllo.signal.aborted
            ? "Compito interrotto"
            : e instanceof Error
              ? e.message
              : String(e),
          nomeLocale(config.modello),
        );
      } finally {
        this.locali.delete(id);
      }
    })();
    return { ok: true, compito: compito.id, modello: config.modello };
  }
  // Un allegato tolto dalla persona (la «×» accanto al campo): sparisce
  // dall'elenco e dalla cartella allegati/ della copia, così l'AI non lo vede.
  togliAllegato(id: string, nome: string) {
    const r = this.run(id);
    if (!r.session) throw Error("La run non è una sessione");
    if (!(r.allegati ?? []).includes(nome)) throw Error("Allegato non trovato: " + nome);
    try {
      rmSync(join(r.work, "allegati", basename(nome)), { force: true });
    } catch {}
    r.allegati = (r.allegati ?? []).filter((x: string) => x !== nome);
    this.event(r, "attachment.removed", `Allegato tolto: ${nome}`);
    return this.run(id);
  }
  // Il worktree e il ramo vivono nel repository dell'utente: lasciarli lì a ogni
  // sessione gli riempirebbe «git branch» e «git worktree list» di voci nostre.
  smontaWorktree(r: any) {
    if (!r.project?.root || r.project.senzaGit) return;
    const git = (args: string[], cwd: string) => {
      try {
        execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
          cwd,
          encoding: "utf8",
          timeout: 30000,
          env: ambienteGit(cwd),
          stdio: ["ignore", "pipe", "pipe"],
        });
        return true;
      } catch {
        return false;
      }
    };
    // Il lavoro resta nella cartella della run: si smonta il collegamento, non
    // si cancella ciò che l'AI ha scritto.
    git(["worktree", "remove", "--force", r.work], r.project.root);
    git(["worktree", "prune"], r.project.root);
    git(["branch", "-D", "continuity/" + r.id], r.project.root);
  }
  // Le sessioni finite lasciano copie di lavoro e checkpoint che nessuno
  // riaprirà: dopo un po' occupano spazio e basta.
  pulisci(giorni = 14) {
    const limite = Date.now() - giorni * 86400000;
    let liberate = 0;
    for (const salvata of this.store.list()) {
      if (!terminal.includes(salvata.state)) continue;
      const cartella = join(this.store.root, "runs", salvata.id);
      if (!existsSync(cartella)) continue;
      const quando = Date.parse(salvata.finishedAt ?? salvata.createdAt ?? "");
      if (!Number.isFinite(quando) || quando > limite) continue;
      try {
        this.smontaWorktree(salvata);
        rmSync(cartella, { recursive: true, force: true });
        liberate++;
      } catch {}
    }
    return liberate;
  }
  // Quando la quota torna, il lavoro riparte da solo: è la differenza fra sapere
  // l'orario e non doverci pensare.
  async riprendiInAttesa() {
    for (const salvata of this.store.list()) {
      const attesa = (salvata as any).inAttesa;
      if (!attesa || salvata.state !== "PAUSED") continue;
      if (Date.now() < new Date(attesa.dalle).getTime()) continue;
      const r = this.run(salvata.id);
      if (!(r.providers ?? []).some((p: string) => this.disponibile(r, p)))
        continue;
      // Un'altra sessione sta lavorando: si riprova al giro dopo. Partire
      // adesso dava «Writer già attivo» e lasciava la sessione bloccata.
      if (this.children.size) continue;
      r.inAttesa = undefined;
      const turnoPrima = r.turnNumber ?? 0;
      this.event(
        r,
        "resume.started",
        "Crediti tornati: riprendo il lavoro in attesa",
      );
      let avviato = false;
      try {
        // Il testo integro, se il servizio non è stato riavviato nel frattempo:
        // quello salvato ha i segreti oscurati.
        await this.turn(r.id, this.richiesteIntere.get(r.id) ?? attesa.testo, {
          automatica: true,
        });
        avviato = true;
        // turn() avvia soltanto: il lavoro finisce più tardi, e applicare prima
        // significherebbe consegnare una cartella ancora vuota.
        const dopo = await this.attendiFineTurno(r.id, turnoPrima);
        // Un turno annullato o fallito non produce lavoro da consegnare: darlo
        // comunque scriverebbe nella cartella uno stato dichiarato incoerente.
        // Anche un turno ripreso che si ferma di nuovo per quota ha lasciato
        // un lavoro a metà: si consegna solo un turno arrivato in fondo.
        if (
          ["CANCELLED", "FAILED", "BLOCKED"].includes(dopo.state) ||
          dopo.ultimoTurnoFallito ||
          dopo.inAttesa ||
          dopo.quotaDetected
        ) {
          this.event(
            this.run(r.id),
            "resume.failed",
            `Ripresa conclusa in ${dopo.state}: niente da consegnare`,
          );
          return;
        }
        // Nessuno è al terminale ad applicare: i file arrivano comunque, e
        // /annulla resta la via di ritorno.
        if (r.project && this.changedFiles(this.run(r.id)).length)
          this.applyToProject(r.id);
      } catch (e) {
        const ancora = this.run(r.id);
        // Il turno è stato fatto e la consegna non è riuscita (un conflitto
        // con un file cambiato dalla persona): rifarlo non serve, e ripeteva
        // all'infinito la stessa richiesta. Il lavoro resta nella copia.
        if (avviato) {
          this.event(
            ancora,
            "resume.failed",
            `Turno ripreso concluso, ma la consegna non è riuscita: ${e instanceof Error ? e.message : String(e)}. Il lavoro è nella copia: /applica per riprovare.`,
          );
          continue;
        }
        // La richiesta torna in attesa: un tentativo fallito non deve far
        // sparire ciò che l'utente aveva chiesto.
        ancora.inAttesa = attesa;
        this.event(
          ancora,
          "resume.failed",
          `Ripresa non riuscita, resto in attesa: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }
  async turn(
    id: string,
    text: string,
    opzioni: { automatica?: boolean; provider?: string; passoFlusso?: { soloLettura: boolean }; incarichi?: Incarico[] } = {},
  ) {
    // Un messaggio della persona segue il flusso attivo, scelto con /flusso
    // (il nome davanti al messaggio, «revisione: …», tolto il 27 ottobre: non
    // si capiva se fosse un comando). Un flusso di un solo passo che scrive è
    // un turno normale, come Continuity prima dei flussi (Fase 3).
    if (!opzioni.automatica && !opzioni.passoFlusso && !opzioni.provider) {
      const r = this.run(id);
      if (r.session && r.esecuzione)
        throw Error(
          r.esecuzione.attesa === "piano"
            ? "Il piano aspetta la tua risposta: approvalo, chiedi di cambiarlo o annullalo"
            : "Un flusso è in corso: aspetta che finisca, oppure fermalo (esc due volte)",
        );
      // Le AI chiamate con @ nel messaggio (27 ottobre): chi fa cosa vale per
      // questo messaggio, al posto del flusso in uso. La persona lo ha già
      // confermato nel terminale (incarichi); dall'API si legge dal testo.
      const incarichi = r.session ? (opzioni.incarichi ?? incarichiDalMessaggio(text).incarichi) : [];
      if (incarichi.length) {
        const problema = problemaIncarichi(incarichi);
        if (problema) throw Error(`Chi fa cosa: ${problema}`);
        const daIncarichi = flussoDaIncarichi(incarichi);
        if (!daIncarichi.soloUnTurno) return this.avviaFlusso(id, daIncarichi.flusso, daIncarichi.ruoli, text);
        opzioni = { ...opzioni, provider: daIncarichi.soloUnTurno.ai };
      } else if (r.session) {
        const { ruoli } = leggiFlussi(this.store.root);
        const flusso = this.flussoAttivo(r);
        if (!soloUnTurno(flusso, ruoli)) return this.avviaFlusso(id, flusso, ruoli, text);
        const passo = flusso.passi[0];
        const ruolo = ruoli.find((x) => x.id === passo.ruolo)!;
        if (passo.ai !== "sequenza") opzioni = { ...opzioni, provider: passo.ai };
        // Un ruolo che scrive diverso da «Scrive»: le sue istruzioni prima.
        if (ruolo.id !== "scrive") text = `${ruolo.istruzioni}\n\n${text}`;
      }
    }
    // Due avvii insieme (la ripresa automatica e l'utente) superavano entrambi
    // il controllo dello stato: uno cancellava la richiesta dell'altro e la
    // sessione finiva bloccata con l'AI al lavoro.
    if (this.avviiTurno.has(id)) throw Error("Turno già in avvio");
    this.avviiTurno.add(id);
    try {
      return await this.avviaTurno(id, text, opzioni);
    } finally {
      this.avviiTurno.delete(id);
    }
  }
  private avviiTurno = new Set<string>();
  private richiesteIntere = new Map<string, string>();
  private async avviaTurno(
    id: string,
    text: string,
    opzioni: { automatica?: boolean; provider?: string; passoFlusso?: { soloLettura: boolean } },
  ) {
    const r = this.run(id);
    if (!r.session) throw Error("La run non è una sessione");
    // Una sessione bloccata da un guasto precedente non ha processi vivi: si
    // riconcilia e si riparte, invece di restare irraggiungibile per sempre.
    if (r.state === "BLOCKED" && !this.children.has(id)) {
      await this.assicuraNessunWriter(r);
      r.state = "PAUSED";
      r.error = undefined;
      this.event(
        r,
        "recovery.completed",
        "Sessione recuperata dopo un guasto: il lavoro nella copia è intatto",
      );
    }
    if (!["READY", "PAUSED"].includes(this.run(id).state))
      throw Error("Turno non consentito nello stato " + this.run(id).state);
    const guasto = this.copiaInutilizzabile(r);
    if (guasto)
      throw Error(
        `Questa sessione non può continuare: ${guasto}. Esci (/esci) e riapri Continuity nella cartella: si apre una sessione nuova.`,
      );
    if (this.busy.has(id)) throw Error("Turno già in corso");
    // La richiesta nel registro, oscurata come il resto, prima di tutto ciò
    // che il turno provoca (cambio di AI, allineamento): alla riapertura il
    // terminale ristampa la conversazione in quest'ordine, e senza questo
    // evento le richieste vecchie restavano solo nelle ultime 40 voci.
    // Il passo di un flusso: la richiesta della persona è già nel registro
    // (all'avvio del flusso); il messaggio composto per l'AI non lo è.
    if (!opzioni.passoFlusso) this.event(r, "user.request", text);
    r.passoSoloLettura = Boolean(opzioni.passoFlusso?.soloLettura);
    // Gli allegati vanno con il messaggio che li accompagna: dopo l'invio il
    // campo si svuota, e i messaggi dopo non li rimandano (prova di Lorenzo
    // del 19 ottobre). I file restano in allegati/, citati come già visti.
    r.allegatiTurno = r.allegati ?? [];
    if (r.allegatiTurno.length)
      r.allegatiPrecedenti = [
        ...new Set([...(r.allegatiPrecedenti ?? []), ...r.allegatiTurno]),
      ];
    r.allegati = [];
    // I suggerimenti del revisore non scartati vanno all'AI di questo turno,
    // una volta sola (Fase 2, passo 2).
    // Non a un turno di revisione: sono per chi lavora.
    const daPassare = r.revisioneATurno ? [] : (r.suggerimenti ?? []).filter((x: any) => x.stato === "nuovo");
    r.suggerimentiTurno = daPassare.map((x: any) => ({ testo: x.testo, da: x.da }));
    if (daPassare.length) {
      r.suggerimenti = (r.suggerimenti ?? []).map((x: any) =>
        x.stato === "nuovo" ? { ...x, stato: "inviato", turno: (r.turnNumber ?? 0) + 1 } : x,
      );
      this.event(
        r,
        "review.sent",
        `${daPassare.length === 1 ? "1 suggerimento" : `${daPassare.length} suggerimenti`} del revisore passati all'AI di questo turno`,
      );
    }
    // Il permesso dato per questo turno (Codex, azioni fuori dal progetto):
    // vale solo per il turno che parte adesso.
    r.permessoAttivo = r.permessoTurno;
    r.permessoTurno = undefined;
    r.permessiNegati = [];
    // Un turno nuovo cambia la copia: ciò che /annulla aveva messo da parte
    // non si rimette più sopra il lavoro nuovo.
    r.rifacibile = undefined;
    // Ogni turno parte dalla prima AI disponibile secondo la sequenza scelta:
    // così cambiare ordine ha effetto, e chi si è ricaricato torna in gioco.
    let preferito = (r.providers ?? [r.agent]).find((p: string) =>
      this.disponibile(r, p),
    );
    // L'AI ibrida: scelta a comando per questo turno («Qwen sui file»), o
    // come riserva quando nessuna AI della sequenza ha crediti.
    const ibrida = leggiIbrida(this.store.root);
    // Solo nelle sessioni reali: in simulazione (e nei test) il modello locale
    // non c'entra, e cercarlo faceva aspettare Ollama per niente.
    const riserva =
      !preferito && r.mode === "live" && ibrida.attiva && ibrida.riserva
        ? PROVIDER_IBRIDO
        : undefined;
    const scelto = opzioni.provider
      ? providerNoto(opzioni.provider)?.id
      : riserva;
    if (scelto === PROVIDER_IBRIDO) {
      r.modelli = { ...(r.modelli ?? {}), [PROVIDER_IBRIDO]: ibrida.modello };
      if (!(await assicuraOllama()))
        throw Error("Ollama non risponde: aprilo dal Launchpad, poi riprova");
    }
    if (scelto) {
      if (scelto !== r.agent)
        this.event(
          r,
          "switch.started",
          opzioni.provider
            ? `Questo turno lo fa ${scelto === PROVIDER_IBRIDO ? `${ibrida.modello} sul tuo Mac (AI ibrida)` : scelto}`
            : `Tutte le AI sono senza crediti · continua ${ibrida.modello} sul tuo Mac (AI ibrida)`,
        );
      r.agent = scelto;
      preferito = undefined;
    }
    if (preferito && preferito !== r.agent) {
      this.event(
        r,
        "switch.started",
        this.disponibile(r, r.agent)
          ? `Passo a ${preferito} come da sequenza`
          : `${r.agent} è ancora senza crediti · riparto da ${preferito}`,
      );
      r.agent = preferito;
    }
    // Prima della richiesta: ciò che la persona ha cambiato nella sua cartella
    // dall'ultima consegna entra nella copia, e l'AI lo sa.
    // Sessioni nate prima della cartella standard: la si crea ora, e
    // l'allineamento la porta nella copia.
    if (r.project) {
      try {
        const { creata, importati } = preparaCartellaContinuity(r.project.root);
        if (creata)
          this.event(
            r,
            "work.synced",
            `Creata la cartella ${CARTELLA_CONTINUITY}/ nel progetto` +
              (importati.length
                ? `, con ${importati.length} agenti copiati da quelli che c'erano già`
                : ""),
          );
      } catch {}
      this.allineaAllaPersona(r);
    }
    this.remember(r, opzioni.passoFlusso ? "continuity" : "utente", text);
    // La richiesta arriva intera: tagliata a 4.000 caratteri, una specifica
    // lunga perdeva le sue ultime sezioni — comprese quelle che chiedevano il
    // resoconto finale — e l'AI rispondeva a metà lavoro senza saperlo.
    // Nel database la richiesta si conserva oscurata, come nella
    // conversazione; il testo integro serve solo per avviare il turno e resta
    // in memoria.
    r.request = redact(text.slice(0, LIMITE_RICHIESTA));
    this.richiesteIntere.set(id, text.slice(0, LIMITE_RICHIESTA));
    r.turnNumber = (r.turnNumber ?? 0) + 1;
    // Lo stato dei file all'inizio del turno: se alla fine è identico, l'AI non
    // ha toccato nulla, e dirlo «concluso» sarebbe un successo inventato.
    // Un passo che legge soltanto: una fotografia fresca, a cui tornare se
    // l'AI scrive lo stesso.
    if (r.passoSoloLettura && r.project) this.checkpoint(r);
    r.impronataInizioTurno = r.snapshotId;
    r.triedThisTurn = [r.agent];
    r.quotaDetected = false;
    r.providerError = false;
    // Anche il motivo dell'interruzione appartiene al turno che l'ha prodotta:
    // lasciandolo acceso, ogni turno successivo veniva annunciato come
    // interrotto e la verifica indipendente smetteva di girare in silenzio.
    r.uscitaFallita = undefined;
    r.ultimoTurnoFallito = false;
    // L'orario di ritorno dichiarato da un'AI vale per quel limite, non per
    // il turno dopo: ereditato, rendeva subito «disponibile» un'AI esaurita.
    r.ricaricaA = undefined;
    // Una richiesta scritta dalla persona sostituisce quella rimasta in attesa
    // dei crediti: altrimenti più tardi ripartiva da sola e veniva consegnata.
    if (!opzioni.automatica) r.inAttesa = undefined;
    this.event(r, "turn.started", `Turno ${r.turnNumber} · agente ${r.agent}`);
    // Se l'avvio fallisce (CLI assente, login scaduto) lo stato è già STARTING:
    // senza questo blocco la sessione resterebbe occupata per sempre, senza
    // processo e senza modo di riaprirla.
    try {
      await this.start(r);
    } catch (e) {
      this.block(id, e);
      throw e;
    }
    return this.run(id);
  }
  // Quota during a session is not the end of the work: the next provider in the
  // rotation takes the same turn, with the transcript and the files as they are.
  nextProvider(r: any) {
    const rotation: string[] = r.providers ?? [];
    return rotation.find(
      (p) => !(r.triedThisTurn ?? []).includes(p) && this.disponibile(r, p),
    );
  }
  async rotate(id: string, reason: string) {
    if (this.busy.has(id)) return;
    this.busy.add(id);
    try {
      const r = this.run(id);
      const credito =
        providerNoto(r.agent)?.accesso === "chiave" && Boolean(r.creditoFinito);
      this.segnaEsaurito(r, r.agent, r.ricaricaA, credito);
      if (credito)
        this.event(
          r,
          "provider.credit",
          `${r.agent} ha finito il credito: ricarica il conto, poi «/ordine ${r.agent}» per rimetterlo in gioco`,
          r.agent,
        );
      r.creditoFinito = undefined;
      let next = this.nextProvider(r);
      // Nessuna AI della sequenza ha crediti: con la riserva accesa continua
      // il modello locale (AI ibrida), sui file come le altre.
      const ibrida = leggiIbrida(this.store.root);
      if (
        !next &&
        r.mode === "live" &&
        ibrida.attiva &&
        ibrida.riserva &&
        r.agent !== PROVIDER_IBRIDO &&
        !(r.triedThisTurn ?? []).includes(PROVIDER_IBRIDO) &&
        (await assicuraOllama())
      ) {
        next = PROVIDER_IBRIDO;
        r.modelli = { ...(r.modelli ?? {}), [PROVIDER_IBRIDO]: ibrida.modello };
      }
      await this.quiesce(r);
      this.checkpoint(r);
      if (!next) {
        r.state = "PAUSED";
        const attesa = this.prossimaRicarica(r);
        // La richiesta non va persa: resta in attesa e riparte da sola quando i
        // crediti tornano, anche se il terminale nel frattempo è stato chiuso.
        if (attesa && r.session && r.request)
          r.inAttesa = {
            testo: r.request,
            dalle: new Date(attesa).toISOString(),
          };
        this.event(
          r,
          "turn.blocked",
          attesa
            ? `Tutti i provider sono senza crediti. Riprendo da solo verso le ${new Date(attesa).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}: puoi anche chiudere, i file arrivano nella tua cartella.`
            : "Tutti i provider sono senza crediti in questo turno.",
        );
        return;
      }
      // The successor inherits a verified state, not a guess: the criteria are
      // measured on the files as the predecessor left them. Qui la verifica non
      // si salta mai: oltre a misurare ciò che il successore eredita, è il
      // passaggio di stato che precede il pacchetto di handoff, e saltarlo
      // faceva fallire la rotazione proprio quando serviva.
      if (r.project) await this.verifyProject(r, true);
      this.handoff(r, next);
      r.switches = (r.switches ?? 0) + 1;
      r.agent = next;
      r.triedThisTurn = [...(r.triedThisTurn ?? []), next];
      // The new provider starts with a clean slate: the predecessor's quota is
      // history, recorded in the events and in the handoff.
      r.quotaDetected = false;
      r.providerError = false;
      r.ricaricaA = undefined;
      r.uscitaFallita = undefined;
      r.motivoErrore = undefined;
      this.parziali.delete(r.id);
      this.attivita?.delete(r.id);
      this.event(r, "switch.started", `${reason} · passaggio a ${next}`);
      await this.start(r);
    } catch (e) {
      this.block(id, e);
    } finally {
      this.busy.delete(id);
    }
  }
  // Leaving a session must free the engine for the next one; the work stays in
  // the worktree, which is the only place it ever lived.
  // Bringing the work home is the person's decision and needs their repository to
  // be ready for it: Continuity applies the patch, it does not commit, push or
  // resolve conflicts on their behalf.
  // Applicare da soli è comodo solo se si può tornare indietro: prima di
  // scrivere nella cartella dell'utente si conserva com'erano i file toccati.
  proteggi(r: any, file: string[]) {
    // Un deposito per consegna, non per turno: applicando due volte nello stesso
    // turno il secondo salvataggio coprirebbe l'originale con i file già scritti.
    const deposito = join(
      r.dir,
      "annulla",
      `${r.turnNumber ?? 0}-${Date.now()}`,
    );
    const precedenti: { path: string; esisteva: boolean }[] = [];
    for (const nome of file) {
      const origine = join(r.project.root, nome);
      const esisteva = existsSync(origine) && lstatSync(origine).isFile();
      if (esisteva) {
        mkdirSync(dirname(join(deposito, nome)), { recursive: true });
        copyFileSync(origine, join(deposito, nome));
      }
      precedenti.push({ path: nome, esisteva });
    }
    r.annullabile = {
      deposito,
      file: precedenti,
      quando: new Date().toISOString(),
    };
  }
  annullaUltimo(id: string, opzioni: { forza?: boolean } = {}) {
    const r = this.run(id);
    if (!r.annullabile) throw Error("Non c'è niente da annullare");
    const { deposito, file, consegnato } = r.annullabile;
    const percorsi: string[] = file.map((v: any) => v.path);
    // Nessun ripristino passa da un collegamento simbolico (CT-016).
    controllaConfinamento(r.project.root, percorsi);
    controllaConfinamento(r.work, percorsi);
    // Ciò che /annulla sovrascriverebbe senza che sia opera di quella consegna:
    // un ritocco della persona — contenuto, permesso, o una cartella nuova al
    // posto di un file cancellato (CT-018, CT-020) — e il lavoro che l'AI ha
    // fatto dopo sugli stessi file e non è ancora consegnato (CT-017).
    const ritoccati = consegnato
      ? percorsi.filter(
          (p) =>
            p in consegnato &&
            diversoDalConsegnato(r.project.root, p, consegnato),
        )
      : [];
    const pendenti = consegnato
      ? percorsi.filter(
          (p) => p in consegnato && diversoDalConsegnato(r.work, p, consegnato),
        )
      : [];
    if (!opzioni.forza && (ritoccati.length || pendenti.length))
      throw Error(
        [
          ritoccati.length
            ? `${ritoccati.join(", ")} ${ritoccati.length === 1 ? "è stato modificato" : "sono stati modificati"} da te dopo la consegna`
            : "",
          pendenti.length
            ? `su ${pendenti.join(", ")} l'AI ha lavorato ancora, e quel lavoro non è ancora consegnato`
            : "",
        ]
          .filter(Boolean)
          .join("; ")
          .replace(/^/, "Non annullo: ") +
          ". «/annulla forza» annulla comunque, mettendo da parte quelle versioni.",
      );
    // Forzando, niente sparisce: le versioni sostituite vanno in una cartella
    // accanto al punto di ripristino, e il messaggio dice dove.
    let conservati: string | undefined;
    if (ritoccati.length || pendenti.length) {
      conservati = join(deposito, "..", `conservati-${Date.now()}`);
      for (const [radice, sotto, elenco] of [
        [r.project.root, "tua", ritoccati],
        [r.work, "copia", pendenti],
      ] as const)
        for (const p of elenco) {
          const origine = join(radice, p);
          if (!lstatOpzionale(origine)) continue;
          mkdirSync(dirname(join(conservati, sotto, p)), { recursive: true });
          cpSync(origine, join(conservati, sotto, p), {
            recursive: true,
            verbatimSymlinks: true,
          });
        }
    }
    // La versione dell'AI si mette da parte: /applica la rimette (prova di
    // Lorenzo del 19 ottobre, «/applica non funziona» dopo /annulla).
    const rifai = join(deposito, "..", `rifai-${Date.now()}`);
    const versioniAI = percorsi.map((p) => {
      const origine = join(r.work, p);
      const esisteva = existsSync(origine) && lstatSync(origine).isFile();
      if (esisteva) {
        mkdirSync(dirname(join(rifai, p)), { recursive: true });
        copyFileSync(origine, join(rifai, p));
      }
      return { path: p, esisteva };
    });
    ripristinaDeposito(r.project.root, r.annullabile);
    ripristinaDeposito(r.work, r.annullabile);
    r.rifacibile = { deposito: rifai, file: versioniAI };
    // La copia di lavoro riparte da qui per i soli file ripristinati: il
    // lavoro dell'AI non ancora consegnato resta in sospeso.
    this.fissaPercorsi(
      r,
      file.map((v: any) => v.path),
      "Ripristinato con /annulla",
    );
    this.checkpoint(r);
    const elenco = file.map((v: any) => v.path);
    r.consegnati = (r.consegnati ?? []).filter(
      (f: string) => !elenco.includes(f),
    );
    r.annullabile = undefined;
    this.annota(
      r,
      `L'utente ha annullato l'ultima consegna con /annulla: ${elenco.join(", ")} ${elenco.length === 1 ? "è tornato" : "sono tornati"} com'erano prima. Ciò che quella consegna aveva cambiato non è più nei file.`,
    );
    this.event(
      r,
      "work.undone",
      `Ripristinati: ${elenco.join(", ").slice(0, 200)}`,
    );
    return { ripristinati: elenco, conservati };
  }
  // Dopo aver portato il lavoro nella cartella, quel punto diventa il nuovo
  // riferimento: altrimenti i turni successivi rielencherebbero per sempre i
  // file già consegnati.
  // L'elenco di ciò che è finito nella cartella resta sulla run: dopo la
  // consegna la copia di lavoro torna pulita, quindi non c'è altro modo di
  // dire alla persona quali file la sessione ha toccato. Lo scrive chi
  // consegna, in entrambi i rami — con e senza Git nel progetto.
  ricordaConsegna(r: any, file: string[]) {
    r.consegnati = [...new Set([...(r.consegnati ?? []), ...file])].slice(-200);
  }
  // La base della copia di lavoro avanza solo per i percorsi indicati: quelli
  // davvero consegnati o ripristinati. Prima si fissava tutto con «git add
  // -A», e il lavoro dell'AI non ancora consegnato — un turno fallito, un
  // conflitto, un collegamento simbolico — diventava base e non arrivava più.
  fissaPercorsi(r: any, percorsi: string[], messaggio: string) {
    if (!percorsi.length) return;
    const ambiente = {
      ...ambienteGit(r.work),
      // I nomi sono percorsi, non schemi: «*» o «:» nei nomi restano letterali.
      GIT_LITERAL_PATHSPECS: "1",
    };
    const git = (args: string[], input?: string) =>
      execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
        cwd: r.work,
        input,
        encoding: "utf8",
        env: ambiente,
        stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      });
    // Ciò che esiste si aggiunge; ciò che non esiste più si toglie dall'indice.
    // «git add» rifiuta un percorso che non trova da nessuna parte.
    const presenti = percorsi.filter((p) => lstatOpzionale(join(r.work, p)));
    const assenti = percorsi.filter((p) => !presenti.includes(p));
    if (presenti.length)
      git(
        // -f: un file consegnato da una cartella ignorata entra comunque nella
        // base, così non viene riconsegnato se la persona lo elimina.
        ["add", "-A", "-f", "--pathspec-from-file=-", "--pathspec-file-nul"],
        presenti.join("\u0000") + "\u0000",
      );
    if (assenti.length)
      git(
        [
          "rm",
          "-r",
          "-q",
          "--cached",
          "--ignore-unmatch",
          "--pathspec-from-file=-",
          "--pathspec-file-nul",
        ],
        assenti.join("\u0000") + "\u0000",
      );
    git([
      "-c",
      "user.name=Continuity",
      "-c",
      "user.email=continuity@localhost",
      "commit",
      "--allow-empty",
      "-qm",
      messaggio,
    ]);
  }

  // Porta il lavoro dell'AI nella cartella della persona: tutto o niente. Un
  // conflitto con una modifica fatta nel frattempo blocca l'intera consegna,
  // a meno che la persona non chieda di forzare (la sua versione resta
  // recuperabile con /annulla).
  applyToProject(id: string, opzioni: { forza?: boolean } = {}) {
    const r = this.run(id);
    // Dopo /annulla, se nella copia non c'è altro da consegnare: la versione
    // dell'AI messa da parte torna nella copia, e si consegna quella.
    if (
      r.rifacibile &&
      r.project &&
      !this.children.has(id) &&
      !pianoConsegna(r.work, r.project.root, daConsegnare, opzioni.forza).operazioni.length
    ) {
      const rifai = r.rifacibile;
      r.rifacibile = undefined;
      ripristinaDeposito(r.work, rifai);
    }
    return this.consegna(id, opzioni);
  }
  private consegna(id: string, opzioni: { forza?: boolean } = {}) {
    const r = this.run(id);
    if (!r.project) throw Error("La run non lavora su un progetto");
    if (this.children.has(id))
      throw Error(
        "Un agente sta ancora lavorando: attendere la fine del turno",
      );
    const piano = pianoConsegna(
      r.work,
      r.project.root,
      daConsegnare,
      opzioni.forza,
    );
    // Un percorso che esce dal progetto non si scrive, nemmeno forzando.
    if (piano.bloccati.length)
      controllaConfinamento(r.project.root, piano.bloccati);
    // Un conflitto può essere un file cambiato dalla persona nello stesso
    // punto o un file che la persona ha eliminato mentre l'AI lo modificava:
    // dire «modificato» per un file sparito confondeva (prova del 8 ottobre).
    const eliminatiDaTe = piano.conflitti.filter(
      (p) => !lstatOpzionale(join(r.project.root, p)),
    );
    const cambiatiDaTe = piano.conflitti.filter(
      (p) => !eliminatiDaTe.includes(p),
    );
    const motivi = [
      cambiatiDaTe.length
        ? `${cambiatiDaTe.join(", ")} ${cambiatiDaTe.length === 1 ? "è stato modificato" : "sono stati modificati"} anche da te nello stesso punto`
        : "",
      eliminatiDaTe.length
        ? `${eliminatiDaTe.join(", ")} ${eliminatiDaTe.length === 1 ? "è stato eliminato" : "sono stati eliminati"} da te, mentre l'AI ${eliminatiDaTe.length === 1 ? "lo modificava" : "li modificava"}`
        : "",
    ].filter(Boolean);
    if (piano.conflitti.length) {
      this.annota(
        r,
        `Consegna bloccata: ${motivi
          .join("; ")
          .replace(/anche da te/, "anche dall'utente")
          .replace(
            /da te,/,
            "dall'utente,",
          )}. Nella cartella dell'utente è rimasta la sua versione, non quella dell'AI.`,
      );
      this.event(
        r,
        "work.conflict",
        `Conflitto su ${piano.conflitti.join(", ")}`,
      );
      throw Error(
        `Le modifiche non si applicano: ${motivi.join("; ")}. ` +
          "La tua cartella non è stata toccata e il lavoro dell'AI resta nella copia: " +
          (eliminatiDaTe.length && !cambiatiDaTe.length
            ? "«/applica forza» li ricrea con la versione dell'AI, e /annulla li toglie di nuovo."
            : "«/applica forza» lo porta comunque, e /annulla ti ridà la tua versione."),
      );
    }
    if (!piano.operazioni.length) {
      // Il lavoro coincide già con la cartella: si allinea la base, perché il
      // turno dopo non veda queste differenze come nuove.
      allineaPermessi(r.work, r.project.root, piano.allineati);
      this.fissaPercorsi(
        r,
        piano.allineati,
        "Già uguale nella cartella dell'utente",
      );
      return {
        applicati: [],
        eliminati: [],
        saltati: piano.saltati,
        messaggio: "Nessuna modifica da applicare",
      };
    }
    const percorsi = piano.operazioni.map((op) => op.path);
    r.rifacibile = undefined;
    this.proteggi(r, percorsi);
    // Ciò che viene consegnato, per sapere poi se /annulla cancellerebbe
    // ritocchi fatti dalla persona dopo la consegna.
    r.annullabile.consegnato = Object.fromEntries(
      piano.operazioni.map((op) => [op.path, statoVoce(op.finale, op.mode)]),
    );
    // Il ripristino va registrato prima di scrivere: se la consegna fallisce a
    // metà è proprio allora che serve poter tornare indietro.
    this.event(r, "undo.ready", "Punto di ripristino salvato");
    try {
      eseguiPiano(r.work, r.project.root, piano);
    } catch (e) {
      // Una consegna fallita a metà non lascia la cartella mezza scritta: si
      // rimette com'era prima, dal punto di ripristino appena salvato. Se il
      // ripristino stesso non è sicuro non si fa, e lo si dice: il punto di
      // ripristino resta disponibile.
      let ripristino = "";
      try {
        ripristinaDeposito(r.project.root, r.annullabile);
        r.annullabile = undefined;
        ripristino =
          "La tua cartella è stata rimessa com'era; il lavoro resta nella copia.";
      } catch (errore) {
        ripristino = `Non ho potuto rimettere la cartella com'era (${errore instanceof Error ? errore.message : String(errore)}). Le tue versioni sono salvate in ${r.annullabile.deposito}.`;
      }
      this.event(
        r,
        "work.apply_failed",
        `Consegna non riuscita. ${ripristino}`.slice(0, 600),
      );
      throw Error(
        `${e instanceof Error ? e.message : String(e)}. ${ripristino}`,
      );
    }
    // Solo dopo il controllo dei contenuti la base avanza, e solo per ciò che
    // è stato consegnato.
    allineaPermessi(r.work, r.project.root, piano.allineati);
    this.fissaPercorsi(
      r,
      [...percorsi, ...piano.allineati],
      "Consegnato nella cartella dell'utente",
    );
    const eliminati = piano.operazioni
      .filter((op) => op.finale === null)
      .map((op) => op.path);
    const applicati = piano.operazioni
      .filter((op) => op.finale !== null)
      .map((op) => op.path);
    const uniti = piano.operazioni
      .filter((op) => op.unito)
      .map((op) => op.path);
    const forzati = piano.operazioni
      .filter((op) => op.forzato)
      .map((op) => op.path);
    if (forzati.length)
      this.annota(
        r,
        `Su richiesta dell'utente (/applica forza) la versione dell'AI ha sostituito le sue modifiche in: ${forzati.join(", ")}.`,
      );
    if (uniti.length)
      this.annota(
        r,
        `In ${uniti.join(", ")} le modifiche dell'AI sono state unite a modifiche fatte a mano dall'utente nel frattempo: rileggi questi file prima di cambiarli.`,
      );
    this.ricordaConsegna(r, applicati);
    r.eliminatiConsegnati = [
      ...new Set([...(r.eliminatiConsegnati ?? []), ...eliminati]),
    ].filter((f: string) => !applicati.includes(f));
    this.event(
      r,
      "work.applied",
      [
        applicati.length
          ? `File portati nella cartella: ${applicati.join(", ")}`
          : "",
        eliminati.length ? `eliminati: ${eliminati.join(", ")}` : "",
        uniti.length ? `uniti alle tue modifiche: ${uniti.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join(" · ")
        .slice(0, 600),
    );
    return {
      applicati,
      eliminati,
      uniti,
      saltati: piano.saltati,
      messaggio: r.project.senzaGit
        ? "Copiati nella tua cartella: controlla il risultato"
        : "Applicate nel tuo progetto, non committate: controlla con git diff",
    };
  }
  async closeSession(id: string, opzioni: { forza?: boolean } = {}) {
    const r = this.run(id);
    if (!r.session) throw Error("La run non è una sessione");
    if (terminal.includes(r.state)) return this.run(id);
    // Un turno che si sta chiudendo (verifica, consegna) va lasciato finire:
    // smontare la copia sotto i suoi piedi perdeva il lavoro del turno.
    if (this.busy.has(id) || this.avviiTurno.has(id))
      throw Error("Un'operazione è in corso sulla sessione: riprova fra poco");
    // Chiudere non deve lasciare dietro di sé un writer rimasto da un crash:
    // continuerebbe a scrivere in una copia che nessuno segue più.
    await this.assicuraNessunWriter(r);
    this.busy.add(id);
    try {
      // Fermare e fotografare serve solo se qualcuno stava scrivendo: su una
      // sessione mai usata era un passaggio di stato illegale, e la chiusura
      // falliva in silenzio lasciandola aperta per sempre.
      if (this.children.has(id)) {
        if (!opzioni.forza)
          throw Error(
            "Un'AI sta lavorando: interrompi il turno prima di chiudere la sessione",
          );
        await this.quiesce(r);
        this.checkpoint(r);
      }
      // La chiusura smonta la copia di lavoro: ciò che non è arrivato nella
      // cartella della persona sparirebbe con lei. Si chiude solo dopo averlo
      // detto; con «forza» quei file vengono prima messi da parte.
      const nonConsegnati = r.project ? this.changedFiles(r) : [];
      let conservati: string | undefined;
      if (nonConsegnati.length) {
        if (!opzioni.forza)
          throw Error(
            `Ci sono ${nonConsegnati.length} file non ancora consegnati nella tua cartella (${nonConsegnati.slice(0, 5).join(", ")}${nonConsegnati.length > 5 ? ", …" : ""}). /applica per portarli, oppure /chiudi forza: verranno conservati a parte`,
          );
        conservati = join(
          r.dir,
          "non-consegnati-" + new Date().toISOString().replace(/[:.]/g, "-"),
        );
        for (const percorso of nonConsegnati) {
          const da = join(r.work, percorso);
          if (!lstatOpzionale(da)) continue;
          mkdirSync(dirname(join(conservati, percorso)), { recursive: true });
          cpSync(da, join(conservati, percorso), {
            recursive: true,
            verbatimSymlinks: true,
          });
        }
      }
      r.state = "CANCELLED";
      this.event(
        r,
        "session.closed",
        `Sessione chiusa dopo ${r.turnNumber ?? 0} turni` +
          (conservati
            ? ` · file non consegnati conservati in ${conservati}`
            : ""),
      );
      this.smontaWorktree(r);
      return this.run(id);
    } finally {
      this.busy.delete(id);
    }
  }
  // «fallito»: il turno si è chiuso per un errore del provider o un'uscita
  // anomala. Non è una conclusione: chi segue il turno non deve consegnare un
  // lavoro a metà come se fosse finito (collaudo del 3 ottobre, CT-002).
  async endTurn(id: string, note?: string, fallito?: boolean) {
    if (this.busy.has(id)) return;
    this.busy.add(id);
    try {
      const r = this.run(id);
      const esitoFallito =
        fallito ?? Boolean(r.providerError || r.uscitaFallita);
      await this.quiesce(r);
      this.checkpoint(r);
      // Un passo che doveva solo leggere e ha scritto lo stesso: si rimette
      // la copia com'era all'inizio del passo, e lo si dice.
      if (r.passoSoloLettura) {
        r.passoSoloLettura = false;
        if (r.impronataInizioTurno && r.snapshotId !== r.impronataInizioTurno) {
          const toccati = ripristinaSulPosto(r.dir, r.impronataInizioTurno, r.work, Boolean(r.project));
          this.checkpoint(r);
          this.event(
            r,
            "flow.readonly_violation",
            `${r.agent} doveva solo leggere ma ha cambiato ${toccati.length === 1 ? "1 file" : `${toccati.length} file`} (${toccati.slice(0, 5).join(", ")}): li ho rimessi com'erano`,
          );
        }
      }
      // Un turno interrotto non ha prodotto nulla da verificare: annunciarne
      // l'esito farebbe sembrare che qualcosa sia andato a buon fine.
      if (r.project && !r.providerError && !r.uscitaFallita)
        await this.verifyProject(r);
      r.state = "PAUSED";
      // Un turno che non ha cambiato un solo file non è un turno svolto: le
      // verifiche passano sulla base di partenza e sembrerebbe tutto a posto.
      const senzaModifiche =
        r.impronataInizioTurno !== undefined &&
        r.impronataInizioTurno === r.snapshotId;
      const esito = senzaModifiche
        ? "nessun file modificato"
        : r.checks?.length
          ? `${r.checks.filter((c: any) => c.passed).length}/${r.checks.length} criteri`
          : "nessuna verifica";
      r.ultimoTurnoFallito = esitoFallito;
      if (esitoFallito)
        this.annota(
          r,
          `Il turno si è interrotto per un errore (${(note ?? "motivo non disponibile").slice(0, 200)}): niente è stato consegnato nella cartella dell'utente.`,
        );
      this.event(
        r,
        esitoFallito ? "turn.failed" : "turn.completed",
        esitoFallito
          ? `${note ?? "Turno interrotto"} · la tua cartella non è stata toccata. Ciò che l'AI ha scritto resta nella copia di lavoro: il prossimo turno riparte da lì e lo consegnerà insieme al resto, oppure /applica lo porta subito`
          : (note ??
              `Turno ${r.turnNumber ?? 1} concluso da ${r.agent} · ${esito}`),
      );
      // Un turno fatto da Ollama: a fine turno il modello lascia la memoria.
      if (r.agent === PROVIDER_IBRIDO) void this.liberaModelloLocale();
      // Il revisore guarda le modifiche di questo turno, prima che la
      // consegna le porti nella cartella (dopo non sarebbero più differenze).
      // Un turno di revisione finito: i suggerimenti o le correzioni, poi la
      // prossima revisione in coda. Non rivede sé stesso.
      const revisione = r.revisioneATurno;
      if (revisione) {
        r.revisioneATurno = undefined;
        this.esitoRevisioneATurno(id, r, revisione, esitoFallito, note);
      }
      // Durante un flusso rivede chi ha il ruolo nel flusso, non anche il
      // revisore di sempre (due revisioni delle stesse modifiche).
      if (!revisione && !esitoFallito && !senzaModifiche && r.project && !r.esecuzione) {
        let diff: Differenze | undefined;
        try {
          diff = differenze(r.work, Infinity);
        } catch {}
        // Senza diff (Git guasto) la revisione prova da sé e, se non può, lo dice.
        try {
          this.avviaRevisioni(id, "fine", diff);
        } catch {}
      }
      // Il passo di un flusso è finito: il prossimo parte appena il turno è
      // chiuso del tutto.
      if (r.esecuzione) setImmediate(() => void this.dopoTurnoDiFlusso(id, esitoFallito, note));
      else if ((this.run(id).codaRevisioni ?? []).length) setImmediate(() => void this.prossimaRevisioneATurno(id));
    } catch (e) {
      this.block(id, e);
    } finally {
      this.busy.delete(id);
    }
  }
  // Un evento del provider che il motore non è riuscito a elaborare. Prima
  // spariva in silenzio: è il meccanismo che aveva nascosto la regressione del
  // 27 settembre. Ora resta scritto, e un segnale di limite al suo interno
  // viene riconosciuto comunque, perché il passaggio all'altra AI non dipenda
  // dal buon esito del resto del gestore.
  eventoNonElaborato(r: any, errore: unknown, value: unknown) {
    const motivo = errore instanceof Error ? errore.message : String(errore);
    try {
      const v: any = value ?? {};
      const livelloProvider = [
        "result",
        "error",
        "turn.failed",
        "stream_error",
        "rate_limit_event",
      ].includes(v.type);
      const quota =
        livelloProvider &&
        (v.type === "rate_limit_event"
          ? ["rejected", "exceeded"].includes(v.rate_limit_info?.status)
          : quotaSuErrore(JSON.stringify(v).slice(0, 20000)));
      const current = this.run(r.id);
      if (quota && current.session && !current.quotaDetected) {
        current.quotaDetected = true;
        this.event(
          current,
          "agent.reported",
          `${r.agent} ha dichiarato il limite; passaggio al successore`,
          r.agent,
        );
      }
      this.event(
        current,
        "engine.warning",
        `Un evento di ${r.agent} non è stato elaborato (${motivo.slice(0, 160)}): il lavoro continua`,
        r.agent,
      );
    } catch (e) {
      // Se non si riesce nemmeno a registrarlo, resta almeno nel log del
      // servizio.
      console.error(
        "Evento non elaborato:",
        motivo,
        "· registrazione fallita:",
        e instanceof Error ? e.message : String(e),
      );
    }
  }
  // Le verifiche si fissavano alla nascita della sessione. Ma una cartella
  // cambia: il 1° ottobre l'AI ha creato package.json con uno script di test,
  // e la sessione — nata quando non c'erano test — non li ha mai eseguiti,
  // mentre ogni rapporto finale diceva «test non eseguiti». Alla ripresa si
  // adottano le verifiche che la cartella dichiara adesso.
  aggiornaVerifiche(
    id: string,
    verify: { id: string; label?: string; command: string[] }[],
    commandsDigest: string,
  ) {
    const r = this.run(id);
    if (!r.project) throw Error("La run non lavora su un progetto");
    if (this.children.has(id) || this.busy.has(id))
      throw Error("Un turno è in corso: le verifiche si aggiornano alla fine");
    if (r.project.commandsDigest === commandsDigest) return r;
    r.project.verify = verify;
    r.project.commandsDigest = commandsDigest;
    r.criteria = verify.map((v) => ({ id: v.id, description: v.label }));
    // Gli esiti vecchi riguardavano altri comandi: non valgono più.
    r.checks = [];
    this.event(
      r,
      "verification.updated",
      verify.length
        ? `Verifiche aggiornate dalla cartella: ${verify.map((v) => v.label ?? v.command.join(" ")).join(", ")}`
        : "La cartella non dichiara più verifiche",
    );
    return this.run(id);
  }
  // Il processo del tentativo precedente, se ne resta traccia: il pid salvato
  // nella run o nella ricevuta scritta al momento dell'avvio.
  processoPrecedente(
    r: any,
  ): { pid: number; binario?: string; avviatoAlle?: string } | null {
    let ricevuta: any = {};
    if (r.attemptId)
      try {
        ricevuta = JSON.parse(readFileSync(this.ricevuta(r), "utf8"));
      } catch {}
    // Un tentativo fermato in modo pulito non ha più un processo da cercare:
    // ricontrollare il suo pid giorni dopo voleva dire trovarci un programma
    // qualsiasi, e fermarlo o bloccarsi.
    if (ricevuta.status === "stopped") return null;
    // Il pid della run c'è finché il processo non è stato fermato. Quello
    // della sola ricevuta conta se il servizio è caduto durante l'avvio.
    const pid = Number.isSafeInteger(r.pid)
      ? r.pid
      : (r.state === "STARTING" || r.statoPrimaDelRiavvio === "STARTING") &&
          Number.isSafeInteger(ricevuta.pid)
        ? ricevuta.pid
        : undefined;
    return pid === undefined
      ? null
      : { pid, binario: ricevuta.binary, avviatoAlle: ricevuta.at };
  }
  ricevuta(r: any) {
    return join(r.dir, "attempt-" + r.attemptId + ".json");
  }
  // Il processo del tentativo è fermo: lo si annota nella ricevuta.
  chiudiRicevuta(r: any) {
    if (!r.attemptId) return;
    try {
      const percorso = this.ricevuta(r);
      const ricevuta = JSON.parse(readFileSync(percorso, "utf8"));
      atomic(
        percorso,
        JSON.stringify({
          ...ricevuta,
          status: "stopped",
          stoppedAt: new Date().toISOString(),
        }),
      );
    } catch {}
  }
  // Prima di qualunque ripartenza il writer precedente deve risultare fermo.
  // Dopo un crash del servizio la mappa dei figli è vuota, ma il provider può
  // essere ancora vivo e scrivere nella copia: avviarne un secondo voleva dire
  // due writer sugli stessi file (collaudo del 3 ottobre, CT-001). Se è
  // nostro lo si ferma; se non si può stabilire, si resta bloccati.
  async assicuraNessunWriter(r: any) {
    if (this.children.has(r.id)) return;
    const precedente = this.processoPrecedente(r);
    if (!precedente) return;
    const chi = () =>
      identificaGruppo(
        precedente.pid,
        precedente.binario,
        precedente.avviatoAlle,
      );
    const prima = chi();
    if (prima === "fermo" || prima === "altro") {
      this.chiudiRicevuta(r);
      return;
    }
    if (prima === "incerto")
      throw Error(
        `Non riesco a stabilire se il processo del turno precedente (pid ${precedente.pid}) è ancora vivo: per non avere due AI sugli stessi file la sessione resta bloccata. Controlla con «ps -p ${precedente.pid}».`,
      );
    let esito: ReturnType<typeof chi> = prima;
    for (const segnale of ["SIGTERM", "SIGKILL"] as const) {
      try {
        process.kill(-precedente.pid, segnale);
      } catch {}
      for (let i = 0; i < 50; i++) {
        await new Promise((ok) => setTimeout(ok, 40));
        esito = chi();
        if (esito === "fermo" || esito === "altro") break;
      }
      if (esito === "fermo" || esito === "altro") break;
    }
    // Solo un arresto provato libera la sessione: anche «incerto» la blocca.
    if (esito !== "fermo" && esito !== "altro")
      throw Error(
        `Il processo del turno precedente (pid ${precedente.pid}) non risulta fermo: la sessione resta bloccata per non avere due AI sugli stessi file.`,
      );
    this.chiudiRicevuta(r);
    this.event(
      this.run(r.id),
      "recovery.orphan_stopped",
      `Fermato il processo rimasto dal turno precedente (pid ${precedente.pid}): ora c'è un solo writer`,
    );
  }

  // I connettori della sessione: tutti quelli delle piattaforme ufficiali,
  // tranne quelli che la persona ha spento con /connettori. Solo per le
  // sessioni live su un progetto.
  async connettoriSessione(r: any, aggiorna = false) {
    if (!r.session || !r.project || r.mode !== "live")
      return {
        attivi: [] as Connettore[],
        spenti: [] as Connettore[],
        elenco: [] as Connettore[],
      };
    // Ogni AI che ha un lettore di connettori, con il CLI che Continuity
    // userebbe per lei.
    const binari: Record<string, string | undefined> = {};
    for (const ai of Object.keys(LETTORI))
      try {
        binari[ai] = resolveProvider(ai as any, this.store.root).path;
      } catch {}
    const elenco = await scopriConnettori(binari, aggiorna);
    const spentiId = new Set<string>(r.connettoriSpenti ?? []);
    return {
      elenco,
      attivi: elenco.filter(
        (c) => !spentiId.has(c.id) && c.stato !== "da autorizzare",
      ),
      spenti: elenco.filter((c) => spentiId.has(c.id)),
    };
  }
  impostaConnettori(id: string, spenti: string[]) {
    const r = this.run(id);
    if (!r.session) throw Error("La run non è una sessione");
    if (this.children.has(id))
      throw Error("Un turno è in corso: i connettori cambiano dal prossimo");
    r.connettoriSpenti = [...new Set(spenti)];
    this.event(
      r,
      "connectors.updated",
      spenti.length
        ? `Connettori spenti: ${spenti.map((s) => s.replace(/^(claude|codex):(plugin:|mcp:)?/, "")).join(", ")}`
        : "Tutti i connettori accesi",
    );
    return this.run(id);
  }
  // Un commit o un cambio di ramo dell'AI nella copia sposterebbe la base da
  // cui Continuity calcola cosa consegnare, e il lavoro sparirebbe dalla
  // consegna. Si riporta la copia al punto di partenza del turno lasciando i
  // file come l'AI li ha lasciati.
  ripristinaGitCopia(r: any) {
    const prima = r.gitInizioTurno;
    r.gitInizioTurno = undefined;
    if (!prima) return;
    const ora = statoGitCopia(r.work);
    if (!ora || (ora.head === prima.head && ora.ramo === prima.ramo)) return;
    try {
      if (prima.ramo && ora.ramo !== prima.ramo)
        gitCopia(r.work, ["symbolic-ref", "HEAD", prima.ramo]);
      gitCopia(r.work, ["reset", "-q", prima.head]);
      this.annota(
        r,
        "L'AI aveva cambiato la storia Git della copia di lavoro (commit o cambio di ramo): Continuity l'ha riportata al punto di partenza del turno, con i file così come l'AI li ha lasciati.",
      );
      this.event(
        r,
        "work.git_restored",
        "Storia Git della copia riportata al punto di partenza del turno",
      );
    } catch (e) {
      this.event(
        r,
        "work.git_restore_failed",
        "Non sono riuscito a riportare la storia Git della copia: " +
          String(e instanceof Error ? e.message : e).slice(0, 200),
      );
    }
  }
  // L'AI scrive nella copia, e nella copia c'è Git: una sua configurazione
  // (core.fsmonitor, un filtro, un pager, un «include») farebbe eseguire a
  // Continuity — fuori da ogni sandbox — un comando scelto da lei, al primo
  // git diff o git add. Si ripristina ciò che Continuity ha creato:
  //  - copia di un repository: il file .git che punta al worktree;
  //  - copia senza Git: la configurazione minima e nessun rinvio altrove.
  proteggiGitCopia(r: any) {
    const punto = join(r.work, ".git");
    let stato: import("node:fs").Stats | undefined;
    try {
      stato = lstatSync(punto);
    } catch {}
    if (r.project?.senzaGit) {
      if (!stato?.isDirectory())
        throw Error(
          "La cartella Git interna della copia è stata sostituita: per sicurezza non eseguo comandi Git su di essa",
        );
      writeFileSync(join(punto, "config"), CONFIG_GIT_COPIA);
      for (const rinvio of [
        "commondir",
        "gitdir",
        "config.worktree",
        "objects/info/alternates",
      ])
        rmSync(join(punto, rinvio), { force: true });
      return;
    }
    const atteso: string | undefined = r.puntatoreGit;
    const attuale = stato?.isFile() ? readFileSync(punto, "utf8") : undefined;
    if (atteso) {
      if (attuale !== atteso) {
        rmSync(punto, { recursive: true, force: true });
        writeFileSync(punto, atteso);
      }
      return;
    }
    // Sessioni create prima di questa protezione: il rinvio deve portare
    // dentro i worktree del repository della persona.
    const verso = /^gitdir: (.+)\s*$/.exec(attuale ?? "")?.[1];
    const radice = r.project?.root
      ? join(r.project.root, ".git", "worktrees")
      : "";
    if (!verso || !radice || !resolve(r.work, verso).startsWith(radice + "/"))
      throw Error(
        "Il collegamento Git della copia di lavoro non è quello creato da Continuity: per sicurezza non eseguo comandi Git su di essa",
      );
  }
  allineaAllaPersona(r: any) {
    try {
      const cambi = cambiamentiDellaPersona(
        r.work,
        r.project.root,
        daConsegnare,
        fileDellaPersona(r.project.root, Boolean(r.project.senzaGit)),
      );
      if (!cambi.length) return;
      for (const c of cambi) {
        const dove = join(r.work, c.path);
        if (c.contenuto === null) rmSync(dove, { force: true });
        else {
          mkdirSync(dirname(dove), { recursive: true });
          writeFileSync(dove, c.contenuto);
          try {
            chmodSync(
              dove,
              lstatSync(join(r.project.root, c.path)).mode & 0o777,
            );
          } catch {}
        }
      }
      const percorsi = cambi.map((c) => c.path);
      this.fissaPercorsi(
        r,
        percorsi,
        "Allineato ai cambiamenti fatti nella cartella dell'utente",
      );
      const aggiunti = cambi
        .filter((c) => c.contenuto !== null)
        .map((c) => c.path);
      const tolti = cambi
        .filter((c) => c.contenuto === null)
        .map((c) => c.path);
      const elenca = (x: string[]) =>
        x.slice(0, 30).join(", ") +
        (x.length > 30 ? ` e altri ${x.length - 30}` : "");
      this.annota(
        r,
        "Dall'ultima consegna la persona ha cambiato la sua cartella, e la copia di lavoro è stata allineata: " +
          [
            aggiunti.length ? `nuovi o modificati ${elenca(aggiunti)}` : "",
            tolti.length ? `eliminati ${elenca(tolti)}` : "",
          ]
            .filter(Boolean)
            .join("; ") +
          ".",
      );
      this.event(
        r,
        "work.synced",
        `Copia allineata alla tua cartella: ${cambi.length} file`,
      );
    } catch (e) {
      // Non è un motivo per non lavorare: l'AI vede la copia com'era.
      this.event(
        r,
        "engine.warning",
        "Non sono riuscito ad allineare la copia alla tua cartella: " +
          String(e instanceof Error ? e.message : e).slice(0, 200),
      );
    }
  }
  // «Massimo» per Codex: max se il modello lo supporta (dal catalogo),
  // altrimenti xhigh. Gli altri livelli seguono la tabella fissa.
  // Consumo per provider, e costo stimato per chi si paga a consumo: token del
  // provider per i prezzi del catalogo. Gli abbonamenti hanno solo i token.
  // Nessun tetto: decide la persona, Continuity mostra.
  registraConsumo(
    r: any,
    provider: string,
    modello: string | undefined,
    uso: { entrata: number; uscita: number; cache?: number },
  ): number | undefined {
    const voce = (r.consumi ?? {})[provider] ?? {
      entrata: 0,
      uscita: 0,
      cache: 0,
    };
    voce.entrata += uso.entrata;
    voce.uscita += uso.uscita;
    voce.cache += uso.cache ?? 0;
    const profilo = providerNoto(provider);
    let costo: number | undefined;
    if (profilo?.accesso === "chiave") {
      const prezzi = prezziDi(this.catalogoModelli, profilo.catalogo, modello);
      if (prezzi) {
        costo = costoStimato(uso, prezzi);
        voce.costo = (voce.costo ?? 0) + costo;
      } else voce.costoIgnoto = true;
    }
    r.consumi = { ...(r.consumi ?? {}), [provider]: voce };
    return costo;
  }
  sforzoCodex(r: any): string | undefined {
    if (r.agent !== "codex") return undefined;
    if (
      ((r.ragionamento ?? {}).codex ?? RAGIONAMENTO_PREDEFINITO) !== "massimo"
    )
      return undefined;
    const elenco = this.modelliDisponibili().codex;
    const scelto = (r.modelli ?? {}).codex;
    const livelli = scelto
      ? elenco.find((m) => m.nome === scelto)?.livelli
      : elenco.every((m) => m.livelli?.includes("max"))
        ? ["max"]
        : undefined;
    return livelli?.includes("max") ? "max" : "xhigh";
  }
  // Dove si pubblica un progetto e se lo si fa da sé dopo ogni consegna.
  // Sta fra i dati di Continuity, non nel progetto: un file nel progetto lo
  // potrebbe cambiare l'AI, e con lui il repository dove finiscono i push.
  // Vale per il progetto, non per la sessione: chiusa una sessione, la
  // scelta resta.
  private fileGithub() {
    return join(this.store.root, "github-progetti.json");
  }
  private chiaveProgetto(r: any) {
    return cartellaCanonica(String(r.project?.root ?? ""));
  }
  githubDelProgetto(r: any): { destinazione?: string; automatica?: boolean } {
    if (!r.project) return {};
    try {
      const tutti = JSON.parse(readFileSync(this.fileGithub(), "utf8"));
      // Le chiavi scritte prima avevano le maiuscole come le aveva digitate
      // la persona: si riconoscono comunque.
      const voce =
        tutti?.[this.chiaveProgetto(r)] ??
        Object.entries(tutti ?? {}).find(([chiave]) =>
          stessaCartella(chiave, r.project.root),
        )?.[1];
      return {
        destinazione:
          typeof voce?.destinazione === "string"
            ? voce.destinazione
            : undefined,
        automatica:
          typeof voce?.automatica === "boolean" ? voce.automatica : undefined,
      };
    } catch {
      return {};
    }
  }
  private salvaGithubDelProgetto(
    r: any,
    modifica: { destinazione?: string; automatica?: boolean },
  ) {
    let tutti: Record<string, any> = {};
    try {
      tutti = JSON.parse(readFileSync(this.fileGithub(), "utf8")) ?? {};
    } catch {}
    const chiave = this.chiaveProgetto(r);
    const vecchia = Object.keys(tutti).find(
      (k) => k !== chiave && stessaCartella(k, r.project.root),
    );
    const prima = tutti[chiave] ?? (vecchia ? tutti[vecchia] : undefined);
    if (vecchia) delete tutti[vecchia];
    tutti[chiave] = { ...(prima ?? {}), ...modifica };
    atomic(this.fileGithub(), JSON.stringify(tutti, null, 2));
  }
  impostazioneGithub(id: string) {
    const r = this.run(id);
    const salvata = this.githubDelProgetto(r);
    return {
      destinazione: r.github?.destinazione ?? salvata.destinazione,
      automatica: salvata.automatica,
    };
  }
  impostaPubblicazioneAutomatica(id: string, attiva: boolean) {
    const r = this.run(id);
    if (!r.project)
      throw Error("La pubblicazione vale per una sessione su un progetto");
    this.salvaGithubDelProgetto(r, { automatica: attiva });
    this.event(
      r,
      "publish.settings",
      attiva
        ? "Pubblicazione automatica su GitHub attivata: dopo ogni consegna"
        : "Pubblicazione automatica su GitHub disattivata",
    );
    return this.impostazioneGithub(id);
  }
  // /pubblica, prima fase: che cosa cambierebbe su GitHub. Nessuna scrittura
  // sul remoto e nessuna nella cartella della persona.
  anteprimaPubblicazione(id: string, destinazione?: string) {
    const r = this.run(id);
    if (!r.session || !r.project)
      throw Error("La pubblicazione vale per una sessione su un progetto");
    if (this.children.has(id) || this.busy.has(id))
      throw Error("Un turno è in corso: pubblica quando ha finito");
    const dest = destinazione?.trim()
      ? risolviDestinazione(destinazione)
      : (r.github?.destinazione ?? this.githubDelProgetto(r).destinazione);
    if (!dest)
      throw Error(
        "Dimmi dove pubblicare: /pubblica utente/repository (per esempio /pubblica tuonome/sito)",
      );
    const anteprima = preparaPubblicazione(
      r.project.root,
      dest,
      join(r.dir, "pubblica"),
    );
    r.github = { destinazione: dest };
    r.anteprimaPubblicazione = anteprima;
    this.event(
      r,
      "publish.preview",
      `Anteprima della pubblicazione su ${dest}: ${anteprima.aggiunti.length} nuovi, ${anteprima.modificati.length} modificati, ${anteprima.eliminati.length} eliminati`,
    );
    return { ...anteprima, nonConsegnati: this.changedFiles(r) };
  }
  // Seconda fase, dopo il «sì» della persona: si rifà l'anteprima e si
  // pubblica solo se coincide con quella confermata.
  pubblica(id: string, piano: string, forza = false) {
    const r = this.run(id);
    const confermata = r.anteprimaPubblicazione;
    if (!r.project || !confermata || confermata.piano !== piano)
      throw Error("L'anteprima non è più valida: ripeti /pubblica");
    if (this.children.has(id) || this.busy.has(id))
      throw Error("Un turno è in corso: pubblica quando ha finito");
    const cartella = join(r.dir, "pubblica");
    const fresca = preparaPubblicazione(
      r.project.root,
      confermata.destinazione,
      cartella,
    );
    if (fresca.piano !== piano)
      throw Error(
        "La tua cartella o GitHub sono cambiati dopo l'anteprima: ripeti /pubblica per vedere la versione aggiornata",
      );
    if (fresca.sospetti.length && !forza)
      throw Error(
        `Possibili segreti in ${fresca.sospetti.join(", ")}: controllali prima di pubblicare`,
      );
    const titolo = String(r.request ?? "")
      .split("\n")[0]
      .slice(0, 60)
      .trim();
    // Chi ha scritto o controllato il codice, in fondo al commit: la
    // trasparenza chiesta dall'AI Act (ricerca legale del 28 ottobre).
    const nomi = new Set<string>();
    for (const t of r.transcript ?? [])
      if (t.role === "ai" && t.agent) nomi.add(providerNoto(String(t.agent)) ? nomeCorto(String(t.agent)) : String(t.agent).split(" · ")[0]);
    for (const x of r.suggerimenti ?? []) if (x.da) nomi.add(String(x.da).split(" · ").at(-2) ?? String(x.da).split(" · ")[0]);
    const conAI = nomi.size ? `\n\nCodice scritto o controllato con l'aiuto di AI, tramite Continuity: ${[...nomi].join(", ")}.` : "";
    const esito = eseguiPubblicazione(
      cartella,
      fresca,
      (titolo ? `Continuity: ${titolo}` : "Aggiornamento da Continuity") + conAI,
    );
    rmSync(cartella, { recursive: true, force: true });
    r.anteprimaPubblicazione = undefined;
    const url = indirizzoWeb(fresca.destinazione, esito.commit);
    this.salvaGithubDelProgetto(r, { destinazione: fresca.destinazione });
    if (!esito.gia)
      this.annota(
        r,
        `La persona ha pubblicato la sua cartella su GitHub (${fresca.destinazione}, ramo ${fresca.ramo}${esito.commit ? ", commit " + esito.commit.slice(0, 10) : ""}).`,
      );
    this.event(
      r,
      "publish.completed",
      esito.gia
        ? `Su ${fresca.destinazione} era già tutto aggiornato`
        : `Pubblicato su ${fresca.destinazione} (${fresca.ramo})${url ? " · " + url : ""}`,
    );
    return {
      ...esito,
      url,
      ramo: fresca.ramo,
      automatica: this.githubDelProgetto(r).automatica,
    };
  }
  impostaRagionamento(id: string, provider: string, livello: string) {
    const r = this.run(id);
    if (!r.session) throw Error("La run non è una sessione");
    if (!providerNoto(provider))
      throw Error("Livello di ragionamento non regolabile per " + provider);
    provider = providerNoto(provider)!.id;
    if (!["basso", "medio", "alto", "massimo"].includes(livello))
      throw Error("Livello sconosciuto: " + livello);
    r.ragionamento = {
      ...(r.ragionamento ?? {}),
      [provider]: livello as Ragionamento,
    };
    this.event(
      r,
      "reasoning.changed",
      `Ragionamento di ${provider}: ${livello}`,
    );
    return this.run(id);
  }
  checkpoint(r: any) {
    const s = snapshot(r.work, r.dir, Boolean(r.project));
    r.snapshots.push({
      id: s.id,
      createdAt: new Date().toISOString(),
      files: s.manifest.files.length,
      excludedPaths: s.manifest.excludedPaths,
    });
    r.snapshotId = s.id;
    this.event(
      r,
      "snapshot.completed",
      "Checkpoint " + s.id.slice(0, 10) + " · integrità verificata",
    );
    return s;
  }
  async start(r: any) {
    // Il testo mostrato appartiene al tentativo che comincia adesso: tenendo
    // quello dei turni precedenti, la sessione li ristampava tutti da capo.
    this.parziali.delete(r.id);
    this.attivita?.delete(r.id);
    // I connettori si chiedono prima di tutto il resto: l'attesa non deve
    // cadere fra il controllo «un solo writer» e l'avvio.
    // Il provider del registro decide programma, credenziale e servizio. I
    // connettori delle piattaforme appartengono agli abbonamenti.
    const profilo: ProviderNoto | undefined = providerNoto(r.agent);
    const motore = motoreDi(r.agent);
    const connettori =
      profilo && profilo.accesso !== "abbonamento"
        ? { attivi: [], spenti: [] }
        : await this.connettoriSessione(r);
    if (profilo?.catalogo) void this.assicuraCatalogo();
    if (this.children.size) throw Error("Writer già attivo");
    // Anche le ripartenze che non passano da turn() — rotazione, ripresa
    // automatica — non devono affiancare un writer sopravvissuto a un crash.
    await this.assicuraNessunWriter(r);
    r.state = "STARTING";
    r.attemptId = randomUUID();
    this.event(
      r,
      "attempt.start_requested",
      "Intent persistito: avvio " +
        r.agent +
        (r.mode === "live" ? " reale" : " simulato"),
    );
    // Sui progetti l'AI lavora a pieno: la sua sessione nativa si riprende
    // finché esiste, il ragionamento è quello scelto (alto se nessuno l'ha
    // scelto) e i pacchetti si installano in una cache di Continuity.
    const piena =
      r.mode === "live" &&
      r.project &&
      r.session &&
      (motore === "codex" || motore === "claude");
    // Codex fuori dall'abbonamento lavora in una cartella propria: le sue
    // sessioni (e quelle dei sotto-agenti) stanno lì.
    const cartellaCodex =
      motore === "codex" && profilo && profilo.accesso !== "abbonamento"
        ? cartellaCodexProvider(this.store.root, profilo.id)
        : undefined;
    const nativa = piena ? (r.sessioniNative ?? {})[r.agent] : undefined;
    const riprendi =
      nativa?.id && sessioneNativaEsiste(motore, nativa.id, cartellaCodex)
        ? (nativa.id as string)
        : undefined;
    const cache = piena ? cartellaCache(this.store.root) : undefined;
    // Da qui in poi le voci della conversazione sono nuove per questa AI.
    if (piena)
      r.sessioniNative = {
        ...(r.sessioniNative ?? {}),
        [r.agent]: {
          id: riprendi,
          inizio: new Date().toISOString(),
          // Riprendendo la stessa sessione, l'ultimo totale d'uso visto: i
          // contatori di Codex sono cumulativi sulla sessione (CT-2.0-002).
          ...(riprendi && nativa?.id === riprendi && nativa?.usoCumulato
            ? { usoCumulato: nativa.usoCumulato }
            : {}),
        },
      };
    if (r.project) r.gitInizioTurno = statoGitCopia(r.work);
    r.avviatoAlle = new Date().toISOString();
    // Ollama nella sequenza («/ordine claude, ollama»): senza un modello scelto
    // con /modello usa quello dell'AI ibrida (qwen3.5:4b), che è scaricato,
    // e si avvia da solo se è spento (richiesta di Lorenzo del 19 ottobre).
    if (r.mode === "live" && r.agent === PROVIDER_IBRIDO) {
      if (!(r.modelli ?? {})[PROVIDER_IBRIDO])
        r.modelli = { ...(r.modelli ?? {}), [PROVIDER_IBRIDO]: leggiIbrida(this.store.root).modello };
      if (!(await assicuraOllama()))
        throw Error("Ollama non si è avviato: aprilo dal Launchpad, poi riprova");
    }
    let modello =
      (r.modelli ?? {})[r.agent] ?? profilo?.modelloPredefinito;
    // Un servizio gratuito: il ponte, il modello consigliato che c'è e il
    // catalogo per Codex (Fase 4).
    let viaPonte: { indirizzo: string; catalogo: string } | undefined;
    let gettonePonte: string | undefined;
    if (r.mode === "live" && profilo?.motore === "diretto" && motore === "codex") {
      const ponte = await this.assicuraPonte();
      if (!modello) {
        const elenco = (await this.modelliGratuitiDi(profilo.id)).map((m) => m.id);
        // Prima il modello che ha già risposto davvero per questo servizio.
        const buono = this.modelloBuono.get(profilo.id);
        modello = buono && elenco.includes(buono) ? buono : inOrdine(profilo, elenco)[0];
        if (!modello) throw Error(`${nomeServizio(profilo)}: nessun modello gratuito disponibile in questo momento`);
      }
      const codex = resolveProvider("codex", this.store.root);
      const base = voceDiBase(codex.path, codex.version ?? "sconosciuta", this.store.root);
      viaPonte = {
        indirizzo: ponte.indirizzo(profilo.id),
        catalogo: scriviCatalogo(base, cartellaCodexProvider(this.store.root, profilo.id), profilo, modello),
      };
      gettonePonte = ponte.gettone;
    }
    if (r.mode === "live" && profilo?.modelloObbligatorio && !modello)
      throw Error(
        `Per ${profilo.id} serve un modello: scegline uno con «/modello ${profilo.id} <nome>»`,
      );
    const command =
      r.mode === "live"
        ? liveCommand(
            motore as any,
            r.work,
            r.dir,
            this.store.root,
            r.project ? "project" : "fixture",
            modello,
            connettori,
            piena
              ? {
                  // Solo se la persona l'ha scelto: altrimenti vale quello
                  // della configurazione del CLI. Forzare «alto» rendeva
                  // Codex più lento che da solo (Lorenzo lo tiene a «low»).
                  ragionamento: (r.ragionamento ?? {})[r.agent],
                  riprendi,
                  cache,
                  sforzo: this.sforzoCodex(r),
                  agenti: leggiAgenti(r.work),
                  cartellaAgenti: join(r.dir, "agenti-codex"),
                  profilo,
                  ponte: viaPonte,
                  // Il passo di un flusso che legge soltanto (Fase 3).
                  soloLettura: Boolean(r.passoSoloLettura),
                  permessi: r.session && r.project
                    ? {
                        run: r.id,
                        servizio: join(this.store.root, "service.json"),
                        codexConsentito: r.permessoAttivo?.ai === "codex",
                      }
                    : undefined,
                }
              : { profilo, ponte: viaPonte },
          )
        : {
            binary: process.execPath,
            args: [
              worker,
              r.agent,
              ...(r.agent !== "codex" ? [join(r.dir, "handoff.json")] : []),
              ...(r.project ? ["--no-fixture-edit"] : []),
            ],
          };
    // Nelle sessioni si controlla solo il provider che sta per lavorare: chi
    // usa una chiave non deve avere per forza anche gli abbonamenti.
    let chiave: string | undefined;
    if (r.mode === "live" && r.session && profilo)
      chiave = requisitiProvider(profilo, this.store.root, this.chiavi);
    else if (r.mode === "live")
      requireSubscriptions(r.successor ?? "claude", this.store.root);
    // Prima di lanciare Claude: impostazioni personali che lo porterebbero
    // altrove (chiave, indirizzo, provider cloud) fermano il turno.
    if (r.mode === "live" && motore === "claude") controllaAbbonamentoClaude();
    r.checks = r.checks.map((c: any) => ({ ...c, status: "stale" }));
    const child = launch(
      command.binary,
      command.args,
      r.work,
      join(r.dir, "attempt-" + r.attemptId + ".json"),
      r.mode === "live"
        ? {
            env:
              r.agent === "antigravity"
                ? antigravityEnvironment(this.store.root)
                : r.agent === "gemini"
                  ? geminiEnvironment(
                      this.store.root,
                      r.work,
                      subscriptionEnvironment(),
                    )
                  : {
                      ...subscriptionEnvironment(),
                      ...(cache ? ambienteCache(cache) : {}),
                      ...ambienteProvider(profilo, chiave, this.store.root, gettonePonte),
                    },
            prompt: (() => {
              // Riprendendo la sessione nativa basta ciò che l'AI non ha
              // visto: le voci successive al suo ultimo turno, tranne le sue.
              const nuove = riprendi
                ? (r.transcript ?? []).filter(
                    (t: any) =>
                      t.at > (nativa?.inizio ?? "") &&
                      !(t.role === "ai" && t.agent === r.agent),
                  )
                : undefined;
              const altraAI = nuove?.some(
                (t: any) => t.role === "ai" && t.agent !== r.agent,
              );
              const text = r.project
                ? projectPrompt({
                    lingua: this.linguaPer(r, [this.richiesteIntere.get(r.id) ?? r.request ?? ""]),
                    role: riprendi
                      ? altraAI
                        ? "successor"
                        : "writer"
                      : r.session && (r.triedThisTurn?.length ?? 1) > 1
                        ? "successor"
                        : r.agent === "codex"
                          ? "writer"
                          : "successor",
                    ripresa: Boolean(riprendi),
                    goal: r.goal,
                    transcript: nuove ?? r.transcript,
                    request: this.richiesteIntere.get(r.id) ?? r.request,
                    originale: r.project?.root,
                    allegati: r.allegatiTurno ?? r.allegati,
                    suggerimenti: r.suggerimentiTurno,
                    allegatiPrecedenti: (r.allegatiPrecedenti ?? []).filter(
                      (x: string) => !(r.allegatiTurno ?? []).includes(x),
                    ),
                    connettori: connettori.attivi
                      .filter((c) => c.ai === r.agent)
                      .map((c) => c.nome),
                    agenti: leggiAgenti(r.work).map((a) => ({
                      nome: a.nome,
                      descrizione: a.descrizione,
                    })),
                    pubblicazioneAutomatica: (() => {
                      const g = this.githubDelProgetto(r);
                      return Boolean(g.automatica && g.destinazione)
                        ? g.destinazione
                        : undefined;
                    })(),
                    work: r.work,
                    criteria: r.checks?.length
                      ? r.checks
                      : r.criteria.map((c: any) => ({
                          id: c.id,
                          label: c.description,
                        })),
                    handoff: r.handoff,
                  })
                : livePrompt(r.agent, r.handoff, r.work);
              return r.agent === "antigravity" ? antigravityInput(text) : text;
            })(),
          }
        : {},
    );
    this.children.set(r.id, child);
    r.pid = child.pid;
    r.state = "RUNNING";
    this.event(
      r,
      "attempt.started",
      r.agent + (r.mode === "live" ? " reale avviato" : " simulato avviato"),
    );
    const antigravity = new AntigravityStream();
    // I sotto-agenti di Codex si vedono solo nei loro file di sessione: li si
    // segue finché il processo vive, e un'ultima volta alla chiusura.
    const figli =
      r.mode === "live" && motore === "codex" && r.project
        ? new FigliCodex(
            Date.now(),
            (testo) => this.event(this.run(r.id), "agent.action", testo, r.agent),
            cartellaCodex ? join(cartellaCodex, "sessions") : undefined,
          )
        : undefined;
    const sguardo = figli
      ? setInterval(() => {
          if (figli.scansiona()) vivo();
        }, 1500)
      : undefined;
    let usoCoordinatore: { entrata: number; uscita: number } | undefined;
    let ultimoErrore: string | undefined;
    const parser = new JsonLines(
      (value) => {
        // La sessione nativa dell'AI, per riprenderla al turno dopo.
        const idNativo =
          motore === "codex" && (value as any)?.type === "thread.started"
            ? (value as any).thread_id
            : motore === "claude" &&
                (value as any)?.type === "system" &&
                (value as any)?.subtype === "init"
              ? (value as any).session_id
              : undefined;
        if (
          piena &&
          typeof idNativo === "string" &&
          /^[A-Za-z0-9][\w-]{7,79}$/.test(idNativo)
        ) {
          const current = this.run(r.id);
          const prima = (current.sessioniNative ?? {})[r.agent] ?? {};
          if (prima.id !== idNativo) {
            current.sessioniNative = {
              ...(current.sessioniNative ?? {}),
              [r.agent]: { ...prima, id: idNativo },
            };
            this.event(
              current,
              "agent.native_session",
              `Sessione nativa di ${r.agent}: ${idNativo}`,
            );
          }
        }
        const e =
          r.mode === "live"
            ? r.agent === "antigravity"
              ? antigravity.receive(value)
              : normalizedLiveEvent(motore, value, profilo?.fontiClaude)
            : (value as any);
        if (e.type === "quota") {
          const current = this.run(r.id);
          const giaDetto = current.quotaDetected;
          current.quotaDetected = true;
          if (creditoEsaurito(String(e.text ?? ""))) current.creditoFinito = true;
          // Un provider può dichiarare il limite più volte: solo il primo segnale
          // porta l'orario esatto, e un secondo senza orario non deve cancellarlo.
          const ricarica = (e as any).ricaricaA ?? current.ricaricaA;
          // Una volta sola a schermo: Claude lo dichiara nello stream, nel
          // risultato e nel messaggio, e la stessa riga compariva tre volte.
          if (giaDetto && ricarica === current.ricaricaA) return;
          current.ricaricaA = ricarica;
          // Un servizio gratuito attraverso il ponte: Codex dice «Codex ha
          // esaurito la quota dell'abbonamento», ma la quota è del servizio
          // (28 ottobre, Google).
          const gratuito = profilo?.motore === "diretto" ? providerNoto(r.agent) : undefined;
          const testoQuota = gratuito
            ? String(e.text).replace(/^Codex ha esaurito la quota dell'abbonamento/, `${nomeServizio(gratuito)} ha esaurito la quota del piano gratuito`)
            : String(e.text);
          this.event(
            current,
            giaDetto ? "agent.quota_time" : "agent.reported",
            testoQuota.slice(0, 20000),
            r.agent,
          );
          return;
        }
        // I frammenti restano in memoria: sono migliaia per risposta e nel registro
        // degli eventi lo farebbero crescere senza motivo.
        // Il consumo dichiarato dal provider: si somma per la sessione e si dice,
        // perché è l'unico costo misurabile del lavoro.
        if (e.type === "uso" && (e as any).uso) {
          const r2 = this.run(r.id);
          let uso = (e as any).uso;
          if ((e as any).cumulativo) {
            const voce = (r2.sessioniNative ?? {})[r.agent] ?? {};
            uso = differenzaUso(uso, voce.usoCumulato);
            r2.sessioniNative = {
              ...(r2.sessioniNative ?? {}),
              [r.agent]: { ...voce, usoCumulato: (e as any).uso },
            };
          }
          usoCoordinatore = uso;
          r2.uso = {
            entrata: (r2.uso?.entrata ?? 0) + uso.entrata,
            uscita: (r2.uso?.uscita ?? 0) + uso.uscita,
            cache: (r2.uso?.cache ?? 0) + (uso.cache ?? 0),
          };
          const costo = this.registraConsumo(r2, r.agent, modello, uso);
          this.event(
            r2,
            "usage.reported",
            `${uso.entrata.toLocaleString("it-IT")} token in ingresso · ${uso.uscita.toLocaleString("it-IT")} in uscita` +
              (costo !== undefined ? ` · circa ${dollari(costo)}` : ""),
            r.agent,
          );
          return;
        }
        if (e.type === "thread") {
          if (figli) figli.padre = String(e.text);
          return;
        }
        if (e.type === "permesso") {
          const attuale = this.run(r.id);
          attuale.permessiNegati = [
            ...new Set([...(attuale.permessiNegati ?? []), String(e.text)]),
          ];
          this.event(
            attuale,
            "permission.blocked",
            `${r.agent} voleva usare ${e.text}: bloccato finché non lo consenti`,
            r.agent,
          );
          return;
        }
        if (e.type === "pensiero") {
          this.event(this.run(r.id), "agent.thinking", String(e.text).slice(0, 300), r.agent);
          return;
        }
        if (e.type === "attivita") {
          this.attivita?.set(r.id, String(e.text).slice(0, 200));
          return;
        }
        if (e.type === "parziale") {
          const testo = String(e.text ?? "");
          if (testo)
            this.parziali.set(r.id, (this.parziali.get(r.id) ?? "") + testo);
          return;
        }
        if (e.type === "azione") {
          this.attivita?.delete(r.id);
          this.ultimaAzione.set(r.id, String(e.text).replace(/\s+/g, " ").trim().slice(0, 120));
          this.event(
            this.run(r.id),
            "agent.action",
            String(e.text).slice(0, 300),
            r.agent,
          );
          return;
        }
        if (
          e.type === "message" ||
          e.type === "reported" ||
          e.type === "error"
        ) {
          const current = this.run(r.id);
          if (e.model) current.model = e.model;
          if (e.type === "error") {
            current.providerError = true;
            current.motivoErrore = String(e.text ?? "").slice(0, 300);
            if (/non può usare questo modello/.test(current.motivoErrore))
              this.segnaModelloNonDisponibile(
                r.agent,
                (current.modelli ?? {})[r.agent],
              );
          }
          // Anche ciò che risponde l'AI fa parte del filo: senza, chi subentra
          // vede solo le richieste dell'utente e non cosa è stato risposto.
          if (e.type === "message" && current.session)
            this.remember(current, "ai", String(e.text), r.agent);
          // Il messaggio è completo: il testo in diretta che lo componeva ha
          // finito il suo compito. Tenerlo nel buffer faceva ristampare la coda
          // di un blocco concluso davanti al blocco successivo, e il resoconto
          // finale compariva due volte.
          if (e.type === "message") this.parziali.delete(r.id);
          // Codex manda lo stesso errore due volte (evento e fine del turno):
          // lo si mostra una volta sola.
          const ripetuto = e.type === "error" && ultimoErrore === String(e.text);
          if (e.type === "error") ultimoErrore = String(e.text);
          if (!ripetuto) this.event(
            current,
            e.type === "error"
              ? "agent.error"
              : e.type === "reported"
                ? "agent.reported"
                : "agent.message",
            String(e.text).slice(0, 20000),
            r.agent,
          );
          // Una credenziale a consumo al posto dell'abbonamento: il processo
          // si ferma qui, prima di spendere; l'errore chiude il turno.
          if (e.type === "error" && (e as any).fermare)
            try {
              process.kill(-child.pid!, "SIGTERM");
            } catch {}
        }
      },
      (errore, value) => this.eventoNonElaborato(r, errore, value),
    );
    child.stdout!.setEncoding("utf8");
    child.stdout!.on("data", (c: string) => {
      vivo();
      // Un guasto nella lettura non è un motivo per buttare il lavoro dell'AI:
      // si registra e si continua a leggere.
      try {
        parser.push(c);
      } catch (e) {
        this.eventoNonElaborato(r, e, undefined);
      }
    });
    let stderrTail = "";
    child.stderr!.setEncoding("utf8");
    child.stderr!.on("data", (chunk: string) => {
      vivo();
      stderrTail = (stderrTail + chunk).slice(-8192);
    });
    child.on("error", () => {
      const current = this.run(r.id);
      current.state = "BLOCKED";
      current.error = "Avvio processo fallito";
      this.event(current, "run.blocked", current.error);
    });
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    let silenzio: ReturnType<typeof setInterval> | undefined;
    let revisione: ReturnType<typeof setInterval> | undefined;
    // Qualunque segno di vita azzera il conto: output del provider, errori,
    // lavoro dei sotto-agenti.
    let ultimaAttivita = Date.now();
    let segnalato = false;
    const vivo = () => {
      ultimaAttivita = Date.now();
      segnalato = false;
      this.ultimoSegno.set(r.id, ultimaAttivita);
    };
    this.ultimoSegno.set(r.id, ultimaAttivita);
    this.ultimaAzione.delete(r.id);
    let observer: ReturnType<typeof setInterval> | undefined;
    const interrupt = () => {
      if (this.busy.has(r.id) || this.children.get(r.id) !== child) return;
      const current = this.run(r.id);
      if (
        current.quotaDetected &&
        !current.session &&
        current.agent === "codex" &&
        current.switches === 0
      ) {
        if (observer) clearInterval(observer);
        void this.action(r.id, "switch").catch((e) => this.block(r.id, e));
        return;
      }
      if (current.providerError) {
        void this.failLive(
          r.id,
          "Il provider ha segnalato un errore non classificato; nessuno switch automatico",
        );
        return;
      }
      // The fixture switches as soon as the writer touches the file. A real
      // project has no such marker: there the switch comes from quota or from a
      // person asking for it.
      if (
        !r.project &&
        readFileSync(join(r.work, "cart.mjs"), "utf8") !==
          "export function total(items) { return 0; }\n"
      ) {
        if (observer) clearInterval(observer);
        void this.action(r.id, "switch").catch((e) => this.block(r.id, e));
      }
    };
    if (r.mode === "live" && r.session) {
      // Il lavoro di una sessione non si interrompe per tempo: un turno lungo,
      // con o senza sotto-agenti, va portato in fondo, perché interromperlo
      // renderebbe inutile tutto ciò che è stato fatto prima. Il guardiano
      // osserva soltanto: se l'AI resta del tutto muta a lungo — niente
      // output, niente lavoro dei sotto-agenti — lo dice alla persona, che
      // decide. Non ferma mai nulla da solo.
      // Il revisore non parte più durante il turno (decisione di Lorenzo del
      // 28 ottobre): rivede a fine turno, ogni N turni.
      silenzio = setInterval(() => {
        const muto = Date.now() - ultimaAttivita;
        if (muto < SILENZIO_DA_SEGNALARE || segnalato) return;
        segnalato = true;
        this.event(
          this.run(r.id),
          "turn.silent",
          `${r.agent} non dà segni di attività da ${Math.round(muto / 60000)} minuti. Non lo interrompo: se pensi che sia bloccato, puoi fermarlo con «continuity cancel --run ${r.id}» da un altro terminale.`,
          r.agent,
        );
      }, 60000);
    } else if (r.mode === "live") {
      const limit = 120000;
      watchdog = setTimeout(() => {
        void this.failLive(r.id, "Timeout della prova live (120 s per agente)");
      }, limit);
      if (r.agent === "codex" && !r.project)
        observer = setInterval(interrupt, 250);
    }
    child.on("close", (code, signal) => {
      parser.end();
      if (sguardo) clearInterval(sguardo);
      try {
        figli?.scansiona();
        const perFiglio = figli?.consumoPerFiglio();
        if (perFiglio && perFiglio.size > 0) {
          const r2 = this.run(r.id);
          // Ogni figlio dichiara il totale della sua sessione: se la stessa
          // sessione torna in un turno dopo, conta solo la differenza.
          const visti: Record<string, any> = { ...(r2.usoFigli ?? {}) };
          const deiFigli = { entrata: 0, uscita: 0, cache: 0, figli: perFiglio.size };
          for (const [sessione, totale] of perFiglio) {
            const d = differenzaUso(totale, sessione ? visti[sessione] : undefined);
            deiFigli.entrata += d.entrata;
            deiFigli.uscita += d.uscita;
            deiFigli.cache += d.cache ?? 0;
            if (sessione) visti[sessione] = totale;
          }
          r2.usoFigli = visti;
          // Anche i consumi per provider comprendono i sotto-agenti, e il
          // totale non perde la cache (collaudo del 16 ottobre, CT-2.0-003).
          r2.uso = {
            entrata: (r2.uso?.entrata ?? 0) + deiFigli.entrata,
            uscita: (r2.uso?.uscita ?? 0) + deiFigli.uscita,
            cache: (r2.uso?.cache ?? 0) + deiFigli.cache,
          };
          this.registraConsumo(r2, r.agent, modello, {
            entrata: deiFigli.entrata,
            uscita: deiFigli.uscita,
            cache: deiFigli.cache,
          });
          const entrata = (usoCoordinatore?.entrata ?? 0) + deiFigli.entrata;
          const uscita = (usoCoordinatore?.uscita ?? 0) + deiFigli.uscita;
          this.event(
            r2,
            "usage.reported",
            `${entrata.toLocaleString("it-IT")} token in ingresso · ${uscita.toLocaleString("it-IT")} in uscita · di cui ${deiFigli.figli} sotto-agenti: ${deiFigli.entrata.toLocaleString("it-IT")} in · ${deiFigli.uscita.toLocaleString("it-IT")} out`,
            r.agent,
          );
        }
      } catch {}
      if (watchdog) clearTimeout(watchdog);
      if (silenzio) clearInterval(silenzio);
      if (revisione) clearInterval(revisione);
      if (observer) clearInterval(observer);
      if (this.children.get(r.id) !== child || this.busy.has(r.id)) return;
      if (r.mode === "live" && r.agent === "antigravity" && antigravity.end()) {
        const current = this.run(r.id);
        current.providerError = true;
        this.event(
          current,
          "agent.error",
          "Stream Antigravity incompleto o fallito",
          r.agent,
        );
      }
      if (r.mode === "live") {
        const current = this.run(r.id);
        current.processExit = {
          code,
          signal,
          agent: r.agent,
          attemptId: r.attemptId,
        };
        this.event(
          current,
          "attempt.exited",
          `${r.agent}: exit ${code}, segnale ${signal ?? "nessuno"}`,
          r.agent,
        );
        // Quota is the expected end of the writer's turn, not an anomalous exit.
        // A session handles it further down, by rotating to the next provider.
        if (!r.session && r.agent === "codex" && this.run(r.id).quotaDetected) {
          interrupt();
          return;
        }
        const failure = liveExitFailure(r.agent, code, signal, stderrTail);
        if (failure && !r.session) {
          void this.failLive(r.id, failure);
          return;
        }
        // Un'uscita con errore non è un turno concluso: dirlo «concluso»
        // farebbe credere che il lavoro sia stato fatto.
        // Alcuni CLI dichiarano il limite su stderr invece che nello stream:
        // ignorarlo faceva sembrare concluso un turno mai iniziato.
        // Solo con un'uscita in errore: con uscita 0 lo stderr contiene log e
        // avvisi, non la fine dei crediti.
        if (
          r.session &&
          code !== 0 &&
          !this.run(r.id).quotaDetected &&
          quotaSuErrore(String(stderrTail ?? ""))
        ) {
          const attuale = this.run(r.id);
          attuale.quotaDetected = true;
          this.event(
            attuale,
            "agent.reported",
            `${r.agent} ha dichiarato il limite sull'uscita di errore; passaggio al successore`,
            r.agent,
          );
        }
        if (
          r.session &&
          code !== 0 &&
          !this.run(r.id).quotaDetected &&
          this.run(r.id).uscitaFallita === undefined
        ) {
          // Il valore va scritto sull'oggetto persistito: assegnarlo a una copia
          // letta al volo lo faceva sparire prima di essere usato.
          const attuale = this.run(r.id);
          attuale.uscitaFallita =
            `${r.agent} si è interrotto (uscita ${code})` +
            (stderrTail ? `: ${String(stderrTail).slice(0, 160)}` : "");
          this.event(attuale, "attempt.failed", attuale.uscitaFallita, r.agent);
        }
      }
      // La quota vince su tutto: quando è stata riconosciuta, il messaggio finale
      // del CLI può anche sembrare un errore qualsiasi, ma il lavoro deve
      // passare al successore. Invertire questa precedenza fermava la sessione
      // proprio nel caso per cui Continuity esiste.
      if (r.mode === "live" && this.run(r.id).quotaDetected && r.session) {
        void this.rotate(r.id, "Quota del provider esaurita");
        return;
      }
      if (r.mode === "live" && this.run(r.id).providerError) {
        // In una sessione l'errore riguarda il turno, non il lavoro: bloccare
        // tutto lasciava la persona senza via d'uscita, con la conversazione
        // e i file irraggiungibili.
        if (r.session) {
          void this.endTurn(
            r.id,
            "Turno interrotto · " +
              (this.run(r.id).motivoErrore ??
                `${r.agent} ha segnalato un errore`),
          );
          return;
        }
        void this.failLive(
          r.id,
          "Errore provider: nessun bypass o retry automatico",
        );
        return;
      }
      if (r.session) {
        const current = this.run(r.id);
        if (current.quotaDetected)
          void this.rotate(r.id, "Quota del provider esaurita");
        else if (current.providerError)
          void this.endTurn(
            r.id,
            "Turno interrotto: il provider ha segnalato un errore non classificato",
          );
        else if (current.uscitaFallita)
          void this.endTurn(r.id, `Turno interrotto: ${current.uscitaFallita}`);
        else void this.endTurn(r.id);
        return;
      }
      // On a project the writer finishing its turn is the normal ending: verify
      // what it produced. A switch belongs to quota, not to a clean exit.
      if (r.agent !== "codex" || r.project)
        void this.complete(r.id).catch((e) => this.block(r.id, e));
      else if (r.mode === "live") {
        interrupt();
        if (!this.busy.has(r.id))
          void this.failLive(
            r.id,
            "Codex terminato senza modifica osservabile",
          );
      }
    });
  }
  async failLive(id: string, message: string) {
    if (this.busy.has(id)) return;
    this.busy.add(id);
    try {
      const r = this.run(id);
      await this.quiesce(r);
      this.checkpoint(r);
      this.block(id, new Error(message));
    } catch (e) {
      this.block(id, e);
    } finally {
      this.busy.delete(id);
    }
  }

  block(id: string, e: unknown) {
    const r = this.run(id);
    if (terminal.includes(r.state)) return;
    r.state = "BLOCKED";
    r.error = e instanceof Error ? e.message : String(e);
    this.event(r, "run.blocked", r.error);
  }
  async quiesce(r: any) {
    // Un'azione in attesa del permesso non parte più: il turno si ferma.
    this.negaPermessiDi(r.id, "turno fermato");
    r.state = "QUIESCING";
    this.event(
      r,
      "stop.requested",
      "Arresto del writer e dei processi gestiti",
    );
    const child = this.children.get(r.id);
    if (child) {
      const { restano } = await stop(child);
      this.children.delete(r.id);
      if (restano.length)
        this.event(
          r,
          "engine.warning",
          `L'AI è ferma, ma ${restano.length === 1 ? "un processo che ha avviato non si è lasciato chiudere" : `${restano.length} processi che ha avviato non si sono lasciati chiudere`}: ${restano.slice(0, 5).join(", ")}. Se servono, chiudili da Monitoraggio Attività.`,
        );
    } else {
      if (!r.pid && r.attemptId) {
        const receiptPath = join(r.dir, "attempt-" + r.attemptId + ".json");
        if (!existsSync(receiptPath))
          throw Error(
            "Avvio precedente senza receipt: ownership incerta, riconciliazione manuale necessaria",
          );
        const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
        if (!Number.isSafeInteger(receipt.pid))
          throw Error("Receipt di avvio incompleto");
        r.pid = receipt.pid;
      }
      // Un writer sopravvissuto a un crash si ferma se è nostro; se la sua
      // identità è incerta la ripresa resta bloccata.
      if (r.pid && !fermo(r.pid)) await this.assicuraNessunWriter(r);
    }
    // Durante l'arresto (fino a qualche secondo) il lettore dello stream ha
    // salvato copie fresche della run: l'ultimo messaggio, il consumo, la
    // sessione nativa. L'oggetto ricevuto è di prima: salvarlo li cancellava.
    // Si riparte dalla versione salvata, mantenendo lo stato dell'arresto.
    const fresco = this.run(r.id);
    for (const k of Object.keys(r)) if (!(k in fresco)) delete r[k];
    Object.assign(r, fresco, { state: "QUIESCING" });
    this.chiudiRicevuta(r);
    r.pid = null;
    // Processi lanciati dall'AI in background e sopravvissuti al CLI.
    if (r.project && r.work) {
      const fermati = await fermaProcessiNellaCartella(
        r.work,
        r.avviatoAlle ? Date.parse(r.avviatoAlle) : undefined,
      );
      if (fermati.length) {
        this.annota(
          r,
          `Continuity ha fermato a fine turno ${fermati.length} processi lasciati attivi nella copia di lavoro (per esempio un server di prova).`,
        );
        this.event(
          r,
          "work.processes_stopped",
          `Fermati ${fermati.length} processi rimasti nella copia: ${fermati.join(", ")}`,
        );
      }
    }
    // Qui passano tutte le fini di turno (normale, errore, pausa, quota,
    // chiusura): l'AI è ferma e i file non sono ancora fotografati né
    // consegnati. Prima si rende sicuro Git della copia (Continuity ci esegue
    // comandi fuori dalla sandbox), poi se ne riporta la storia.
    if (r.project) {
      this.proteggiGitCopia(r);
      this.ripristinaGitCopia(r);
    }
    r.state = "SNAPSHOTTING";
    this.event(
      r,
      "writer.released",
      "Scritture dei processi gestiti arrestate",
    );
  }
  async verifyCode(r: any) {
    if (r.project) return await this.verifyProject(r);
    r.state = "VERIFYING";
    this.event(
      r,
      "verification.started",
      "Verifiche indipendenti sul checkpoint corrente",
    );
    const before = hash(JSON.stringify(inventory(r.work, Boolean(r.project))));
    let output = "",
      exitCode = 0;
    try {
      output = execFileSync(process.execPath, [checker], {
        cwd: r.work,
        encoding: "utf8",
        timeout: 120000,
        env: { PATH: process.env.PATH },
        maxBuffer: 1024 * 1024,
      });
    } catch (e: any) {
      output = String(e.stdout ?? "");
      exitCode = typeof e.status === "number" ? e.status : 1;
    }
    const after = hash(JSON.stringify(inventory(r.work, Boolean(r.project))));
    if (before !== after || before !== r.snapshotId)
      throw Error("Sorgenti modificate durante la verifica: evidenza obsoleta");
    let checks;
    try {
      checks = verificationResults.parse(JSON.parse(output));
    } catch {
      throw Error("Verificatore senza risultato valido");
    }
    r.checks = checks.map((c: any) => ({
      ...c,
      snapshotId: r.snapshotId,
      producer: "continuity",
      scope: "fixture/cart.mjs",
      observedAt: new Date().toISOString(),
      status: c.passed ? "passed" : "failed",
    }));
    const evidence = {
      id: randomUUID(),
      snapshotId: r.snapshotId,
      producer: "continuity",
      scope: "fixture/cart.mjs",
      observedAt: new Date().toISOString(),
      command: [process.execPath, checker],
      exitCode,
      checks: r.checks,
    };
    atomic(
      join(r.dir, "tests", evidence.id + ".json"),
      JSON.stringify(evidence, null, 2),
    );
    r.evidence = evidence;
    this.event(
      r,
      "verification.completed",
      `${checks.filter((x: any) => x.passed).length}/${checks.length} criteri verificati · exit ${exitCode}`,
    );
    return exitCode === 0 && checks.every((c: any) => c.passed);
  }
  // Each declared command is run by Continuity in the worktree; the exit code is
  // the verdict. The project does not report its own result: what an agent claims
  // never becomes a passing criterion.
  // «passaggio»: la verifica avviene perché un'AI cede il lavoro a un'altra,
  // non perché il turno è finito.
  async verifyProject(r: any, passaggio = false) {
    // Owns its own transition so every caller — turn, rotation, single run —
    // goes through the same state.
    r.state = "VERIFYING";
    this.event(
      r,
      "verification.started",
      "Verifiche indipendenti sul checkpoint corrente",
    );
    const before = hash(JSON.stringify(inventory(r.work, Boolean(r.project))));
    if (before !== r.snapshotId)
      throw Error("Sorgenti diverse dal checkpoint: evidenza obsoleta");
    if (
      commandsDigest({ verify: r.project.verify }) !== r.project.commandsDigest
    )
      throw Error("Comandi di verifica diversi da quelli approvati");
    const observedAt = new Date().toISOString();
    const casa = join(r.dir, "verify-home");
    mkdirSync(casa, { recursive: true });
    if (!r.project.verify.length) {
      r.checks = [];
      r.evidence = {
        id: randomUUID(),
        snapshotId: r.snapshotId,
        producer: "continuity",
        scope: r.projectId,
        observedAt,
        command: [],
        exitCode: null,
        checks: [],
        note: "Nessun criterio configurato: Continuity non dichiara alcun risultato verificato",
      };
      atomic(
        join(r.dir, "tests", r.evidence.id + ".json"),
        JSON.stringify(r.evidence, null, 2),
      );
      // A metà turno «giudica tu il risultato» faceva credere che il lavoro
      // fosse finito, proprio mentre stava passando all'altra AI.
      this.event(
        r,
        "verification.completed",
        passaggio
          ? "Stato salvato per il passaggio: nessuna verifica configurata"
          : "Nessuna verifica di Continuity: controlla tu il risultato",
      );
      return false;
    }
    // Le verifiche girano senza bloccare il servizio: con spawnSync un test
    // di qualche minuto lo rendeva muto, e il terminale lo credeva spento.
    const runs: any[] = [];
    for (const v of r.project.verify) {
      const result = await eseguiVerifica(v.command[0], v.command.slice(1), {
        cwd: r.work,
        // A home of its own: with HOME on the worktree, npm and friends wrote
        // their caches into the files under verification.
        env: { PATH: process.env.PATH, HOME: casa, LANG: "en_US.UTF-8" },
      });
      const code = result.error ? null : (result.status ?? null);
      runs.push({
        id: v.id,
        label: v.label,
        command: v.command,
        exitCode: code,
        passed: code === 0,
        detail: result.error
          ? "Comando non eseguibile"
          : code === 0
            ? "Uscita 0"
            : "Uscita " + code,
        // Senza i codici di colore, oscurata, solo per chi non è passato.
        coda:
          code === 0
            ? undefined
            : redact(result.coda)
                .replace(/\u001b\[[0-9;]*m/g, "")
                .trim()
                .slice(-3000),
      });
    }
    const after = hash(JSON.stringify(inventory(r.work, Boolean(r.project))));
    // Molti progetti veri modificano file mentre si verificano: formattatori,
    // generatori, hook di build. Non è una manomissione, ma l'esito si riferisce
    // allo stato precedente e va detto.
    const toccatiDallaVerifica = before !== after;
    r.checks = runs.map((c: any) => ({
      id: c.id,
      label: c.label,
      passed: c.passed,
      ...(c.coda ? { dettaglio: c.coda } : {}),
      snapshotId: r.snapshotId,
      producer: "continuity",
      scope: r.projectId,
      observedAt,
      status: c.passed ? "passed" : "failed",
    }));
    const exitCode = runs.every((c: any) => c.passed) ? 0 : 1;
    const evidence = {
      id: randomUUID(),
      snapshotId: r.snapshotId,
      producer: "continuity",
      scope: r.projectId,
      observedAt,
      command: runs.map((c: any) => c.command),
      exitCode,
      checks: r.checks,
      commandResults: runs.map(({ id, exitCode, detail }: any) => ({
        id,
        exitCode,
        detail,
      })),
      sorgentiToccateDaiComandi: toccatiDallaVerifica,
    };
    atomic(
      join(r.dir, "tests", evidence.id + ".json"),
      JSON.stringify(evidence, null, 2),
    );
    r.evidence = evidence;
    this.event(
      r,
      "verification.completed",
      `${runs.filter((c: any) => c.passed).length}/${runs.length} criteri verificati · ${runs.map((c: any) => c.id + ":" + (c.passed ? "ok" : "no")).join(" ")}` +
        (toccatiDallaVerifica
          ? " · i comandi hanno modificato dei file: l'esito vale per lo stato precedente"
          : ""),
    );
    return exitCode === 0;
  }
  // What the agent actually touched, not the whole tree: a real repository has
  // thousands of files and the successor needs the difference, not an inventory.
  // Righe aggiunte e tolte per file, per il blocco «Modifiche» della nuova
  // interfaccia: git diff --numstat nella copia, e le righe dei file nuovi.
  // Un errore qui non deve fermare nulla: senza numeri restano i nomi.
  statisticheModifiche(r: any): Record<string, { piu: number; meno: number }> {
    const fuori: Record<string, { piu: number; meno: number }> = {};
    const env = ambienteGit(r.work);
    try {
      const out = execFileSync(
        "git",
        ["-c", "core.hooksPath=/dev/null", "diff", "--numstat", "HEAD"],
        { cwd: r.work, encoding: "utf8", timeout: 30000, maxBuffer: 4 * 1024 * 1024, env },
      );
      for (const riga of out.split("\n").filter(Boolean)) {
        const [piu, meno, ...nome] = riga.split("\t");
        fuori[nome.join("\t")] = { piu: Number(piu) || 0, meno: Number(meno) || 0 };
      }
    } catch {}
    for (const file of this.changedFiles(r)) {
      if (fuori[file]) continue;
      try {
        const testo = readFileSync(join(r.work, file), "utf8");
        // L'a capo finale non è una riga in più.
        const righe = testo ? testo.split("\n").length - (testo.endsWith("\n") ? 1 : 0) : 0;
        fuori[file] = { piu: righe, meno: 0 };
      } catch {
        fuori[file] = { piu: 0, meno: 0 };
      }
    }
    return fuori;
  }
  changedFiles(r: any) {
    try {
      const out = execFileSync(
        "git",
        [
          "-c",
          "core.hooksPath=/dev/null",
          "status",
          "--porcelain=v1",
          "--untracked-files=all",
        ],
        {
          cwd: r.work,
          encoding: "utf8",
          timeout: 30000,
          maxBuffer: 4 * 1024 * 1024,
          env: ambienteGit(r.work),
        },
      );
      return out
        .split("\n")
        .filter(Boolean)
        .map((line) => line.slice(3).trim())
        .concat(
          r.project
            ? ignoratiDaConsegnare(r.work, r.project.root, daConsegnare)
            : [],
        )
        .filter(daConsegnare)
        .slice(0, 100);
    } catch {
      return [];
    }
  }
  // Everything the outgoing agent said about its own work, marked as a claim.
  // It is the only trace of its reasoning that survives: the model's memory does not.
  reportedByAgent(r: any) {
    return this.store
      .eventiRecenti(r.id, 120)
      .filter((e: any) => ["agent.message", "agent.reported"].includes(e.type))
      .slice(-12)
      .map((e: any) => ({
        agent: e.source,
        at: e.recordedAt,
        text: String(e.payload?.message ?? "").slice(0, 400),
        status: "dichiarato dall'agente, non verificato da Continuity",
      }));
  }
  handoff(r: any, toAgent?: string) {
    verify(r.dir, r.snapshotId);
    const rhp = {
      schemaVersion: "0.1.0",
      handoffId: randomUUID(),
      projectId: r.projectId,
      runId: r.id,
      taskId: r.taskId,
      fromAttemptId: r.attemptId,
      toAgent: toAgent ?? r.successor ?? "claude",
      createdAt: new Date().toISOString(),
      goal: r.goal,
      constraints: r.constraints ?? [],
      switch: {
        kind: "quota_exhausted",
        confidence: "confirmed",
        simulated: !r.quotaDetected,
        evidenceIds: [r.failureEvidenceId ?? r.id + ":" + r.version],
      },
      snapshot: {
        id: r.snapshotId,
        baseCommit: r.base,
        manifestSha256: r.snapshotId,
        manifestRef: "snapshots/" + r.snapshotId + ".json",
        integrity: "verified",
        excludedPaths: inventory(r.work, Boolean(r.project)).excludedPaths,
        changedFiles: this.changedFiles(r),
      },
      acceptance: r.checks,
      verified: r.checks.map((c: any) => ({
        claim: c.label,
        status: c.status,
        snapshotId: r.snapshotId,
        evidenceId: r.evidence.id,
      })),
      agentReported: this.reportedByAgent(r),
      decisions: [],
      nextActions: [
        ...r.checks
          .filter((c: any) => !c.passed)
          .map((c: any) => "Far passare il criterio: " + c.label),
        // Era rimasta la regola di prima della «piena potenza»: l'AI che
        // subentrava non rieseguiva build e test (prova del 10 ottobre).
        "Prova il lavoro tu stesso (build, test, avvio): Continuity ripete comunque le verifiche dichiarate dopo il turno",
      ],
      uncertainties: [
        "Il successore eredita obiettivo, file e verifiche: non la memoria interna del predecessore",
        ...(r.project
          ? []
          : ["Integrazione CLI reale non validata sulla fixture"]),
      ],
      interruptedActions: [],
      policy: r.policy,
      budget: { remaining: "unknown", remainingSwitches: 0 },
      artifacts: [
        {
          id: r.evidence.id,
          ref: "tests/" + r.evidence.id + ".json",
          sha256: hash(
            readFileSync(join(r.dir, "tests", r.evidence.id + ".json")),
          ),
        },
      ],
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    };
    validateHandoff(rhp, r.id, r.snapshotId);
    const text = JSON.stringify(rhp, null, 2);
    if (Buffer.byteLength(text) > 24576) throw Error("Handoff oltre il limite");
    atomic(join(r.dir, "handoff.json"), text);
    atomic(
      join(r.dir, "handoff.md"),
      `# Handoff (${r.mode === "live" ? "CLI reali, interruzione simulata" : "Simulazione"})\n\n${r.goal}\n\nSnapshot: ${r.snapshotId}\n\n${rhp.nextActions.join("\n")}\n`,
    );
    r.handoff = rhp;
    r.handoffDigest = hash(text);
    r.state = "HANDOFF_READY";
    this.event(
      r,
      "handoff.published",
      "RHP pubblicato senza richiedere un riassunto al writer uscente",
    );
  }
  async action(id: string, action: string): Promise<any> {
    if (this.busy.has(id)) {
      if (action !== "pause" && action !== "cancel")
        throw Error("Operazione già in corso");
      if (this.stopRequests.get(id) !== "cancel")
        this.stopRequests.set(id, action);
      for (let i = 0; i < 200 && this.busy.has(id); i++)
        await new Promise((r) => setTimeout(r, 25));
      if (this.busy.has(id))
        throw Error("Arresto accodato, operazione ancora in corso");
      const current = this.run(id);
      if (
        current.state === (action === "cancel" ? "CANCELLED" : "PAUSED") ||
        current.state === "CANCELLED"
      )
        return current;
      this.stopRequests.delete(id);
      return this.action(id, action);
    }
    const before = this.run(id);
    if (
      !["restore-copy", "pause", "cancel", "resume", "switch"].includes(action)
    )
      throw Error("Azione non supportata");
    if (action !== "restore-copy" && terminal.includes(before.state))
      throw Error("Run già terminata");
    if (action === "resume" && before.state !== "PAUSED")
      throw Error("Ripresa consentita solo da pausa");
    // Una sessione ferma non ha niente da mettere in pausa: prima la pausa
    // da READY passava per QUIESCING e finiva BLOCKED (collaudo, CT-2.0-001).
    if (
      action === "pause" &&
      before.session &&
      ["READY", "PAUSED"].includes(before.state) &&
      !this.children.has(id)
    )
      return before;
    if (
      action === "switch" &&
      (before.state !== "RUNNING" ||
        before.agent !== "codex" ||
        before.switches !== 0)
    )
      throw Error("Switch non consentito");
    // Su una sessione «riprendi» è un nuovo turno con la richiesta rimasta in
    // sospeso: rilanciare l'AI così com'era portava con sé quota esaurita,
    // AI già provate e la richiesta in attesa, che poi ripartiva da sola.
    if (action === "resume" && before.session) {
      const testo =
        before.inAttesa?.testo ?? before.request ?? "Continua il lavoro";
      return this.turn(id, testo, { automatica: Boolean(before.inAttesa) });
    }
    this.busy.add(id);
    try {
      let r = this.run(id);
      if (action === "restore-copy") {
        if (!r.snapshotId) throw Error("Checkpoint assente");
        const target = join(r.dir, "restored-" + randomUUID());
        restore(r.dir, r.snapshotId, target, r.repo, r.base);
        r.restoredPath = target;
        this.event(
          r,
          "restore.completed",
          "Copia verificata creata in " + target,
        );
        return this.run(id);
      }
      if (action === "resume") {
        if (r.state !== "PAUSED")
          throw Error("Ripresa consentita solo da pausa");
        await this.start(r);
        return this.run(id);
      }
      if (terminal.includes(r.state)) throw Error("Run già terminata");
      if (
        action === "switch" &&
        (r.state !== "RUNNING" || r.agent !== "codex" || r.switches !== 0)
      )
        throw Error("Switch non consentito");
      if (action === "switch")
        r.failureEvidenceId = this.event(
          r,
          "failure.detected",
          r.quotaDetected
            ? "Limite di quota del provider rilevato nello stream · REALE"
            : "Limite quota iniettato · SIMULAZIONE",
        ).eventId;
      await this.quiesce(r);
      this.checkpoint(r);
      action = this.stopRequests.get(id) ?? action;
      this.stopRequests.delete(id);
      if (action === "pause" || action === "cancel") {
        if (action === "pause")
          this.annota(
            r,
            "Il turno precedente è stato interrotto dall'utente prima della fine: il lavoro parziale è rimasto nella copia di lavoro e non è stato consegnato.",
          );
        r.state = action === "pause" ? "PAUSED" : "CANCELLED";
        // Interrompere il turno ferma anche il flusso di cui fa parte.
        const flussoFermato = r.esecuzione?.flusso?.nome;
        r.esecuzione = undefined;
        // Interrotto da te: le revisioni a turno in coda non partono.
        r.codaRevisioni = [];
        r.revisioneATurno = undefined;
        r.passoSoloLettura = false;
        // Chiusa la run, il collegamento nel repository dell'utente non serve
        // più: il lavoro resta comunque nella cartella della run.
        if (r.state === "CANCELLED") this.smontaWorktree(r);
        this.event(
          r,
          "run." + r.state.toLowerCase(),
          action === "pause"
            ? "In pausa — lavoro salvato"
            : "Annullato — artefatti conservati",
        );
        if (flussoFermato)
          this.event(r, "flow.stopped", `Flusso «${flussoFermato}» fermato: il lavoro fatto finora resta nella copia`);
        return this.run(id);
      }
      await this.verifyCode(r);
      this.handoff(r);
      validateHandoff(
        JSON.parse(readFileSync(join(r.dir, "handoff.json"), "utf8")),
        r.id,
        r.snapshotId,
      );
      const packet = validatePackage(r.dir, r.id, r.snapshotId);
      if (packet.toAgent !== (r.successor ?? "claude"))
        throw Error("Successore handoff diverso dalla policy della run");
      if (
        hash(readFileSync(join(r.dir, "handoff.json"))) !== r.handoffDigest ||
        hash(JSON.stringify(inventory(r.work, Boolean(r.project)))) !==
          r.snapshotId
      )
        throw Error("Handoff non integro o obsoleto");
      await new Promise<void>((resolve) => setImmediate(resolve));
      const requested = this.stopRequests.get(id);
      if (requested) {
        this.stopRequests.delete(id);
        r.state = requested === "cancel" ? "CANCELLED" : "PAUSED";
        this.event(
          r,
          "run." + r.state.toLowerCase(),
          "Arresto utente prima del successore; handoff conservato",
        );
        return this.run(id);
      }
      r.switches = 1;
      r.agent = r.successor ?? "claude";
      this.event(
        r,
        "switch.started",
        r.mode === "live"
          ? `Passaggio a ${r.agent} reale · ${r.quotaDetected ? "quota autentica del provider" : "interruzione indotta"} · switch 1/1`
          : `Passaggio a ${r.agent} simulato · switch 1/1`,
      );
      await this.start(r);
      return this.run(id);
    } catch (e) {
      this.block(id, e);
      throw e;
    } finally {
      this.busy.delete(id);
    }
  }
  async complete(id: string) {
    this.busy.add(id);
    try {
      const r = this.run(id);
      await this.quiesce(r);
      this.checkpoint(r);
      const passed = await this.verifyCode(r);
      r.state = passed ? "SUCCEEDED" : "FAILED";
      this.event(
        r,
        passed ? "run.succeeded" : "run.failed",
        passed
          ? "Tutti i criteri superati sullo snapshot corrente"
          : "Verifiche fallite",
      );
    } catch (e) {
      this.block(id, e);
      throw e;
    } finally {
      this.busy.delete(id);
    }
  }
  // I permessi per le azioni fuori dal progetto (decisione di Lorenzo del 23
  // ottobre, «chiede ogni volta»). Il programma dei permessi di Claude chiede
  // e aspetta; l'interfaccia mostra la domanda e risponde. Senza risposta
  // entro tre minuti, o se il turno finisce, la risposta è no.
  permessiInAttesa = new Map<
    string,
    { run: string; ai: string; strumento: string; dettaglio: string; risolvi: (sì: boolean) => void }
  >();
  chiediPermesso(runId: string, strumento: string, input: unknown): Promise<boolean> {
    const r = this.run(runId);
    if (!this.children.has(runId))
      return Promise.resolve(false);
    const id = randomUUID();
    const nome = strumento.replace(/^mcp__(claude_ai_)?/, "").replace("__", ": ");
    let dettaglio = "";
    try {
      dettaglio = JSON.stringify(input ?? {}).slice(0, 400);
    } catch {}
    this.event(r, "permission.requested", `${r.agent} chiede il permesso per ${nome}`, r.agent);
    return new Promise<boolean>((ok) => {
      // Sotto il tempo massimo degli strumenti di Claude (3 minuti): oltre,
      // Claude Code avrebbe già lasciato perdere la domanda.
      const scadenza = setTimeout(() => decidi(false, "nessuna risposta entro 3 minuti"), ATTESA_PERMESSO_MS);
      const decidi = (sì: boolean, perché?: string) => {
        if (!this.permessiInAttesa.has(id)) return;
        clearTimeout(scadenza);
        this.permessiInAttesa.delete(id);
        this.event(
          this.run(runId),
          sì ? "permission.granted" : "permission.denied",
          `${nome}: ${sì ? "consentito da te" : `non consentito${perché ? ` (${perché})` : ""}`}`,
          r.agent,
        );
        ok(sì);
      };
      this.permessiInAttesa.set(id, { run: runId, ai: r.agent, strumento: nome, dettaglio, risolvi: decidi });
    });
  }
  permessoInAttesa(runId: string) {
    for (const [id, p] of this.permessiInAttesa)
      if (p.run === runId) return { id, ai: p.ai, strumento: p.strumento, dettaglio: p.dettaglio };
    return undefined;
  }
  decidiPermesso(runId: string, id: string, consenti: boolean) {
    const p = this.permessiInAttesa.get(id);
    if (!p || p.run !== runId) throw Error("Richiesta di permesso non trovata o già decisa");
    p.risolvi(consenti);
    return { ok: true };
  }
  negaPermessiDi(runId: string, perché: string) {
    for (const p of [...this.permessiInAttesa.values()])
      if (p.run === runId) (p.risolvi as any)(false, perché);
  }
  // Codex: uno strumento bloccato nel turno, consentito dalla persona per il
  // turno dopo («sì, pubblica»).
  consentiProssimoTurno(runId: string, consenti: boolean) {
    const r = this.run(runId);
    const negati: string[] = r.permessiNegati ?? [];
    if (!negati.length) throw Error("Nessuna azione bloccata da consentire");
    r.permessiNegati = [];
    if (consenti) r.permessoTurno = { ai: r.agent, strumenti: negati };
    this.event(
      r,
      consenti ? "permission.granted" : "permission.denied",
      `${negati.join(", ")}: ${consenti ? "consentito da te per il prossimo turno" : "non consentito"}`,
    );
    return this.run(runId);
  }
  async shutdown() {
    for (const c of this.locali.values()) c.abort();
    // Il rilascio di Ollama si aspetta (al massimo pochi secondi, ha i suoi
    // tempi): lanciato e basta, il processo usciva prima che la richiesta
    // partisse e il modello restava in memoria (CT-2.0-202).
    const libera = liberaModello(leggiIbrida(this.store.root).modello).catch(() => false);
    // Le revisioni si fermano e si aspettano: prima finivano dopo lo
    // spegnimento e scrivevano ancora nel registro (CT-2.0-107).
    const diretti = [...this.passiDiretti.keys()];
    const revisioni = [...this.revisioniInCorso.values(), ...this.passiDiretti.values()];
    for (const x of revisioni) x.controllo.abort();
    await Promise.all([libera, ...revisioni.map((x) => x.fatta)]);
    // Un flusso fermo su una domanda a un gratuito annullata qui si chiude:
    // restava «in corso» dopo il riavvio e rifiutava i messaggi (CT-2.0-303).
    await this.ponte?.ferma().catch(() => {});
    for (const id of diretti)
      try {
        this.chiudiFlusso(id, "fermato", "il servizio si è spento durante il passo: il lavoro fatto resta nella copia; riscrivi il messaggio per ripartire");
      } catch {}
    for (const p of [...this.permessiInAttesa.values()]) (p.risolvi as any)(false, "servizio spento");
    for (const id of this.children.keys()) {
      try {
        await this.action(id, "pause");
      } catch {}
    }
  }
}

// Lo stato Git della copia di lavoro: commit e ramo correnti.
function gitCopia(work: string, args: string[]) {
  return execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
    cwd: work,
    encoding: "utf8",
    env: ambienteGit(work),
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
export function statoGitCopia(
  work: string,
): { head: string; ramo?: string } | undefined {
  try {
    const head = gitCopia(work, ["rev-parse", "HEAD"]);
    let ramo: string | undefined;
    try {
      ramo = gitCopia(work, ["symbolic-ref", "-q", "HEAD"]) || undefined;
    } catch {}
    return { head, ramo };
  } catch {
    return undefined;
  }
}
// La cache dei pacchetti condivisa fra le sessioni.
function cartellaCache(root: string) {
  const cache = join(root, "cache");
  mkdirSync(cache, { recursive: true, mode: 0o700 });
  return cache;
}
// Una sessione nativa si riprende solo se il suo file esiste ancora: un
// riferimento a una sessione cancellata farebbe fallire il turno.
// Il consumo di un turno da due totali della stessa sessione nativa. Un
// totale più piccolo del precedente vuol dire una sessione nuova: vale tutto.
export function differenzaUso(
  ora: { entrata: number; uscita: number; cache?: number },
  prima?: { entrata: number; uscita: number; cache?: number },
) {
  if (!prima) return ora;
  const d = {
    entrata: ora.entrata - prima.entrata,
    uscita: ora.uscita - prima.uscita,
    cache: (ora.cache ?? 0) - (prima.cache ?? 0),
  };
  return d.entrata < 0 || d.uscita < 0 || d.cache < 0 ? ora : d;
}
export function sessioneNativaEsiste(
  agente: string,
  id: string,
  cartellaCodex?: string,
) {
  if (!/^[A-Za-z0-9][\w-]{7,79}$/.test(id)) return false;
  try {
    if (agente === "claude") {
      const progetti = join(homedir(), ".claude", "projects");
      return readdirSync(progetti).some((d) =>
        existsSync(join(progetti, d, id + ".jsonl")),
      );
    }
    if (agente === "codex") {
      const sessioni = join(
        cartellaCodex ?? process.env.CODEX_HOME ?? join(homedir(), ".codex"),
        "sessions",
      );
      return (readdirSync(sessioni, { recursive: true }) as string[]).some(
        (f) => String(f).endsWith(id + ".jsonl"),
      );
    }
  } catch {}
  return false;
}

// Un comando di verifica eseguito in modo asincrono, con lo stesso limite di
// dieci minuti di prima. L'uscita non serve: conta il codice.
function eseguiVerifica(
  comando: string,
  argomenti: string[],
  opzioni: { cwd: string; env: NodeJS.ProcessEnv },
): Promise<{ status: number | null; error?: Error; coda: string }> {
  return new Promise((risolvi) => {
    // Le ultime righe dell'uscita: alle AI servono per sapere che cosa non
    // passa, perché nella loro sandbox certi test (un browser) non partono.
    let coda = "";
    const tieni = (pezzo: Buffer) => {
      coda = (coda + pezzo.toString("utf8")).slice(-8000);
    };
    let figlio;
    try {
      figlio = spawn(comando, argomenti, {
        ...opzioni,
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 600_000,
        killSignal: "SIGKILL",
      });
    } catch (e) {
      return risolvi({ status: null, error: e as Error, coda });
    }
    figlio.stdout?.on("data", tieni);
    figlio.stderr?.on("data", tieni);
    figlio.once("error", (error) => risolvi({ status: null, error, coda }));
    figlio.once("close", (status) => risolvi({ status, coda }));
  });
}

// La configurazione con cui nasce Git dentro una copia senza repository.
const CONFIG_GIT_COPIA = `[core]
\trepositoryformatversion = 0
\tfilemode = true
\tbare = false
\tlogallrefupdates = true
\tignorecase = true
\tprecomposeunicode = true
`;

// I file della persona che fanno parte del progetto: con Git quelli tracciati
// e i nuovi non ignorati; senza Git quelli che la copia iniziale avrebbe preso
// (niente .env, dipendenze, cartelle generate, collegamenti).
function fileDellaPersona(root: string, senzaGit: boolean): string[] {
  if (!senzaGit)
    return execFileSync(
      "git",
      [
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "core.fsmonitor=false",
        "ls-files",
        "-co",
        "--exclude-standard",
        "-z",
      ],
      {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        env: ambienteGit(root),
      },
    )
      .split("\u0000")
      .filter(Boolean);
  const fuori: string[] = [];
  const visita = (rel: string) => {
    for (const voce of readdirSync(join(root, rel), { withFileTypes: true })) {
      if (ESCLUSI.has(voce.name) || voce.name.startsWith(".env")) continue;
      const figlio = rel ? rel + "/" + voce.name : voce.name;
      if (voce.isSymbolicLink()) continue;
      if (voce.isDirectory()) visita(figlio);
      else if (voce.isFile()) fuori.push(figlio);
      if (fuori.length > 20000) return;
    }
  };
  visita("");
  return fuori;
}
