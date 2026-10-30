// «Questa AI non è collegata»: un messaggio solo, uguale ovunque nasca
// (chiave mancante, login di Codex o Claude Code mancante, programma non
// installato), che dice il comando /collega per quel servizio. L'interfaccia
// lo riconosce e propone di collegarla subito (richiesta di Lorenzo del 30
// ottobre: suggerire /collega quando si scrive a un'AI non collegata).
import { providerNoto, type ProviderNoto } from "./provider.js";

export type MotivoNonCollegato = "chiave" | "login" | "installa";

// «Codex · abbonamento ChatGPT» → «Codex»; «Groq (gratuito)» → «Groq». Chi
// usa una chiave tiene il nome intero: «Claude Code · chiave API Anthropic»
// non è l'abbonamento di Claude.
export function nomeDaCollegare(p: ProviderNoto | string): string {
  const noto = typeof p === "string" ? providerNoto(p) : p;
  if (!noto) return String(p);
  const nome = noto.accesso === "abbonamento" ? noto.nome.split(" · ")[0] : noto.nome;
  return nome.replace(/\s*\(.*\)\s*$/, "").trim();
}

export function nonCollegato(p: ProviderNoto | string, motivo: MotivoNonCollegato = "chiave"): Error {
  const noto = typeof p === "string" ? providerNoto(p) : p;
  const id = noto?.id ?? String(p);
  const nome = nomeDaCollegare(p);
  return Error(
    motivo === "installa"
      ? `${nome} non è installato su questo computer: /collega ${id} spiega come installarlo e collegarlo`
      : motivo === "login"
        ? `${nome} non è collegato al tuo abbonamento: collegalo con /collega ${id}`
        : `${nome} non è collegato: collegalo con /collega ${id}`,
  );
}

// Il servizio da collegare, se il testo è uno di questi messaggi.
export function daCollegare(testo: string): string | undefined {
  const m = /non è (?:collegat[oa]|installat[oa])[^:]*:[^/]*\/collega ([a-z0-9-]+)/i.exec(testo);
  return m && providerNoto(m[1]) ? m[1] : undefined;
}
