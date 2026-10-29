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
