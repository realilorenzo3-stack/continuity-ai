# Distribuzione Windows (nativo, senza WSL)

**Stato: completa, in collaudo** (lavoro 7, decisione di Lorenzo del 30 ottobre sera; installatore e pacchetto del 31 ottobre). Si sviluppa e si prova dal PC Windows, in PowerShell, senza WSL. Il piano e i lavori aperti sono in [`../linux-windows/CONTESTO_LAVORI.md`](../linux-windows/CONTESTO_LAVORI.md), sezione 7.

## Installare

Da PowerShell, senza amministratore:

```powershell
irm https://raw.githubusercontent.com/realilorenzo3-stack/continuity-ai/main/scripts/install.ps1 | iex
```

`scripts/install.ps1` scarica il pacchetto pronto `continuity-<versione>-win32-x64.tar.gz` della versione più recente e ne controlla l'impronta (SHA-256). Poi:
- lo apre con `tar.exe` di Windows in `%LOCALAPPDATA%\Continuity` (`app\`, `node\node.exe`), tenendo da parte la versione di prima (`app.precedente`);
- crea il comando `%LOCALAPPDATA%\Continuity\bin\continuity.cmd` e mette la cartella nel PATH dell'utente;
- installa Codex e Claude Code con i loro installatori ufficiali, se mancano.

Il pacchetto lo prepara `scripts/pacchetto.sh … win32-x64` su Windows (lavoro `pacchetti` di `.github/workflows/versione.yml`), con Node per Windows e una `node_modules` piatta.

Comandi del programma installato:
- `continuity update` (`aggiorna.ps1`): l'ultima versione;
- `continuity update --indietro`: la versione di prima;
- `continuity uninstall` (`disinstalla.ps1`): toglie il programma e lascia i dati;
- `continuity uninstall --all`: anche dati e chiavi, dopo aver scritto ELIMINA.

## Che cosa c'è qui

| File | Che cosa fa |
|---|---|
| `sistema.ts` | cartella dati in `%LOCALAPPDATA%`; link con `explorer.exe`; appunti con Windows PowerShell (`Set-Clipboard` e `Get-Clipboard`, in UTF-8); copia delle dipendenze fatta da Node (`fs.cpSync`); nessuna sandbox per Claude Code; la sandbox di Codex (`windows.sandbox="unelevated"`); incolla con ctrl+V |
| `portachiavi.ts` | chiavi nell'archivio credenziali di Windows (PasswordVault, attraverso `powershell.exe`), lo stesso usato da WSL; la chiave entra sempre dallo standard input |
| `allegati.ts` | la finestra «Apri» di Windows (Windows Forms da PowerShell) per scegliere i file, sempre davanti al terminale |
| `processi.ts` | albero dei processi fermato con `taskkill /T /F`; processi riconosciuti con `Win32_Process`; nessuna finestra per i programmi avviati; variabili di sistema negli ambienti ridotti; ricerca nel PATH con `where.exe` (valida 30 s) |
| `git.ts` | `core.longpaths=true` per ogni Git di Continuity (copie di lavoro oltre 260 caratteri); le fine riga restano come sul Mac |
| `aggiorna.ps1`, `disinstalla.ps1`, `togli-chiavi.ts` | aggiornamento e disinstallazione del programma installato |

`scripts/install.ps1` sta in `scripts/` perché il comando pubblico lo scarica da lì.

## Requisiti

- **Git per Windows** (`winget install Git.Git`), che porta anche Git Bash, necessario a Claude Code. Node non serve: il pacchetto ha il suo.
- Per sviluppare: **Node 26** (`winget install OpenJS.NodeJS`) e pnpm.

## Sviluppare dal PC Windows

In PowerShell, nella cartella della repository (per esempio `C:\Users\<nome>\progetti\Continuity_2.0`):

```powershell
git pull
pnpm install
pnpm test
bin\continuity2.cmd        # Continuity dai sorgenti: dati in %LOCALAPPDATA%\Continuity_2.0, porta 4318
```

`pnpm` si attiva con `corepack enable` oppure `npm install -g pnpm@10.17.1`.

Il servizio resta acceso fra un'apertura e l'altra. Dopo una modifica del codice viene sostituito alla prima apertura, se non sta lavorando. Un'interfaccia rimasta aperta da prima continua a usare il codice vecchio: va chiusa.
