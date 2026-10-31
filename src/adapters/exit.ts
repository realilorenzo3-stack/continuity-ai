export const GEMINI_PERSONAL_UNAVAILABLE =
  "Gemini CLI non è più disponibile con login Google personale (UNSUPPORTED_CLIENT). Google indica Antigravity CLI; integrazione alternativa da validare. Nessuna API a consumo attivata.";

export function liveExitFailure(
  agent: string,
  code: number | null,
  signal: string | null,
  stderr: string,
): string | null {
  if (code === 0 && !signal) return null;
  if (
    agent === "gemini" &&
    /UNSUPPORTED_CLIENT|This client is no longer supported for Gemini Code Assist for individuals/.test(
      stderr,
    )
  )
    return GEMINI_PERSONAL_UNAVAILABLE;
  // Raw stderr can contain secrets: persist only a bounded, fixed classification.
  return `${agent}: processo terminato con ${signal ? "segnale " + signal : "exit " + code}; avvio/esecuzione non riusciti, nessun fallback automatico`;
}

// Il pezzo dell'errore di un'AI da mostrare alla persona: l'ultima riga che
// comincia con «Error», cercata nella coda e poi nell'inizio di ciò che l'AI
// ha scritto (una riga di Claude può superare la coda conservata, e allora il
// suo inizio resta solo nella testa); altrimenti la coda come prima.
export function pezzoDiErrore(inizio: string, coda: string, lunghezza = 160): string {
  for (const testo of [coda, inizio]) {
    const righe = testo.split(/\r?\n/).filter((r) => /^\s*(error|errore)\b/i.test(r));
    if (righe.length) return righe[righe.length - 1].trim().slice(0, lunghezza);
  }
  return coda.slice(0, lunghezza);
}
