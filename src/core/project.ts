import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";

// Il percorso vero, con le maiuscole che ha sul disco. Su macOS il disco non
// distingue «desktop» da «Desktop», ma il confronto fra stringhe sì: chi entrava
// nella cartella scrivendo le minuscole si ritrovava una sessione nuova, e lo
// stesso progetto aveva due chiavi diverse (prova dell'utente, 13 ottobre).
export function cartellaCanonica(percorso: string) {
  try {
    return realpathSync.native(percorso);
  } catch {
    return percorso;
  }
}
// Due modi di scrivere la stessa cartella.
export function stessaCartella(a?: string, b?: string) {
  if (!a || !b) return false;
  return a === b || cartellaCanonica(a) === cartellaCanonica(b);
}
import { join } from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { detectVerify } from "./detect.js";
import { ambienteGit } from "../git/ambiente.js";

export const CONFIG_NAME = "continuity.json";

// The project declares what "done" means. Continuity runs these commands itself
// and reads the exit code: the project does not have to speak any protocol.
export const projectConfig = z
  .object({
    goal: z.string().trim().min(3).max(2000).optional(),
    verify: z
      .array(
        z
          .object({
            id: z
              .string()
              .regex(/^[a-z0-9][a-z0-9-]{0,31}$/, "id: minuscole, cifre e -"),
            label: z.string().trim().min(1).max(120),
            command: z.array(z.string().min(1)).min(1).max(20),
          })
          .strict(),
      )
      .max(10),
  })
  .strict()
  .refine(
    (c) => new Set(c.verify.map((v) => v.id)).size === c.verify.length,
    "id delle verifiche duplicati",
  );
export type ProjectConfig = z.infer<typeof projectConfig>;

function git(args: string[], cwd: string) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    timeout: 20000,
    env: ambienteGit(cwd),
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export function commandsDigest(config: ProjectConfig) {
  return createHash("sha256")
    .update(JSON.stringify(config.verify.map((v) => [v.id, v.command])))
    .digest("hex");
}

// The simple path: open whatever is in this folder. A missing config is not an
// error, uncommitted work is not an error. Only the absence of a commit is, and
// the caller offers to create one.
export function openProject(path: string) {
  if (!existsSync(path)) throw Error("Percorso inesistente: " + path);
  const root = cartellaCanonica(path);
  // Una cartella qualsiasi va bene. Senza Git (o senza commit) Continuity lavora
  // su una copia propria: il contenuto dell'utente non viene toccato comunque.
  let top = root;
  let head = "";
  let senzaGit = false;
  try {
    top = cartellaCanonica(git(["rev-parse", "--show-toplevel"], root));
    head = git(["rev-parse", "HEAD"], top);
  } catch {
    top = root;
    senzaGit = true;
  }
  const configPath = join(top, CONFIG_NAME);
  let config: ProjectConfig | undefined;
  let origine = "";
  if (existsSync(configPath)) {
    const parsed = projectConfig.safeParse(
      JSON.parse(readFileSync(configPath, "utf8")),
    );
    if (!parsed.success)
      throw Error(
        CONFIG_NAME +
          " non valido: " +
          parsed.error.issues
            .map((i) => i.path.join(".") + " " + i.message)
            .join("; ")
            .slice(0, 200),
      );
    config = parsed.data;
    origine = CONFIG_NAME;
  } else {
    const rilevato = detectVerify(top);
    config = { verify: rilevato.verify };
    origine = rilevato.origine;
  }
  // L'output arriva già ripulito dagli spazi esterni, quindi il codice di stato va
  // tolto con un'espressione, non con un taglio a posizione fissa.
  const modificati = senzaGit
    ? []
    : git(["status", "--porcelain=v1"], top)
        .split("\n")
        .filter(Boolean)
        .map((riga) =>
          riga
            .trim()
            .replace(/^[A-Z?!]{1,2}\s+/, "")
            .trim(),
        );
  return {
    root: top,
    head,
    senzaGit,
    branch: senzaGit
      ? "senza Git"
      : git(["rev-parse", "--abbrev-ref", "HEAD"], top),
    config,
    origine,
    modificati,
    commandsDigest: commandsDigest(config),
  };
}

// A run starts from a state that can be named. A dirty tree has no such name:
// Continuity would not be able to say what the agent inherited or what it changed.
export function inspectProject(path: string) {
  if (!existsSync(path))
    throw Error("Percorso del progetto inesistente: " + path);
  const root = cartellaCanonica(path);
  let top: string;
  try {
    top = cartellaCanonica(git(["rev-parse", "--show-toplevel"], root));
  } catch {
    throw Error(
      "Il progetto non è un repository Git. Continuity lavora su un commit identificabile: eseguire git init e un primo commit.",
    );
  }
  if (top !== root)
    throw Error(
      "Indicare la radice del repository (" + top + "), non una sottocartella.",
    );
  let head: string;
  try {
    head = git(["rev-parse", "HEAD"], root);
  } catch {
    throw Error(
      "Il repository non ha ancora commit: crearne uno prima di iniziare.",
    );
  }
  const dirty = git(["status", "--porcelain=v1"], root);
  if (dirty)
    throw Error(
      "Ci sono modifiche non salvate: Continuity parte da un commit identificabile. Fare commit o stash, poi ripetere.",
    );
  const configPath = join(root, CONFIG_NAME);
  if (!existsSync(configPath))
    throw Error(
      "Manca " +
        CONFIG_NAME +
        " nella radice del progetto: deve dichiarare i comandi di verifica.",
    );
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    throw Error(CONFIG_NAME + " non è JSON valido.");
  }
  const result = projectConfig.safeParse(parsed);
  if (!result.success)
    throw Error(
      CONFIG_NAME +
        " non valido: " +
        result.error.issues
          .map((i) => i.path.join(".") + " " + i.message)
          .join("; ")
          .slice(0, 300),
    );
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"], root);
  return {
    root,
    head,
    branch,
    config: result.data,
    commandsDigest: commandsDigest(result.data),
  };
}
