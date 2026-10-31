import { execFile } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { variabiliDiSistema } from "../piattaforma.js";

// I connettori di ciascuna AI: quelli che la persona ha aggiunto e autorizzato
// sulle piattaforme ufficiali (claude.ai e Claude Code per Claude, ChatGPT e
// Codex per Codex). Continuity li legge soltanto: non ne aggiunge, non ne
// autentica e non ne conserva le credenziali.

export type Connettore = {
  // Identificativo stabile, usato per accenderlo o spegnerlo.
  id: string;
  // L'AI a cui appartiene: «claude», «codex», o quella che verrà aggiunta.
  ai: string;
  nome: string;
  stato: "collegato" | "da autorizzare" | "non raggiungibile" | "disponibile";
  // Claude: il prefisso dei suoi strumenti, per i permessi.
  prefisso?: string;
  // Codex: come spegnerlo, cioè quali impostazioni disattivare al lancio.
  disattiva?: string[];
};

// «claude.ai Claude Docs» → mcp__claude_ai_Claude_Docs: la regola con cui
// Claude Code nomina gli strumenti di un connettore.
export const prefissoClaude = (nome: string) =>
  "mcp__" + nome.replace(/[^A-Za-z0-9_-]/g, "_");

// Le righe di «claude mcp list»: «nome: indirizzo - ✓ Connected».
export function leggiElencoClaude(testo: string): Connettore[] {
  const fuori: Connettore[] = [];
  for (const riga of testo.split("\n")) {
    const m = /^(.+?): (\S.*?) - (.+)$/.exec(riga.trim());
    if (!m) continue;
    const [, nome, , esito] = m;
    const stato = /connected/i.test(esito)
      ? "collegato"
      : /auth/i.test(esito)
        ? "da autorizzare"
        : "non raggiungibile";
    fuori.push({
      id: "claude:" + nome,
      ai: "claude",
      nome: nome.replace(/^claude\.ai /, ""),
      stato,
      prefisso: prefissoClaude(nome),
    });
  }
  return fuori;
}

// Un plugin remoto di Codex (le app di ChatGPT: GitHub, Gmail, Figma…) dichiara
// nella sua cartella quali app porta e con quale nome si presenta.
export function leggiPluginCodex(
  marketplace: string,
  nome: string,
  versione: string,
): { nome?: string; app: string[] } {
  const cartella = join(
    process.env.CODEX_HOME ?? join(homedir(), ".codex"),
    "plugins",
    "cache",
    marketplace,
    nome,
    versione,
  );
  const leggi = (file: string) => {
    try {
      return JSON.parse(readFileSync(join(cartella, file), "utf8"));
    } catch {
      return undefined;
    }
  };
  const app = Object.values(leggi(".app.json")?.apps ?? {})
    .map((a: any) => a?.id)
    .filter(
      (id): id is string => typeof id === "string" && /^[\w-]+$/.test(id),
    );
  return {
    nome: leggi(".codex-plugin/plugin.json")?.interface?.displayName,
    app,
  };
}

// Codex: i plugin installati e attivi (dal suo «plugin list --json», che
// comprende le app collegate all'account ChatGPT) e i server MCP abilitati
// definiti nella configurazione. Si spengono con impostazioni al lancio: un
// plugin locale con plugins."X".enabled, un'app remota con apps.<id>.enabled
// (il plugin remoto da solo non la spegne, verificato).
export function leggiElencoCodex(
  configurazione: string,
  serverJson: string,
  pluginJson = "",
  leggiPlugin = leggiPluginCodex,
): Connettore[] {
  const fuori: Connettore[] = [];
  let installati: any[] | undefined;
  try {
    const dati = JSON.parse(pluginJson);
    if (Array.isArray(dati?.installed)) installati = dati.installed;
  } catch {}
  if (installati) {
    for (const p of installati) {
      if (!p?.installed || !p?.enabled || typeof p.pluginId !== "string")
        continue;
      if (p.source?.source === "remote") {
        const info = leggiPlugin(
          String(p.marketplaceName),
          String(p.name),
          String(p.version),
        );
        if (!info.app.length) continue;
        fuori.push({
          id: "codex:plugin:" + p.pluginId,
          ai: "codex",
          nome: info.nome ?? p.name,
          stato: "collegato",
          disattiva: info.app.map((id) => `apps.${id}.enabled=false`),
        });
      } else
        fuori.push({
          id: "codex:plugin:" + p.pluginId,
          ai: "codex",
          nome: p.name ?? p.pluginId.replace(/@.*$/, ""),
          stato: "disponibile",
          disattiva: [`plugins."${p.pluginId}".enabled=false`],
        });
    }
  } else
    // Un Codex senza «plugin list»: si legge la configurazione.
    for (const m of configurazione.matchAll(
      /\[plugins\."([^"]+)"\]\s*\n\s*enabled\s*=\s*true/g,
    )) {
      const nome = m[1];
      fuori.push({
        id: "codex:plugin:" + nome,
        ai: "codex",
        nome: nome.replace(/@.*$/, ""),
        stato: "disponibile",
        disattiva: [`plugins."${nome}".enabled=false`],
      });
    }
  let server: any[] = [];
  try {
    server = JSON.parse(serverJson);
  } catch {}
  for (const s of Array.isArray(server) ? server : []) {
    if (!s?.enabled || !/^[\w-]+$/.test(String(s.name))) continue;
    // Quelli definiti nella configurazione si spengono uno per uno; quelli
    // portati da un plugin si spengono con il plugin.
    const definito = new RegExp(`\\[mcp_servers\\.${s.name}\\]`).test(
      configurazione,
    );
    if (!definito) continue;
    fuori.push({
      id: "codex:mcp:" + s.name,
      ai: "codex",
      nome: s.name,
      stato: "disponibile",
      disattiva: [`mcp_servers.${s.name}.enabled=false`],
    });
  }
  return fuori;
}

