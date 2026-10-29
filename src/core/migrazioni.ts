// Il formato della cartella dati, da una versione di Continuity all'altra
// (piano di pubblicazione, punto 4: «i dati della persona al sicuro negli
// aggiornamenti»). La cartella ha un numero di versione in versione-dati.json.
// Quando una versione nuova cambia il formato, aggiunge qui un passaggio di
// conversione: prima si fa una copia di sicurezza, poi si convertono i dati,
// in ordine. Una cartella di una versione più nuova di quella in uso (dopo
// «continuity update --indietro») non si tocca: lo si dice e ci si ferma.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type Migrazione = {
  // La versione dei dati a cui porta.
  a: number;
  descrizione: string;
  esegui(cartellaDati: string): void;
};

// Nessuna conversione ancora: il formato di oggi è il numero 1.
export const MIGRAZIONI: Migrazione[] = [];

// I file che una conversione può cambiare: il database e le impostazioni.
// Sessioni, copie di lavoro, toolchain e programma non si copiano.
function daCopiare(cartellaDati: string) {
  return readdirSync(cartellaDati).filter((n) => /^continuity\.sqlite(-wal|-shm)?$/.test(n) || /\.json$/.test(n));
}

export function migraDati(cartellaDati: string, migrazioni = MIGRAZIONI, ora = new Date()): { da: number; a: number; copia?: string } {
  const file = join(cartellaDati, "versione-dati.json");
  const ultima = Math.max(1, ...migrazioni.map((m) => m.a));
  let attuale: number;
  try {
    attuale = Number(JSON.parse(readFileSync(file, "utf8")).versione) || 1;
  } catch {
    // Senza numero: una cartella di prima di questo meccanismo (formato 1),
    // oppure una cartella nuova.
    attuale = existsSync(join(cartellaDati, "continuity.sqlite")) ? 1 : ultima;
  }
  if (attuale > ultima)
    throw Error(
      `I dati di Continuity sono di una versione più nuova di quella in uso (formato ${attuale}, questa versione conosce fino al ${ultima}). Aggiorna Continuity con «continuity update»: i dati non sono stati toccati.`,
    );
  let copia: string | undefined;
  if (attuale < ultima) {
    copia = join(cartellaDati, "copie", `prima-del-formato-${ultima}-${ora.toISOString().replace(/[:.]/g, "-")}`);
    mkdirSync(copia, { recursive: true, mode: 0o700 });
    for (const nome of daCopiare(cartellaDati)) copyFileSync(join(cartellaDati, nome), join(copia, nome));
    for (const m of [...migrazioni].sort((x, y) => x.a - y.a)) {
      if (m.a <= attuale) continue;
      m.esegui(cartellaDati);
      writeFileSync(file, JSON.stringify({ versione: m.a }) + "\n", { mode: 0o600 });
    }
  }
  writeFileSync(file, JSON.stringify({ versione: ultima }) + "\n", { mode: 0o600 });
  return { da: attuale, a: ultima, copia };
}
