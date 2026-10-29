// La prova del collegamento: subito, quando la persona collega un provider, e
// senza spendere. opencode salva la chiave senza provarla (docs/rea/provider.md);
// qui si chiede al servizio un indirizzo gratuito (elenco dei modelli o stato
// della chiave) e si dice com'è andata, in parole semplici.
import { conAccount, type ProviderNoto } from "./provider.js";

export type EsitoProva = {
  ok: boolean;
  // Una chiave rifiutata va ridetta; un servizio che non risponde no.
  chiaveRifiutata?: boolean;
  dettaglio: string;
};

export async function provaCollegamento(
  provider: ProviderNoto,
  chiave: string | undefined,
  scarica: typeof fetch = fetch,
): Promise<EsitoProva> {
  if (!provider.prova)
    return { ok: true, dettaglio: "nessuna prova disponibile per questo provider" };
  if (provider.accesso === "chiave" && !chiave)
    return { ok: false, chiaveRifiutata: true, dettaglio: "manca la chiave" };
  let risposta: Response;
  try {
    risposta = await scarica(conAccount(provider.prova.url, chiave), {
      headers: chiave ? (provider.prova.intestazioni?.(chiave) ?? {}) : {},
      signal: AbortSignal.timeout(provider.accesso === "locale" ? 3000 : 15000),
    });
  } catch {
    return {
      ok: false,
      dettaglio:
        provider.accesso === "locale"
          ? `non risponde su ${new URL(provider.prova.url).host}: è avviato?`
          : `${new URL(provider.prova.url).host} non raggiungibile: controlla la connessione`,
    };
  }
  if (risposta.ok) {
    if (provider.id === "ollama") {
      const versione = String(((await leggiJson(risposta)) as any)?.version ?? "");
      if (versione && minore(versione, "0.13.3"))
        return {
          ok: false,
          dettaglio: `Ollama ${versione} è troppo vecchio per Codex: serve 0.13.3 o più recente`,
        };
      return { ok: true, dettaglio: `Ollama ${versione || "attivo"}` };
    }
    if (provider.id === "openrouter") {
      const dati = ((await leggiJson(risposta)) as any)?.data;
      const resto =
        typeof dati?.limit_remaining === "number"
          ? ` · credito rimasto ${dati.limit_remaining}`
          : "";
      return {
        ok: true,
        dettaglio: `chiave valida${dati?.is_free_tier ? " · solo modelli gratuiti finché non aggiungi credito" : ""}${resto}`,
      };
    }
    if (provider.prova.unToken && chiave) return provaConUnToken(provider, chiave, risposta, scarica);
    if (provider.prova.pubblica)
      return {
        ok: true,
        dettaglio: "servizio raggiungibile; la chiave si verifica alla prima richiesta",
      };
    return { ok: true, dettaglio: "collegamento riuscito" };
  }
  if (risposta.status === 401 || risposta.status === 403)
    return {
      ok: false,
      chiaveRifiutata: true,
      dettaglio: `il servizio ha rifiutato la chiave (HTTP ${risposta.status})`,
    };
  if (risposta.status === 402)
    return {
      ok: false,
      dettaglio: "chiave valida ma credito esaurito: ricarica il conto",
    };
  // Un indirizzo di prova che non esiste più non dice nulla sulla chiave.
  return {
    ok: false,
    dettaglio: `risposta inattesa (HTTP ${risposta.status}): la chiave non è stata verificata`,
  };
}

// L'elenco dei modelli è pubblico: la chiave si prova con una risposta di un
// token al primo modello consigliato (CT-2.0-610).
async function provaConUnToken(
  provider: ProviderNoto,
  chiave: string,
  elenco: Response,
  scarica: typeof fetch,
): Promise<EsitoProva> {
  const ids: string[] = (((await leggiJson(elenco)) as any)?.data ?? [])
    .map((m: any) => String(m?.id ?? ""))
    .filter(Boolean);
  // I modelli consigliati nell'ordine, poi gli altri. Un modello dell'elenco
  // può non esserci per l'account (404): si prova il seguente, fino a 3
  // (ottavo collaudo: nemotron-3-super 404, nemotron-3.5-super-vl 200).
  const candidati = [
    ...new Set([...(provider.consigliati ?? []).flatMap((re) => ids.filter((id) => re.test(id))), ...ids]),
  ].slice(0, 3);
  if (!candidati.length || !provider.diretto)
    return { ok: true, dettaglio: "servizio raggiungibile; la chiave si verifica alla prima richiesta" };
  let ultimo = 0;
  for (const modello of candidati) {
    let r: Response;
    try {
      r = await scarica(conAccount(provider.diretto.indirizzo, chiave) + "/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", ...(provider.prova?.intestazioni?.(chiave) ?? {}) },
        body: JSON.stringify({ model: modello, messages: [{ role: "user", content: "ok" }], max_tokens: 1 }),
        signal: AbortSignal.timeout(30000),
      });
    } catch {
      return { ok: true, dettaglio: "servizio raggiungibile; la chiave si verifica alla prima richiesta" };
    }
    if (r.ok || r.status === 429) return { ok: true, dettaglio: "chiave valida" };
    if (r.status === 401 || r.status === 403)
      return { ok: false, chiaveRifiutata: true, dettaglio: `il servizio ha rifiutato la chiave (HTTP ${r.status})` };
    ultimo = r.status;
    if (r.status !== 404) break;
  }
  return {
    ok: true,
    dettaglio: `servizio raggiungibile; la chiave non è stata verificata (HTTP ${ultimo})`,
  };
}

async function leggiJson(r: Response) {
  try {
    return await r.json();
  } catch {
    return undefined;
  }
}

export function minore(versione: string, minima: string) {
  const a = versione.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const b = minima.split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < b.length; i++) {
    if ((a[i] ?? 0) !== b[i]) return (a[i] ?? 0) < b[i];
  }
  return false;
}
