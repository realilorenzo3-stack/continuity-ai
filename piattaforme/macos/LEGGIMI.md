# Distribuzione macOS

**Stato: completa e funzionante.** È la distribuzione su cui Continuity è nato. Ha passato sette collaudi indipendenti, e le sue prove girano a ogni versione su macOS (GitHub Actions) e sul Mac di sviluppo.

## Che cosa c'è qui

| File | Che cosa fa |
|---|---|
| `sistema.ts` | cartella dati in `~/Library/Application Support`, link con `open`, appunti con `pbcopy`/`pbpaste`, copia delle dipendenze con la clonazione di APFS (`cp -cR`), processi rimasti con `lsof`, tasto per incollare cmd+V |
| `portachiavi.ts` | chiavi nel Portachiavi con `security`; voce senza app fidate, così il Mac chiede il permesso alla prima lettura dopo ogni avvio |
| `allegati.ts` | finestra del Finder per scegliere i file da allegare (`osascript`) |

Le altre parti per il Mac stanno negli script comuni, che riconoscono il sistema da soli:
- `scripts/install.sh` (cartella dati, comando in `/opt/homebrew/bin` o `~/.local/bin`);
- `scripts/uninstall.sh` e `scripts/nome-chiavi.sh` (voci del Portachiavi).

## Installare e provare

- Per chi usa Continuity: `curl -fsSL https://raw.githubusercontent.com/realilorenzo3-stack/continuity-ai/main/scripts/install.sh | sh`
- Per lo sviluppo: `bin/continuity2`, che gira dalla repository, con i dati in `~/Library/Application Support/Continuity_2.0` e la porta 4318.
- Le prove: `pnpm test`.

## Requisiti

- macOS su Apple Silicon o Intel;
- Git (`xcode-select --install`);
- Node lo scarica l'installatore.

Le sandbox di Codex e Claude Code sono quelle di macOS: nessun pacchetto in più.
