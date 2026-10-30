// L'avviso di versione nuova (piano di pubblicazione, punto 4): a ogni
// apertura Continuity chiede a GitHub qual è l'ultima versione pubblicata e,
// se è più nuova di quella installata, lo dice in una riga. Prima si chiedeva
// una volta al giorno: la risposta di ieri nascondeva le versioni di oggi
// (prova di Lorenzo su Ubuntu, 30 ottobre). Senza rete vale l'ultima risposta.
// GitHub vede l'indirizzo IP (scritto in PRIVACY.md). Si spegne con
// CONTINUITY_AGGIORNAMENTI=spenti o con «aggiornamenti: false» in
// interfaccia.json. Nella versione di sviluppo non c'è .continuity-version:
// nessun controllo.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileInterfaccia } from "./lingua.js";

export const REPOSITORY_PUBBLICA = "realilorenzo3-stack/continuity-ai";

export function versioneInstallata(cartellaApp: string): string | undefined {
  try {
    const v = readFileSync(join(cartellaApp, ".continuity-version"), "utf8").trim();
    return /^\d+\.\d+\.\d+/.test(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

// «2.1.0» è più nuova di «2.0.3»; «2.0.0» di «2.0.0-beta.2»; «2.0.0-beta.10»
// di «2.0.0-beta.9».
export function piuNuova(a: string, b: string): boolean {
  const parti = (v: string) => {
    const [base, pre] = v.replace(/^v/, "").split("-", 2);
    return { base: base.split(".").map((n) => parseInt(n, 10) || 0), pre };
  };
  const x = parti(a);
  const y = parti(b);
  for (let i = 0; i < 3; i++) if ((x.base[i] ?? 0) !== (y.base[i] ?? 0)) return (x.base[i] ?? 0) > (y.base[i] ?? 0);
  if (!x.pre || !y.pre) return !x.pre && Boolean(y.pre);
  const px = x.pre.split(".");
  const py = y.pre.split(".");
  for (let i = 0; i < Math.max(px.length, py.length); i++) {
    if (px[i] === undefined) return false;
    if (py[i] === undefined) return true;
    const nx = Number(px[i]);
    const ny = Number(py[i]);
    if (Number.isInteger(nx) && Number.isInteger(ny)) {
      if (nx !== ny) return nx > ny;
    } else if (px[i] !== py[i]) return px[i] > py[i];
  }
  return false;
}

function spento(cartellaDati: string) {
  if (process.env.CONTINUITY_AGGIORNAMENTI === "spenti") return true;
  try {
    return JSON.parse(readFileSync(fileInterfaccia(cartellaDati), "utf8"))?.aggiornamenti === false;
  } catch {
    return false;
  }
}

// La versione più nuova di quella installata, se c'è; altrimenti undefined.
export async function controllaAggiornamento(
  cartellaDati: string,
  cartellaApp: string,
  scarica: typeof fetch = fetch,
  ora = Date.now(),
): Promise<string | undefined> {
  const installata = versioneInstallata(cartellaApp);
  if (!installata || spento(cartellaDati)) return undefined;
  const file = join(cartellaDati, "aggiornamenti.json");
  let ricordata: { quando?: number; ultima?: string } = {};
  try {
    ricordata = JSON.parse(readFileSync(file, "utf8"));
  } catch {}
  let ultima = ricordata.ultima;
  try {
    // Tutte le versioni, e si sceglie la più alta: GitHub le elenca per nome
    // («beta.9» prima di «beta.11», 30 ottobre).
    const r = await scarica(`https://api.github.com/repos/${REPOSITORY_PUBBLICA}/releases?per_page=100`, {
      headers: { accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(4000),
    });
    const elenco = r.ok ? ((await r.json()) as any[]) : [];
    const tag = (Array.isArray(elenco) ? elenco : [])
      .map((x) => String(x?.tag_name ?? "").replace(/^v/, ""))
      .filter((x) => /^\d+\.\d+\.\d+/.test(x))
      .reduce((a, b) => (!a || piuNuova(b, a) ? b : a), "");
    if (tag) ultima = tag;
    mkdirSync(cartellaDati, { recursive: true, mode: 0o700 });
    writeFileSync(file, JSON.stringify({ quando: ora, ultima }) + "\n", { mode: 0o600 });
  } catch {
    // Senza rete vale l'ultima risposta ricordata: nessun errore.
  }
  return ultima && piuNuova(ultima, installata) ? ultima : undefined;
}
