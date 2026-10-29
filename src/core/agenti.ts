import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

// Gli agenti del progetto, in un posto e in un formato solo per tutte le AI:
// <progetto>/continuity/agenti/<nome>.md. Continuity li traduce nel formato
// nativo di ciascun provider (Claude: --agents; Codex: ruoli con
// agents.<nome>.config_file), così lo stesso agente lavora con chiunque.
// Si accettano anche, nella stessa cartella, i file già scritti per Codex
// (.toml) o per Claude (.md con «name/description/tools/model»).

export const CARTELLA_CONTINUITY = "continuity";
export const CARTELLA_AGENTI = join(CARTELLA_CONTINUITY, "agenti");

export type Ragionamento = "basso" | "medio" | "alto" | "massimo";
export type AgenteStandard = {
  nome: string;
  descrizione: string;
  istruzioni: string;
  permessi: "lettura" | "scrittura";
  ragionamento?: Ragionamento;
  modelli: { claude?: string; codex?: string };
  file: string;
};

const NOME = /^[a-z0-9][a-z0-9_-]{0,40}$/i;
const MODELLO = /^[A-Za-z0-9][\w.:-]{0,79}$/;
const DA_EFFORT: Record<string, Ragionamento> = {
  minimal: "basso",
  low: "basso",
  medium: "medio",
  high: "alto",
  xhigh: "massimo",
  max: "massimo",
};

// «chiave: valore» in testa a un .md, fra due righe «---».
function intestazione(testo: string) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(testo);
  if (!m) return undefined;
  const campi: Record<string, string> = {};
  for (const riga of m[1].split("\n")) {
    const c = /^\s*([A-Za-zÀ-ÿ_-]+)\s*:\s*(.*?)\s*(#.*)?$/.exec(riga);
    if (c) campi[c[1].toLowerCase()] = c[2].replace(/^["']|["']$/g, "");
  }
  return { campi, corpo: m[2].trim() };
}

// Il minimo di TOML che serve per i file d'agente di Codex: stringhe semplici
// e stringhe su più righe fra «"""».
function tomlSemplice(testo: string) {
  const campi: Record<string, string> = {};
  const re =
    /^\s*([A-Za-z_][\w-]*)\s*=\s*(?:"""([\s\S]*?)"""|"((?:[^"\\]|\\.)*)"|'([^']*)'|([^\n#]+))/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(testo))) {
    const valore =
      m[2] ??
      (m[3] !== undefined
        ? m[3].replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\")
        : (m[4] ?? m[5] ?? "").trim());
    campi[m[1].toLowerCase()] = valore.replace(/^\n/, "");
  }
  return campi;
}

function daCampi(
  campi: Record<string, string>,
  corpo: string,
  file: string,
  nomeFile: string,
): AgenteStandard | undefined {
  const nome = campi.nome ?? campi.name ?? nomeFile;
  const descrizione = campi.descrizione ?? campi.description ?? "";
  const istruzioni = (
    corpo ||
    campi.developer_instructions ||
    campi.istruzioni ||
    ""
  ).trim();
  if (!NOME.test(nome) || !descrizione || !istruzioni) return undefined;
  const permessiScritti = (campi.permessi ?? "").toLowerCase();
  const sandbox = (campi.sandbox_mode ?? "").toLowerCase();
  // Strumenti dichiarati alla maniera di Claude: senza Edit/Write/Bash è un
  // agente che legge soltanto.
  const strumenti = campi.tools ?? "";
  const soloLettura =
    permessiScritti === "lettura" ||
    sandbox === "read-only" ||
    (strumenti !== "" && !/\b(Edit|Write|Bash|NotebookEdit)\b/.test(strumenti));
  const ragionamentoScritto = (
    campi.ragionamento ??
    campi.model_reasoning_effort ??
    ""
  ).toLowerCase();
  const ragionamento = (
    ["basso", "medio", "alto", "massimo"].includes(ragionamentoScritto)
      ? ragionamentoScritto
      : DA_EFFORT[ragionamentoScritto]
  ) as Ragionamento | undefined;
  const modello = (v?: string) => (v && MODELLO.test(v) ? v : undefined);
  const generico = campi.model ?? campi.modello;
  return {
    nome,
    descrizione: descrizione.slice(0, 500),
    istruzioni: istruzioni.slice(0, 20000),
    permessi: soloLettura ? "lettura" : "scrittura",
    ragionamento,
    modelli: {
      // Un .toml è un file di Codex, un .md con «model» è di Claude.
      claude: modello(
        campi["modello-claude"] ??
          (file.endsWith(".md") ? generico : undefined),
      ),
      codex: modello(
        campi["modello-codex"] ??
          (file.endsWith(".toml") ? generico : undefined),
      ),
    },
    file,
  };
}

