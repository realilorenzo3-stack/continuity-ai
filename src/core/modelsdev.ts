// Il catalogo dei modelli e dei prezzi, dai dati di models.dev (licenza MIT,
// © models.dev; docs/LICENZE.md §4). Si scarica quando serve e si tiene un
// giorno nella cartella dati, solo per i servizi del registro: il file intero
// pesa più di 5 MB. Senza rete vale la copia precedente; senza nessuna copia
// i costi restano «non stimati», mai inventati.
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PROVIDER } from "./provider.js";

export const INDIRIZZO_CATALOGO = "https://models.dev/api.json";
const VALIDITA_MS = 24 * 3600 * 1000;

export type Prezzi = { input: number; output: number; cache_read?: number };
export type ModelloCatalogo = {
  id: string;
  nome: string;
  prezzi?: Prezzi;
  gratuito: boolean;
  contesto?: number;
};
export type Catalogo = Record<string, Record<string, ModelloCatalogo>>;

// Gratuito solo se il catalogo dà un prezzo e il prezzo è zero. Un modello
// senza prezzo non è gratuito: opencode lo tratta come zero e lo segna «Free»
// (448 casi nella sua copia, docs/rea/provider.md). Un piano in abbonamento a
// costo zero («coding plan») non è gratuito: il registro non ne usa.
export function gratuito(servizio: string, id: string, prezzi?: Prezzi) {
  if (!prezzi) return false;
  if (servizio === "openrouter" && !id.endsWith(":free")) return false;
  return prezzi.input === 0 && prezzi.output === 0;
}

export function riduci(grezzo: any): Catalogo {
  const servizi = new Set(PROVIDER.map((p) => p.catalogo).filter(Boolean));
  const fuori: Catalogo = {};
  for (const servizio of servizi) {
    const modelli = grezzo?.[servizio!]?.models;
    if (!modelli || typeof modelli !== "object") continue;
    fuori[servizio!] = {};
    for (const [id, m] of Object.entries<any>(modelli)) {
      const c = m?.cost;
      const prezzi =
        c && typeof c.input === "number" && typeof c.output === "number"
          ? {
              input: c.input,
              output: c.output,
              ...(typeof c.cache_read === "number"
                ? { cache_read: c.cache_read }
                : {}),
            }
          : undefined;
      fuori[servizio!][id] = {
        id,
        nome: String(m?.name ?? id),
        prezzi,
        gratuito: gratuito(servizio!, id, prezzi),
        contesto:
          typeof m?.limit?.context === "number" ? m.limit.context : undefined,
      };
    }
  }
  return fuori;
}

export async function caricaCatalogo(
  cartellaDati: string,
  scarica: typeof fetch = fetch,
  adesso = Date.now(),
): Promise<Catalogo | undefined> {
  const file = join(cartellaDati, "catalogo-modelli.json");
  const copia = () => {
    try {
      return JSON.parse(readFileSync(file, "utf8")) as Catalogo;
    } catch {
      return undefined;
    }
  };
  // Una copia fresca vale solo se è stata fatta per gli stessi servizi del
  // registro: quando se ne aggiunge uno (i gratuiti del 21 ottobre) si
  // riscarica subito. L'elenco chiesto sta accanto al catalogo.
  const richiesti = JSON.stringify(
    [...new Set(PROVIDER.map((p) => p.catalogo).filter(Boolean))].sort(),
  );
  const fileRichiesti = join(cartellaDati, "catalogo-modelli.servizi.json");
  const stessiServizi = () => {
    try {
      return readFileSync(fileRichiesti, "utf8") === richiesti;
    } catch {
      return false;
    }
  };
  if (existsSync(file) && adesso - statSync(file).mtimeMs < VALIDITA_MS && stessiServizi())
    return copia();
  try {
    const r = await scarica(INDIRIZZO_CATALOGO, {
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) return copia();
    const catalogo = riduci(await r.json());
    writeFileSync(file, JSON.stringify(catalogo), { mode: 0o600 });
    writeFileSync(fileRichiesti, richiesti, { mode: 0o600 });
    return catalogo;
  } catch {
    return copia();
  }
}

export function prezziDi(
  catalogo: Catalogo | undefined,
  servizio: string | undefined,
  modello: string | undefined,
): Prezzi | undefined {
  if (!catalogo || !servizio || !modello) return undefined;
  return catalogo[servizio]?.[modello]?.prezzi;
}

// I prezzi del catalogo sono in dollari per milione di token. I token letti
// dalla cache costano meno; senza quel prezzo valgono come quelli in ingresso.
export function costoStimato(
  uso: { entrata: number; uscita: number; cache?: number },
  prezzi: Prezzi,
) {
  return (
    (uso.entrata * prezzi.input +
      (uso.cache ?? 0) * (prezzi.cache_read ?? prezzi.input) +
      uso.uscita * prezzi.output) /
    1e6
  );
}

export function dollari(valore: number) {
  return valore < 0.01 && valore > 0
    ? "meno di 0,01 $"
    : valore.toLocaleString("it-IT", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }) + " $";
}
