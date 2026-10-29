// Le AI che una sessione può usare, in un solo posto: connect, la rotazione e
// l'aiuto leggevano elenchi diversi, e connect proponeva di collegare
// Antigravity mentre /ordine lo rifiutava (collaudo del 3 ottobre, CT-013).
export const PROVIDER_SESSIONE = ["codex", "claude"] as const;
export type ProviderSessione = (typeof PROVIDER_SESSIONE)[number];

// Presenti nel codice ma esclusi dalle sessioni, con il motivo da mostrare.
export const PROVIDER_ESCLUSI: Record<string, string> = {
  antigravity:
    "escluso dalle sessioni: i termini di Google non consentono l'uso tramite strumenti di terze parti",
  gemini: "il percorso con account personale Gemini non è più disponibile",
};
