# Novità di Continuity

Ogni versione pubblicata, dalla più recente. Le versioni con «-beta» sono anteprime.

## Prossima versione

## 2.0.0-beta.9 — 2026-10-30

- Windows: il comando `continuity` per PowerShell usa la distribuzione WSL predefinita invece di cercarne una chiamata «Ubuntu» (falliva con WSL_E_DISTRO_NOT_FOUND dove la distribuzione si chiama, per esempio, «Ubuntu-24.04»).

## 2.0.0-beta.8 — 2026-10-30

- Groq, NVIDIA, Google e gli altri servizi gratuiti lavorano sui file attraverso il programma Codex (non serve l'abbonamento ChatGPT). Se Codex non è installato, Continuity lo dice chiaramente e offre il comando ufficiale per installarlo: subito dopo aver collegato la chiave, quando scrivi un messaggio, e nella configurazione iniziale («il tuo sistema»).
- Gli avvisi in alto a destra vanno a capo invece di tagliarsi.

## 2.0.0-beta.7 — 2026-10-30

- Scrivendo a un'AI che non è collegata (manca la chiave, il login dell'abbonamento o il programma), Continuity apre un riquadro: «Collegalo adesso» porta direttamente a `/collega` per quel servizio. Il messaggio è uno solo e dice sempre il comando.
- `/collega` con Codex o Claude Code apre il loro login ufficiale (che apre il browser) senza uscire da Continuity, e al ritorno controlla che il collegamento sia riuscito. Se il programma non è installato, il comando ufficiale per installarlo va negli appunti.

## 2.0.0-beta.6 — 2026-10-30

- L'avviso di versione nuova si controlla a ogni apertura di Continuity (prima una volta al giorno, e una versione uscita da poco poteva non comparire) e resta a schermo 30 secondi.

## 2.0.0-beta.5 — 2026-10-30

- Linux e Windows: niente più «Mac» nei testi. «Il modello sul tuo computer», «Qwen sul computer», e il tasto giusto per incollare (ctrl+shift+V su Linux e in Windows Terminal, cmd+V sul Mac).
- `/collega`: se la chiave non si può salvare, il motivo si legge intero in un riquadro, con «Riprova a salvarla», invece di un avviso tagliato. Su Linux il motivo dice che cosa manca (secret-tool) o che il portachiavi non è attivo nella sessione, e come sistemarlo.
- Dopo il collegamento la nota dice dove sta la chiave sul tuo sistema (Portachiavi, portachiavi di Linux, archivio credenziali di Windows).
- Il tasto tab per incollare dagli appunti, su Linux senza wl-clipboard o xclip, dice di incollare con ctrl+shift+V.

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


