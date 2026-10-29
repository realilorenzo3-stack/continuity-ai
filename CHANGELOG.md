# Novità di Continuity

Ogni versione pubblicata, dalla più recente. Le versioni con «-beta» sono anteprime.

## Prossima versione

## 2.0.0-beta.3 — 2026-10-29

- Installazione: alla fine l'installatore dice con il comando esatto come far comparire `continuity` nel terminale già aperto (`source ~/.bashrc`), e raccoglie in un solo `sudo apt install` i programmi che mancano su Linux.
- Ubuntu 24.04: l'installatore e la configurazione danno i comandi esatti per sbloccare la sandbox di Claude Code (profilo AppArmor per bubblewrap); nella configurazione si copiano con invio.

## 2.0.0-beta.2 — 2026-10-29

Prima versione pubblica di Continuity 2.0 (anteprima).

- Lavora con più AI sullo stesso progetto: Codex e Claude Code con i tuoi abbonamenti, i servizi gratuiti con le tue chiavi (Groq, Google AI Studio, NVIDIA, Mistral, Cloudflare, Cohere…) e un modello sul tuo computer con Ollama. Quando un'AI finisce i crediti, il lavoro passa alla successiva.
- Flussi di lavoro (`/flusso`), compiti assegnati con la `@`, revisore ogni N turni (`/revisore`).
- Interfaccia in inglese o in italiano (`/language`, `/linguaggio`).
- macOS, Linux e Windows con WSL 2.
- Configurazione iniziale guidata: `continuity setup` (o `continuity configura`).
- Installazione con un comando, aggiornamento con `continuity update` (e `--indietro` per tornare alla versione di prima), disinstallazione con `continuity uninstall`.


