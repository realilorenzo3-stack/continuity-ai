import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Cosa è stato installato e quando. Lo scrive install.sh leggendo Git nella
// sorgente: serve a chi apre Continuity per capire se sta usando la versione
// con le ultime modifiche.
export type Build = {
  commit?: string;
  dataCommit?: string;
  nonRegistrate?: boolean;
  installataIl?: string;
};

export function leggiBuild(appRoot: string): Build | undefined {
  try {
    const b = JSON.parse(
      readFileSync(join(appRoot, ".continuity-build.json"), "utf8"),
    );
    return b && typeof b === "object" ? b : undefined;
  } catch {
    return undefined;
  }
}

// Con modifiche non ancora registrate in Git la data dell'ultimo commit
// direbbe il falso: la modifica più recente è quella appena installata.
export function ultimaModifica(b?: Build): Date | undefined {
  const fonte = b?.nonRegistrate
    ? (b.installataIl ?? b.dataCommit)
    : (b?.dataCommit ?? b?.installataIl);
  const d = fonte ? new Date(fonte) : undefined;
  return d && !Number.isNaN(d.getTime()) ? d : undefined;
}

export function dicitura(b?: Build): string | undefined {
  const d = ultimaModifica(b);
  if (!d) return undefined;
  const giorno = d.toLocaleDateString("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const ora = d.toLocaleTimeString("it-IT", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    `ultima modifica ${giorno} ore ${ora}` +
    (b?.commit ? ` · ${b.commit}` : "") +
    (b?.nonRegistrate ? " · con modifiche non ancora registrate" : "")
  );
}

// Ciò che distingue due installazioni: servizio e terminale devono averne una
// uguale, altrimenti il terminale nuovo parla con un servizio vecchio.
export function impronta(b?: Build): string | undefined {
  return b ? `${b.commit ?? "?"}@${b.installataIl ?? "?"}` : undefined;
}

// Chi lavora dalla sorgente («continuity2») non ha un file d'installazione:
// l'impronta è quella dei file di src, con la data dell'ultima modifica.
// Senza, un servizio partito prima di una modifica restava acceso per sempre
// con il codice vecchio, e il terminale nuovo gli chiedeva cose che non
// conosceva (Groq con /ai, 25 ottobre: «Groq non funziona»).
export function improntaSorgente(appRoot: string): string | undefined {
  const voci: string[] = [];
  let ultima = 0;
  const giro = (cartella: string) => {
    for (const v of readdirSync(cartella, { withFileTypes: true })) {
      const percorso = join(cartella, v.name);
      if (v.isDirectory()) giro(percorso);
      else if (/\.(ts|tsx|mjs|js)$/.test(v.name)) {
        const t = statSync(percorso).mtimeMs;
        ultima = Math.max(ultima, t);
        voci.push(`${percorso}:${t}`);
      }
    }
  };
  try {
    giro(join(appRoot, "src"));
  } catch {
    return undefined;
  }
  // Anche le distribuzioni per sistema: una correzione solo lì (l'archivio
  // delle chiavi di Windows, 31 ottobre) lasciava acceso il servizio vecchio.
  try {
    giro(join(appRoot, "piattaforme"));
  } catch {}
  if (!voci.length) return undefined;
  const firma = createHash("sha256").update(voci.sort().join("\n")).digest("hex").slice(0, 12);
  return `sorgente-${firma}@${new Date(ultima).toISOString()}`;
}

// L'impronta di questo programma: dall'installazione, o dalla sorgente.
export function improntaApp(appRoot: string): string | undefined {
  return impronta(leggiBuild(appRoot)) ?? improntaSorgente(appRoot);
}

// Il terminale sostituisce il servizio solo se è di un'installazione più
// vecchia della propria e se non sta lavorando. Un terminale più vecchio non
// abbatte mai quello nuovo, e un turno in corso non si interrompe mai.
export function vaSostituito(
  delServizio: string | undefined,
  mia: string | undefined,
  occupato: boolean,
) {
  if (!mia || delServizio === mia || occupato) return false;
  // Un servizio senza impronta viene da prima delle impronte della sorgente
  // (25 ottobre): è più vecchio per forza.
  if (!delServizio) return mia.startsWith("sorgente-");
  const quando = (b: string) => Date.parse(b.split("@")[1] ?? "");
  return quando(delServizio) < quando(mia);
}

// La versione da mostrare sempre in basso a destra (richiesta di Lorenzo del
// 19 ottobre): numero del pacchetto e commit, dall'installazione o, per chi
// lavora dalla sorgente («continuity2»), da Git. «+» se ci sono modifiche non
// ancora registrate.
let versioneLetta: string | undefined;
export function versioneApp(
  appRoot = fileURLToPath(new URL("../..", import.meta.url)),
): string {
  if (versioneLetta) return versioneLetta;
  let numero = "";
  try {
    numero = JSON.parse(readFileSync(join(appRoot, "package.json"), "utf8")).version ?? "";
  } catch {}
  const b = leggiBuild(appRoot);
  let commit = b?.commit;
  let modificata = Boolean(b?.nonRegistrate);
  if (!commit)
    try {
      const git = (args: string[]) =>
        execFileSync("git", args, { cwd: appRoot, encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] }).trim();
      commit = git(["rev-parse", "--short", "HEAD"]);
      modificata = git(["status", "--porcelain", "--untracked-files=no"]) !== "";
    } catch {}
  versioneLetta =
    `v${numero || "?"}` + (commit ? ` · ${commit.slice(0, 7)}${modificata ? "+" : ""}` : "");
  return versioneLetta;
}
