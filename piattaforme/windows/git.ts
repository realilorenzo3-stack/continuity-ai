// Windows nativo: l'impostazione di Git che Continuity non può ignorare.
// Continuity lancia Git senza le impostazioni personali e di sistema
// (src/git/ambiente.ts). Su Windows serve core.longpaths: la copia di lavoro
// sta in profondità nella cartella dati (…\runs\<id>\worktree\…), e un file
// oltre 260 caratteri faceva fallire la sessione («Filename too long»,
// collaudo del 31 ottobre).
//
// core.autocrlf invece resta spento, come sul Mac e su Linux. Provato il 31
// ottobre: con la scelta di Git per Windows (true) la copia di lavoro veniva
// estratta con le fine riga di Windows, e nei progetti con file LF (quelli
// scritti dalle AI e da molti editor) ogni consegna risultava in conflitto
// con la persona. Senza, un progetto estratto con le fine riga di Windows
// risulta tutto modificato, ma quello stato entra nella copia così com'è e
// le fine riga della persona restano le sue.
// Parte della distribuzione Windows (piattaforme/windows/LEGGIMI.md).

// Come variabili d'ambiente di Git (GIT_CONFIG_COUNT, Git 2.31 e successivi):
// valgono più dei file di configurazione, senza scrivere nulla nel
// repository della persona.
export function impostazioniGitWindows(): Record<string, string> {
  return { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "core.longpaths", GIT_CONFIG_VALUE_0: "true" };
}
