// «continuity collega» e «/collega»: collegare un provider in pochi secondi.
// Si sceglie dall'elenco (abbonamenti, chiavi, server locali), si incolla la
// chiave senza che compaia a schermo, Continuity la prova subito senza spendere
// e la mette nel Portachiavi. Ricavato dal comportamento di «opencode auth
// login» (docs/rea/provider.md), con due differenze volute: la chiave si prova
// davvero e non finisce in chiaro su disco.
import { PROVIDER, providerNoto, type ProviderNoto } from "../core/provider.js";
import { provaCollegamento } from "../core/collega.js";
import { notaArchivio, type Portachiavi } from "../core/portachiavi.js";
import { collegati, segnaCollegato } from "../core/collegati.js";

export type Dialogo = {
  chiedi(invito: string): Promise<string | null>;
  chiediNascosto(invito: string): Promise<string | null>;
  scrivi(testo: string): void;
};

// I gruppi dell'elenco. I servizi con un piano gratuito stanno insieme
// (Fase 1 del 21 ottobre): chi non paga nulla li trova subito.
type Gruppo = "abbonamento" | "gratuito" | "consumo" | "locale";
const GRUPPI: [Gruppo, string][] = [
  ["abbonamento", "Abbonamenti (login ufficiale, nessun costo in più)"],
  ["gratuito", "Gratuiti con il tuo account (chiave gratuita, con limiti)"],
  ["consumo", "Chiavi API a consumo"],
  ["locale", "Sul tuo computer (gratuiti)"],
];
export function gruppoDi(p: ProviderNoto): Gruppo {
  if (p.accesso === "abbonamento" || p.accesso === "locale") return p.accesso;
  return p.gratis ? "gratuito" : "consumo";
}

export function statoProvider(
  p: ProviderNoto,
  root: string,
  chiavi: Portachiavi,
): string {
  if (p.accesso === "abbonamento") return "login ufficiale";
  if (p.accesso === "chiave") return chiavi.esiste(p.id) ? "collegato" : "—";
  return collegati(root).includes(p.id) ? "collegato" : "—";
}

// L'elenco numerato: lo stesso numero vale per scegliere.
export function elencoCollegabili(root: string, chiavi: Portachiavi) {
  const righe: string[] = [];
  let n = 0;
  for (const [accesso, titolo] of GRUPPI) {
    righe.push(`  ${titolo}`);
    for (const p of PROVIDER.filter((x) => gruppoDi(x) === accesso)) {
      n++;
      righe.push(
        `   ${String(n).padStart(2)}. ${p.id.padEnd(11)} ${p.nome}  [${statoProvider(p, root, chiavi)}]`,
      );
    }
  }
  return righe.join("\n");
}

export function providerDaScelta(scelta: string): ProviderNoto | undefined {
  const t = scelta.trim();
  if (/^\d+$/.test(t)) {
    const ordinati = GRUPPI.flatMap(([a]) =>
      PROVIDER.filter((p) => gruppoDi(p) === a),
    );
    return ordinati[Number(t) - 1];
  }
  return providerNoto(t);
}

export type EsitoCollega =
  | { stato: "collegato"; provider: ProviderNoto; dettaglio: string }
  | { stato: "abbonamento"; provider: ProviderNoto }
  | { stato: "annullato" | "fallito"; provider?: ProviderNoto; dettaglio?: string };

export async function collega(
  root: string,
  chiavi: Portachiavi,
  dialogo: Dialogo,
  nome?: string,
  prova = provaCollegamento,
): Promise<EsitoCollega> {
  let provider = nome ? providerDaScelta(nome) : undefined;
  if (nome && !provider)
    return { stato: "fallito", dettaglio: `Provider sconosciuto: ${nome}` };
  if (!provider) {
    dialogo.scrivi("\n" + elencoCollegabili(root, chiavi) + "\n");
    const scelta = await dialogo.chiedi("  Quale colleghi? (numero o nome, invio per uscire): ");
    if (!scelta?.trim()) return { stato: "annullato" };
    provider = providerDaScelta(scelta);
    if (!provider)
      return { stato: "fallito", dettaglio: `Provider sconosciuto: ${scelta}` };
  }
  dialogo.scrivi(`\n  ${provider.nome}\n`);
  if (provider.nota) dialogo.scrivi(`  ${provider.nota}\n`);
  // Gli abbonamenti si collegano con il login del programma ufficiale:
  // Continuity non vede e non conserva quelle credenziali.
  if (provider.accesso === "abbonamento") return { stato: "abbonamento", provider };
  if (provider.accesso === "locale") {
    const esito = await prova(provider, undefined);
    if (!esito.ok)
      return { stato: "fallito", provider, dettaglio: esito.dettaglio };
    segnaCollegato(root, provider.id, true);
    return { stato: "collegato", provider, dettaglio: esito.dettaglio };
  }
  if (provider.dati) dialogo.scrivi(`  Dati: ${provider.dati}\n`);
  if (provider.console)
    dialogo.scrivi(`  La chiave si crea qui: ${provider.console}\n`);
  // Cloudflare: l'ID dell'account non è segreto, si scrive in chiaro.
  let prima = "";
  if (provider.primaParte) {
    prima = ((await dialogo.chiedi(`  ${provider.primaParte}: `)) ?? "").trim();
    if (!prima) return { stato: "annullato", provider };
    if (/[\s:]/.test(prima))
      return { stato: "fallito", provider, dettaglio: `${provider.primaParte} non valido` };
  }
  dialogo.scrivi(`  ${notaArchivio()}\n`);
  let chiave = (
    await dialogo.chiediNascosto("  Incolla la chiave (non compare a schermo): ")
  )?.trim();
  if (!chiave) return { stato: "annullato", provider };
  if (/\s/.test(chiave))
    return { stato: "fallito", provider, dettaglio: "una chiave non contiene spazi o a capo" };
  if (prima) chiave = `${prima}:${chiave}`;
  dialogo.scrivi("  Provo il collegamento…\n");
  const esito = await prova(provider, chiave);
  if (!esito.ok) {
    if (esito.chiaveRifiutata)
      return { stato: "fallito", provider, dettaglio: esito.dettaglio };
    // Il servizio non ha risposto come previsto: la chiave potrebbe essere
    // buona. Decide la persona.
    dialogo.scrivi(`  ${esito.dettaglio}\n`);
    const ancora = await dialogo.chiedi("  La salvo lo stesso? (s/N): ");
    if (!/^s/i.test(ancora ?? ""))
      return { stato: "annullato", provider, dettaglio: esito.dettaglio };
  }
  chiavi.salva(provider.id, chiave);
  segnaCollegato(root, provider.id, true);
  return { stato: "collegato", provider, dettaglio: esito.dettaglio };
}

export function scollega(root: string, chiavi: Portachiavi, nome: string) {
  const provider = providerNoto(nome);
  if (!provider) throw Error(`Provider sconosciuto: ${nome}`);
  if (provider.accesso === "abbonamento")
    throw Error(
      `${provider.id} usa il login del programma ufficiale: per uscire usa il suo comando di logout`,
    );
  const tolta = provider.accesso === "chiave" ? chiavi.togli(provider.id) : false;
  segnaCollegato(root, provider.id, false);
  return { provider, tolta };
}
