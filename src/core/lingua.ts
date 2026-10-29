// La lingua di Continuity (28 ottobre: l'inglese è la lingua prestabilita,
// l'italiano si sceglie con /language italiano). È una preferenza della
// persona, nella cartella dati (`interfaccia.json`), letta sia
// dall'interfaccia sia dal servizio, che la usa per dire alle AI in che lingua
// rispondere.
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type Lingua = "it" | "en";
export const LINGUA_PREDEFINITA: Lingua = "en";

export function fileInterfaccia(cartellaDati: string) {
  return join(cartellaDati, "interfaccia.json");
}

// La lingua quando la persona non ne ha scelta una: CONTINUITY_LINGUA, se
// c'è (i test girano in italiano), altrimenti l'inglese.
export function linguaDiSerie(): Lingua {
  const daFuori = process.env.CONTINUITY_LINGUA;
  return daFuori === "it" || daFuori === "en" ? daFuori : LINGUA_PREDEFINITA;
}

// Prima la scelta salvata con /language, poi la lingua di serie.
export function leggiLingua(cartellaDati: string): Lingua {
  try {
    const scelta = JSON.parse(readFileSync(fileInterfaccia(cartellaDati), "utf8"))?.lingua;
    return scelta === "it" || scelta === "en" ? scelta : linguaDiSerie();
  } catch {
    return linguaDiSerie();
  }
}

// La lingua in cui la persona scrive, dalle parole più comuni dei suoi ultimi
// messaggi (28 ottobre: Claude rispondeva in inglese a richieste in italiano,
// perché la lingua di serie era l'inglese). undefined se non si capisce:
// messaggi troppo corti o misti.
const PAROLE: Record<Lingua, Set<string>> = {
  it: new Set("il lo la gli le un una di del della che è e per con non sono voglio fai fammi questo questa come cosa anche più nel nella alla al se ma poi adesso ora dopo file sul sulla ciao grazie scrivi crea controlla verifica rendi".split(" ")),
  en: new Set("the a an of that is and for with not are want do make this how what also more in on to if but then now after file please hello thanks write create check verify can you".split(" ")),
};
export function linguaScritta(testi: string[]): Lingua | undefined {
  const conta: Record<Lingua, number> = { it: 0, en: 0 };
  for (const testo of testi)
    for (const parola of testo.toLowerCase().split(/[^a-zàèéìòù']+/))
      for (const l of ["it", "en"] as const) if (PAROLE[l].has(parola)) conta[l]++;
  const totale = conta.it + conta.en;
  if (totale < 3) return undefined;
  if (conta.it >= totale * 0.7) return "it";
  if (conta.en >= totale * 0.7) return "en";
  return undefined;
}

// La frase per le AI: rispondere nella lingua scelta, o in quella in cui la
// persona scrive.
export function istruzioneLingua(lingua: Lingua): string {
  return lingua === "en"
    ? "Reply to the person in English, unless they write to you in another language: then use theirs. Judge their language from all their messages, not from one very short message."
    : "Rispondi alla persona in italiano, salvo che ti scriva in un'altra lingua: allora usa la sua. Giudica la lingua da tutti i suoi messaggi, non da uno molto breve.";
}