// Gli agenti della cartella standard di un progetto (o della sua copia).
export function leggiAgenti(radice: string): AgenteStandard[] {
  const cartella = join(radice, CARTELLA_AGENTI);
  if (!existsSync(cartella)) return [];
  const agenti = new Map<string, AgenteStandard>();
  let voci: string[] = [];
  try {
    voci = readdirSync(cartella)
      .filter((f) => /\.(md|toml)$/i.test(f) && !/^readme\.md$/i.test(f))
      .sort();
  } catch {
    return [];
  }
  for (const voce of voci.slice(0, 50)) {
    let testo = "";
    try {
      testo = readFileSync(join(cartella, voce), "utf8");
    } catch {
      continue;
    }
    const nomeFile = voce.replace(/\.(md|toml)$/i, "");
    const agente = voce.toLowerCase().endsWith(".toml")
      ? daCampi(tomlSemplice(testo), "", voce, nomeFile)
      : (() => {
          const i = intestazione(testo);
          return i ? daCampi(i.campi, i.corpo, voce, nomeFile) : undefined;
        })();
    if (agente && !agenti.has(agente.nome)) agenti.set(agente.nome, agente);
  }
  return [...agenti.values()];
}

// Per Claude: la definizione di --agents. Un agente in sola lettura ha solo
// gli strumenti che leggono; uno che scrive eredita quelli della sessione.
export function agentiPerClaude(agenti: AgenteStandard[]) {
  const fuori: Record<string, Record<string, unknown>> = {};
  for (const a of agenti) {
    fuori[a.nome] = {
      description: a.descrizione,
      prompt: a.istruzioni,
      ...(a.permessi === "lettura"
        ? { tools: ["Read", "Glob", "Grep", "WebFetch", "WebSearch"] }
        : {}),
      ...(a.modelli.claude ? { model: a.modelli.claude } : {}),
    };
  }
  return fuori;
}

// Per Codex: un file di ruolo per agente (fuori dalla copia di lavoro, dove
// scrivono le AI) e le impostazioni che lo dichiarano.
export function agentiPerCodex(
  agenti: AgenteStandard[],
  cartella: string,
  effort: Record<Ragionamento, string>,
): string[] {
  if (!agenti.length) return [];
  mkdirSync(cartella, { recursive: true });
  const stringa = (s: string) => JSON.stringify(s);
  const argomenti: string[] = [];
  for (const a of agenti) {
    const file = join(cartella, a.nome + ".toml");
    writeFileSync(
      file,
      [
        `name = ${stringa(a.nome)}`,
        `description = ${stringa(a.descrizione)}`,
        ...(a.modelli.codex ? [`model = ${stringa(a.modelli.codex)}`] : []),
        ...(a.ragionamento
          ? [`model_reasoning_effort = ${stringa(effort[a.ragionamento])}`]
          : []),
        `sandbox_mode = ${stringa(a.permessi === "lettura" ? "read-only" : "workspace-write")}`,
        `developer_instructions = ${stringa(a.istruzioni)}`,
        "",
      ].join("\n"),
    );
    argomenti.push(
      "-c",
      `agents.${a.nome}.description=${stringa(a.descrizione)}`,
      "-c",
      `agents.${a.nome}.config_file=${stringa(file)}`,
    );
  }
  return argomenti;
}

const LEGGIMI = `# Cartella di Continuity

Questa cartella appartiene al progetto e vale per tutte le AI che Continuity
usa (Codex, Claude e quelle future).

## Agenti: \`continuity/agenti/\`

Un file per agente. Continuity lo traduce nel formato di ciascuna AI, che può
delegargli una parte del lavoro come sotto-agente.

\`\`\`markdown
---
nome: revisore-git
descrizione: Quando usarlo (l'AI lo legge per decidere se delegargli il lavoro)
permessi: lettura          # lettura | scrittura
ragionamento: medio        # basso | medio | alto | massimo (facoltativo)
modello-claude: sonnet     # facoltativo
modello-codex: gpt-6-luna  # facoltativo
---
Le istruzioni dell'agente, in testo libero.
\`\`\`

Vanno bene anche i file d'agente già scritti per Codex (\`.toml\` con name,
description, model, model_reasoning_effort, sandbox_mode,
developer_instructions) o per Claude (\`.md\` con name, description, tools,
model).

Per usarli basta chiederlo nella richiesta, per esempio: «fai controllare il
lavoro all'agente revisore-git».
`;

// Alla prima sessione nel progetto: la cartella standard, con il leggimi e
// una copia degli agenti che il progetto ha già (per Codex o per Claude).
// Copiati, non spostati: i file originali restano dove sono.
export function preparaCartellaContinuity(root: string): {
  creata: boolean;
  importati: string[];
} {
  const agenti = join(root, CARTELLA_AGENTI);
  if (existsSync(join(root, CARTELLA_CONTINUITY)))
    return { creata: false, importati: [] };
  mkdirSync(agenti, { recursive: true });
  writeFileSync(join(root, CARTELLA_CONTINUITY, "README.md"), LEGGIMI);
  const importati: string[] = [];
  for (const [sorgente, estensione] of [
    [join(root, "agents"), ".toml"],
    [join(root, ".codex", "agents"), ".toml"],
    [join(root, ".claude", "agents"), ".md"],
  ] as const) {
    if (!existsSync(sorgente)) continue;
    for (const voce of readdirSync(sorgente)) {
      if (!voce.endsWith(estensione) || existsSync(join(agenti, voce)))
        continue;
      try {
        copyFileSync(join(sorgente, voce), join(agenti, voce));
        importati.push(voce);
      } catch {}
    }
  }
  return { creata: true, importati };
}