const ambiente = (): NodeJS.ProcessEnv => ({
  ...variabiliDiSistema(),
  PATH: process.env.PATH,
  HOME: homedir(),
  USER: process.env.USER,
  TMPDIR: process.env.TMPDIR,
  LANG: "en_US.UTF-8",
  TERM: "dumb",
  ENABLE_CLAUDEAI_MCP_SERVERS: "true",
});

let memoria: { quando: number; elenco: Connettore[] } | undefined;
let inCorso: Promise<Connettore[]> | undefined;
const DURATA_MEMORIA = 10 * 60 * 1000;

// L'ultimo elenco anche su disco, nella cartella dati: dopo un riavvio del
// servizio c'è subito, e si rilegge in sottofondo. Prima il primo
// /connettori (e il primo turno) aspettava «claude mcp list», fino a mezzo
// minuto (collaudo su Windows del 31 ottobre). Contiene solo nomi e stati.
let fileMemoria: string | undefined;
export function memoriaConnettoriSuDisco(file: string) {
  fileMemoria = file;
  if (memoria) return;
  try {
    const letta = JSON.parse(readFileSync(file, "utf8"));
    if (Array.isArray(letta?.elenco) && Number.isFinite(letta?.quando))
      memoria = { quando: letta.quando, elenco: letta.elenco };
  } catch {}
}

// Esegue un comando senza bloccare il servizio, e restituisce ciò che scrive
// anche se esce con un errore (un connettore irraggiungibile non lo è). Niente
// scritto del tutto vuol dire lettura non riuscita.
const esegui = (binario: string, argomenti: string[], timeout: number) =>
  new Promise<string | undefined>((risolvi) =>
    execFile(
      binario,
      argomenti,
      { encoding: "utf8", timeout, env: ambiente(), cwd: homedir() },
      (_e, stdout) =>
        risolvi(String(stdout ?? "").trim() ? String(stdout) : undefined),
    ),
  );

// Un lettore per ciascuna AI: sa chiedere al suo CLI ufficiale quali
// connettori sono presenti in questo momento. Una nuova AI si collega qui;
// il resto di Continuity (elenco, /connettori, prompt) vale per tutte.
// Restituisce undefined se la lettura non è riuscita.
type Lettore = (binario: string) => Promise<Connettore[] | undefined>;
export const LETTORI: Record<string, Lettore> = {
  claude: async (binario) => {
    const testo = await esegui(binario, ["mcp", "list"], 60_000);
    return testo === undefined ? undefined : leggiElencoClaude(testo);
  },
  codex: async (binario) => {
    let configurazione = "";
    try {
      configurazione = readFileSync(
        join(
          process.env.CODEX_HOME ?? join(homedir(), ".codex"),
          "config.toml",
        ),
        "utf8",
      );
    } catch {}
    const [server, plugin] = await Promise.all([
      esegui(binario, ["mcp", "list", "--json"], 30_000),
      esegui(binario, ["plugin", "list", "--json"], 30_000),
    ]);
    if (server === undefined && plugin === undefined) return undefined;
    return leggiElencoCodex(configurazione, server ?? "", plugin ?? "");
  },
};

// Legge i connettori di tutte le AI insieme. Il terminale chiede una lettura
// nuova a ogni avvio di Continuity: quello che c'è adesso sulle piattaforme
// ufficiali entra da solo, acceso. Fra un avvio e l'altro l'elenco resta in
// memoria; dopo dieci minuti si rilegge in sottofondo. Solo la prima lettura
// si aspetta, ed è condivisa. Se il CLI di un'AI non
// risponde, per quell'AI resta l'ultimo elenco letto.
export function scopriConnettori(
  binari: Record<string, string | undefined>,
  aggiorna = false,
  lettori: Record<string, Lettore> = LETTORI,
): Promise<Connettore[]> {
  // Un elenco già letto vale subito, anche se vecchio: la rilettura («claude
  // mcp list» prova ogni server e può metterci mezzo minuto) va in
  // sottofondo, e il turno non la aspetta. Prima ogni dieci minuti un turno
  // partiva con 8–28 s di ritardo (prova di Lorenzo del 19 ottobre).
  if (!aggiorna && memoria) {
    if (Date.now() - memoria.quando >= DURATA_MEMORIA && !inCorso)
      void rileggi(binari, lettori).catch(() => {});
    return Promise.resolve(memoria.elenco);
  }
  if (inCorso) return inCorso;
  return rileggi(binari, lettori);
}

function rileggi(
  binari: Record<string, string | undefined>,
  lettori: Record<string, Lettore>,
): Promise<Connettore[]> {
  const precedente = memoria?.elenco ?? [];
  inCorso = Promise.all(
    Object.entries(lettori).map(async ([ai, leggi]) => {
      const binario = binari[ai];
      if (!binario) return [];
      const letti = await leggi(binario).catch(() => undefined);
      return letti ?? precedente.filter((c) => c.ai === ai);
    }),
  )
    .then((parti) => {
      memoria = { quando: Date.now(), elenco: parti.flat() };
      if (fileMemoria)
        try {
          writeFileSync(fileMemoria, JSON.stringify(memoria), { mode: 0o600 });
        } catch {}
      return memoria.elenco;
    })
    .finally(() => {
      inCorso = undefined;
    });
  return inCorso;
}

// Per i test: dimentica l'elenco tenuto in memoria.
export function dimenticaConnettori() {
  memoria = undefined;
  inCorso = undefined;
  fileMemoria = undefined;
}
