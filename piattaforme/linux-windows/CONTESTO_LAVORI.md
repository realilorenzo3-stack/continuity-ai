# Prossimi lavori: distribuzione Linux e Windows

File momentaneo (30 ottobre 2026). È la lista dei lavori aperti di questa distribuzione, per chi lavora dal PC Windows: Lorenzo, e le AI che lo aiutano. Quando un lavoro è fatto e verificato, si toglie da qui e si scrive in `docs/CONTEXT.md`. Quando la lista è vuota, il file si elimina.

**Prima di cominciare leggi:**
- `AGENTS.md`;
- `piattaforme/LEGGIMI.md`, con le regole per restare allineati al Mac;
- `piattaforme/linux-windows/LEGGIMI.md`;
- le ultime voci di `docs/CONTEXT.md`.

## Dove siamo

- **Ubuntu (prove di Lorenzo, 29–30 ottobre).** Installazione con un comando, aggiornamento, configurazione iniziale e `/collega` funzionano. Corretti strada facendo:
  - il PATH nel terminale già aperto;
  - i pacchetti mancanti raccolti in un solo `apt install`, e i comandi per AppArmor;
  - i testi che dicevano «Mac»;
  - il tasto per incollare;
  - gli errori tagliati;
  - il programma Codex mancante per i servizi gratuiti.
- **GitHub Actions su Ubuntu 24.04:** tutte le prove, più installazione e disinstallazione vere, a ogni `git push`.
- **Windows.**
  - `install.ps1` ha installato Continuity in WSL.
  - Il comando `continuity` di PowerShell dava `WSL_E_DISTRO_NOT_FOUND`: cercava una distribuzione chiamata «Ubuntu». Corretto nella 2.0.0-beta.9, ma **non ancora verificato**.
  - L'ultima prova ha dato di nuovo `WSL_E_DISTRO_NOT_FOUND`, in attesa di `wsl -l -v`.
- **Mai provato su un Windows vero:**
  - l'archivio credenziali di Windows;
  - `git.exe` da WSL;
  - il browser per i login;
  - gli appunti;
  - Ollama di Windows visto da WSL.

## Decisioni del 30 ottobre (obiettivo: incollare il comando, configurare, partire subito)
- **Claude senza sandbox**, dove manca (Linux senza bubblewrap, AppArmor che lo blocca), lavora lo stesso e chiede il permesso per ogni comando; `/permessi` → «Lavora libero (Bypass permissions)» non chiede più nulla. Fatto nella 2.0.0-beta.10, da provare su Ubuntu.
- **Chiavi**: file protetto dove l'archivio del sistema manca. Fatto, da provare.
- **Codex installato insieme a Continuity**, con l'installatore ufficiale. Fatto, da provare.
- **Installazione in pochi secondi, come opencode**: pacchetto già pronto per ogni sistema (fatto, da verificare al primo rilascio: lavoro 0). Poi **Windows nativo, senza WSL** (lavoro 7).

## Lavori aperti, in ordine

### 0. Pacchetto già pronto (installazione in pochi secondi)
- [x] Fatto il 30 ottobre (`scripts/pacchetto.sh`, lavoro «pacchetti» di `versione.yml`, ramo `CONTINUITY_PRONTO` di `install.sh`): sul Mac l'installazione dal pacchetto pronto richiede circa 4 secondi più il download (69 MB).
- [ ] Verificare il primo rilascio con i pacchetti: che i quattro sistemi di GitHub (`ubuntu-24.04`, `ubuntu-24.04-arm`, `macos-15`, `macos-15-intel`) li preparino, e un'installazione vera su Ubuntu (x64) dal pacchetto pronto.


