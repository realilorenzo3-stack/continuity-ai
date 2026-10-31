# Novità di Continuity

Ogni versione pubblicata, dalla più recente. Le versioni con «-beta» sono anteprime.

## Prossima versione

## 2.0.0-beta.18 — 2026-10-31

- **Windows senza WSL.** Da PowerShell, `irm https://raw.githubusercontent.com/realilorenzo3-stack/continuity-ai/main/scripts/install.ps1 | iex` installa Continuity direttamente su Windows, con il pacchetto pronto per Windows, in pochi secondi. Il programma porta il suo Node, quindi non serve installarlo. Non serve l'amministratore. Mette il comando `continuity` nel PATH e installa Codex e Claude Code se mancano. Funzionano anche `continuity update` (con `--indietro`) e `continuity uninstall` (con `--all`). WSL non serve più.
  - **Su Windows:**
    - Codex lavora nella sua sandbox per Windows: può scrivere nella cartella di lavoro e non nel resto del disco.
    - Claude Code chiede il permesso per ogni comando, perché su Windows non ha la sandbox, oppure lavora libero con `/permessi`.
    - Le chiavi stanno nell'archivio credenziali di Windows.
    - `/allega` apre la finestra «Apri» di Windows.
    - I progetti con percorsi molto lunghi funzionano.
- **Nomi di file con accenti:** una sessione si apre anche con file nuovi come `città.md` non ancora registrati in Git (prima Git li citava fra virgolette e la copia di lavoro non nasceva).
- Arrivati già con la 2.0.0-beta.17, senza essere nelle sue note: l'avviso quando la prima AI della sequenza ha finito i crediti, `/esci` che chiude subito, il permesso dato che compare come «✓ … consentito da te», l'allegato che non compare più fra le modifiche, i connettori subito disponibili dopo un riavvio del servizio.

## 2.0.0-beta.17 — 2026-10-31

- **Azioni bloccate di Codex: sempre un modo per consentirle.** Quando Codex non può usare un'app o un connettore senza permesso (per esempio un deploy su Vercel), a fine turno Continuity chiede se consentirlo. Se la domanda non compare, `/permessi` offre «Consenti le azioni bloccate, per il prossimo turno», e l'avviso lo dice. Prima poteva restare solo l'avviso, senza modo di rispondere.
- **Pubblicazione su GitHub con la tua identità.** I commit pubblicati da Continuity portano come autore e committer il tuo account GitHub collegato con `gh`: l'email di git se GitHub la conferma verificata, altrimenti il tuo indirizzo noreply di GitHub. Prima, senza un nome configurato in git, firmavano «Continuity <continuity@localhost>», e servizi come Vercel bloccavano il deploy. Senza un'identità, Continuity si ferma e spiega come configurarla. Il riconoscimento dell'aiuto delle AI resta nel messaggio del commit.
- **Preparazione per Windows senza WSL** (nel codice comune, ancora non distribuita): su Mac e Linux non cambia nulla di visibile.

## 2.0.0-beta.16 — 2026-10-31

- **OpenRouter, modelli riservati ad alcuni programmi.** Alcuni modelli gratuiti (per esempio `thinkingmachines/inkling:free`) OpenRouter li dà solo ai programmi della sua lista. Ora Continuity lo spiega in chiaro, segna il modello come non disponibile e propone `/modello`; prima interrompeva il turno con l'errore grezzo, o parlava di chiave rifiutata.
- **Apertura più rapida.** L'interfaccia conserva il risultato della sua compilazione e lo riusa alle aperture successive: il menu «/» è pronto prima.

## 2.0.0-beta.15 — 2026-10-31

