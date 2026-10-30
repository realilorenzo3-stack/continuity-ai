// Codex o Claude Code ci sono già, e funzionano? Con la stessa ricerca di
// Continuity (PATH, ~/.local/bin, estensioni di VS Code, Homebrew, cartelle
// note) e la prova «--version». Lo usa l'installatore prima di installarli,
// per non metterne un secondo accanto a uno che c'è già (richiesta di Lorenzo
// del 30 ottobre: «ho paura di mandare tutto in conflitto»).
//   node --import tsx scripts/trova-cli.ts <codex|claude> <cartella dati>
// Esce 0 e scrive «percorso<TAB>versione» se ce n'è uno che funziona; esce 1
// e scrive i percorsi trovati che non rispondono (uno per riga), se ce ne sono.
import { existsSync } from "node:fs";
import { pickProvider, providerCandidates } from "../src/adapters/resolve.js";

const nome = process.argv[2];
const dati = process.argv[3] ?? "";
if (nome !== "codex" && nome !== "claude") {
  console.error("Uso: trova-cli.ts <codex|claude> <cartella dati>");
  process.exit(2);
}
const candidati = providerCandidates(nome, dati);
try {
  const trovato = pickProvider(nome, candidati);
  console.log(`${trovato.path}\t${trovato.version}`);
  process.exit(0);
} catch {
  for (const p of [...new Set(candidati)].filter((p) => existsSync(p))) console.log(p);
  process.exit(1);
}
