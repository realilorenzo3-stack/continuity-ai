// Come lavora Claude Code (decisione di Lorenzo del 30 ottobre):
// - «chiedi» (di serie): dove c'è la sandbox del sistema (sempre sul Mac; su
//   Linux e WSL con bubblewrap e socat) i comandi girano chiusi nella copia di
//   lavoro senza domande; dove non c'è, Claude lavora lo stesso e Continuity
//   chiede il permesso per ogni comando (come fa opencode), invece di non
//   farlo partire;
// - «libero» (Bypass permissions): Claude lavora senza chiedere nulla. La
//   sandbox, dove c'è, resta: i comandi non escono dalla copia di lavoro.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type ModoClaude = "chiedi" | "libero";

const file = (cartellaDati: string) => join(cartellaDati, "permessi.json");

export function leggiModoClaude(cartellaDati: string): ModoClaude {
  try {
    return JSON.parse(readFileSync(file(cartellaDati), "utf8"))?.claude === "libero" ? "libero" : "chiedi";
  } catch {
    return "chiedi";
  }
}

export function salvaModoClaude(cartellaDati: string, modo: ModoClaude) {
  let attuale: Record<string, unknown> = {};
  try {
    attuale = JSON.parse(readFileSync(file(cartellaDati), "utf8"));
  } catch {}
  mkdirSync(cartellaDati, { recursive: true, mode: 0o700 });
  writeFileSync(file(cartellaDati), JSON.stringify({ ...attuale, claude: modo }, null, 2) + "\n", { mode: 0o600 });
}