### 1. Preparare il PC Windows per lo sviluppo
- [ ] WSL 2 con Ubuntu 24.04. Dentro Ubuntu: `git`, `curl`, `npm`, `libsecret-tools`, `gnome-keyring`, `bubblewrap`, `socat`.
- [ ] GitHub CLI dentro Ubuntu (https://github.com/cli/cli/blob/trunk/docs/install_linux.md), poi `gh auth login`.
- [ ] Clonare `realilorenzo3-stack/Continuity_2.0` in `~/progetti`, toolchain, `pnpm install`, `pnpm test` verde (vedi `LEGGIMI.md`).
- [ ] Codex e Claude Code installati e collegati dentro Ubuntu.

### 2. Windows: il comando `continuity` da PowerShell
- [ ] Capire il `WSL_E_DISTRO_NOT_FOUND` rimasto. Da guardare:
  - `wsl -l -v`;
  - il contenuto di `%LOCALAPPDATA%\Continuity\bin\continuity.cmd`;
  - quale distribuzione è predefinita e in quale è installato Continuity.
- [ ] `continuity.cmd` deve funzionare anche se la distribuzione predefinita cambia. Da decidere: salvare il nome vero della distribuzione all'installazione (da `install.ps1`, che lo conosce) oppure usare sempre la predefinita.
- [ ] README e `install.ps1`: dire chiaramente in quale terminale va ciascun comando. `irm … | iex` scritto in Ubuntu o in Git Bash dava «iex not found».
- [ ] `install.ps1`: controllare che dentro WSL ci siano `curl` e `git` prima di installare.

### 3. Windows: le parti mai provate
- [ ] Chiavi nell'archivio credenziali di Windows (`portachiaviWindows`): salvare, leggere, togliere, disinstallare. Controllare la lentezza: PowerShell parte a ogni lettura, con una memoria di 30 secondi.
- [ ] Progetti su `/mnt/c`:
  - fine riga con `core.autocrlf` letto da `git.exe`;
  - file aperti in un programma di Windows (il messaggio «Non posso scrivere…»);
  - tempi della prima copia con un progetto grande.
- [ ] Login di Codex e Claude Code dalla configurazione: si apre il browser di Windows?
- [ ] Appunti: `clip.exe` e `Get-Clipboard`; ctrl+shift+V in Windows Terminal.
- [ ] Ollama installato su Windows: da WSL `127.0.0.1:11434` di solito non risponde. Da decidere:
  - cercarlo all'indirizzo di Windows (gateway di WSL, oppure `networkingMode=mirrored`);
  - oppure dire di installarlo dentro Ubuntu, come fa oggi la configurazione.

### 4. Linux: da completare
- [ ] Portachiavi senza desktop: deciso il 30 ottobre, file protetto `chiavi.json` (600) con avviso (`portachiaviFile`, `archivioScelto`). Da provare su un Ubuntu vero senza gnome-keyring e via SSH.
- [ ] Sandbox di Codex su Linux: verificare che funzioni (Landlock/seccomp) su Ubuntu e Debian, e che cosa succede dove manca.
- [ ] Interfaccia nei terminali di Linux (GNOME Terminal, Konsole) e in Windows Terminal: colori, mouse, caratteri, ridimensionamento.
- [ ] Debian 12: una prova completa.

### 5. Messaggi e interfaccia
- [ ] Revisione di **tutti** i messaggi che la persona vede (errori, avvisi, riquadri). Ognuno deve essere:
  - chiaro, intero, senza tagli;
  - giusto per il sistema in uso;
  - con il passo successivo indicato.

  È il punto debole emerso dalle prove su Ubuntu.
- [ ] Configurazione iniziale: guidare l'installazione di Codex quando si collegano solo servizi gratuiti.

### 7. Windows nativo (senza WSL)
- [ ] Continuity come programma Windows vero, installato con `irm … | iex` da PowerShell, senza WSL: processi, percorsi, chiavi nell'archivio di Windows, copia di lavoro, comando `continuity`. Claude Code su Windows nativo non ha sandbox: lavora chiedendo il permesso (o libero). Codex usa la sua sandbox di Windows. È il lavoro più grande: da fare dal PC Windows.

### 6. Prove automatiche e collaudo
- [ ] GitHub Actions: aggiungere Windows con WSL (per esempio l'azione `Vampire/setup-wsl`), almeno per installazione e comando per PowerShell.
- [ ] Collaudo indipendente (Codex) su un Ubuntu pulito e su un Windows con WSL, con le schermate, prima della versione 2.0.0 stabile.

## Da ricordare

- Chiavi vere e credenziali non si leggono e non si stampano mai. Nelle prove si usano chiavi inventate e archivi finti.
- Le prove in `tests/` non usano mai l'archivio vero delle chiavi (`portachiaviDiSistema` con `VITEST`).
- Mai provider a pagamento senza permesso.
- Nei terminali di prova si scrivono solo comandi, mai testo libero (arriverebbe a un'AI vera).