- **Spazio su disco.** L'installatore controlla lo spazio libero prima di cominciare: sotto i 400 MB si ferma e lo dice, sotto 1 GB avvisa (Continuity, Codex e Claude Code ne occupano circa 1 GB).
- **Codex e Claude Code verificati dopo l'installazione.** Si controlla che funzionino davvero, non l'esito del loro installatore: se non vanno lo si dice, con il motivo (per esempio «spazio su disco esaurito») e il registro.
- **Claude Code o Codex mancanti: `/collega` e `continuity setup` propongono di installarli.** Prima l'errore vero («CLI non trovata») non veniva riconosciuto: si andava dritti al login, che falliva, e dopo un'installazione non riuscita compariva comunque «installato».
- **`continuity doctor`** cerca Codex e Claude Code come le sessioni (non solo nel PATH) e chiede Node 26.
- **Preparazione per Windows senza WSL** (nel codice comune, ancora non distribuita): su Mac e Linux non cambia nulla di visibile.

## 2.0.0-beta.14 — 2026-10-30

- **Codex e Claude Code: prima si guarda se ci sono già.** L'installatore li cerca con la stessa ricerca di Continuity (PATH, `~/.local/bin`, estensioni di VS Code, app ChatGPT, Homebrew) e controlla che rispondano. Uno che funziona non si tocca e non se ne installa un secondo. Solo se mancano, o se quelli trovati non rispondono, si installa la versione ufficiale, e lo si dice.

## 2.0.0-beta.13 — 2026-10-30

- **Claude Code come Codex**: si installa insieme a Continuity, con l'installatore ufficiale di Anthropic. Se manca, `/collega` e la configurazione lo installano da lì («Installalo adesso») e poi aprono il login. Lo stesso per Codex.
- **Menu dei comandi mentre scrivi**: scrivendo `/` compare sopra il campo l'elenco dei comandi, che si restringe lettera dopo lettera. ↑↓ sceglie, tab completa, invio esegue, esc chiude.
- **Groq e gli altri piani gratuiti con limiti al minuto**: l'avviso compare una volta per turno e spiega che il servizio lavora a scatti, invece di ripetersi a ogni attesa.
- **Windows**: l'installatore ripara da solo una distribuzione WSL predefinita che non esiste più (WSL_E_DISTRO_NOT_FOUND) e non chiude più la finestra di PowerShell in caso di problemi. Il comando `continuity` per PowerShell, se la sua distribuzione non risponde, usa quella predefinita.

## 2.0.0-beta.12 — 2026-10-30

- Installazione e `continuity update` scelgono davvero l'ultima versione. GitHub elenca le versioni per nome («beta.9» prima di «beta.11»), e veniva installata una versione vecchia; ora si confrontano i numeri. Lo stesso vale per l'avviso di versione nuova.

## 2.0.0-beta.11 — 2026-10-30

- **Installazione in pochi secondi**: ogni versione ha un pacchetto già pronto per macOS (Apple Silicon e Intel) e Linux (x64 e ARM), con Node incluso. L'installatore lo scarica, ne controlla l'impronta e lo estrae: niente npm, niente compilazione. Dove il pacchetto pronto non c'è, si installa dai sorgenti come prima.

- **Claude Code anche senza sandbox**: dove la sandbox del sistema non c'è (Linux senza bubblewrap, Ubuntu che la blocca), Claude lavora lo stesso e chiede il permesso per ogni comando, invece di non partire.
- **`/permessi`** (in inglese `/permissions`): «Chiede il permesso» oppure «Lavora libero (Bypass permissions)», con cui Claude non chiede mai nulla. Vale per tutte le sessioni.
- **Chiavi**: dove l'archivio protetto del sistema non c'è (per esempio Linux senza desktop), la chiave va in un file leggibile solo dal tuo utente; Continuity lo dice prima di salvarla.
- **L'installazione installa anche Codex** (gratuito, senza abbonamento), che serve ai servizi gratuiti per lavorare sui file. Se non riesce, Continuity si installa lo stesso e la configurazione lo ripropone.
- Bubblewrap, socat e il portachiavi di Linux sono consigliati, non più necessari.
- Installazione: non si interrompe più alla fine quando la variabile SHELL manca (per esempio lanciata da PowerShell dentro WSL).

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


