# Distribuzione Windows (nativo, senza WSL)

**Stato: in sviluppo** (lavoro 7, decisione di Lorenzo del 30 ottobre sera). Si sviluppa e si prova dal PC Windows, in PowerShell, senza WSL. Il piano e i lavori aperti sono in [`../linux-windows/CONTESTO_LAVORI.md`](../linux-windows/CONTESTO_LAVORI.md), sezione 7.

Finché questa distribuzione non è pronta, su Windows si installa ancora quella con WSL (`piattaforme/linux-windows/`).

## Che cosa c'è qui

| File | Che cosa fa |
|---|---|
| `sistema.ts` | cartella dati in `%LOCALAPPDATA%`; link con `explorer.exe`; appunti con Windows PowerShell (`Set-Clipboard` e `Get-Clipboard`, in UTF-8); copia delle dipendenze fatta da Node (`fs.cpSync`); nessuna sandbox per Claude Code; incolla con ctrl+V |
| `portachiavi.ts` | chiavi nell'archivio credenziali di Windows (PasswordVault, attraverso `powershell.exe`), lo stesso usato da WSL; la chiave entra sempre dallo standard input |
| `allegati.ts` | la finestra «Apri» di Windows (Windows Forms da PowerShell) per scegliere i file |

## Requisiti

- **Node 26** (`winget install OpenJS.NodeJS`) e **Git per Windows** (`winget install Git.Git`), che porta anche Git Bash, necessario a Claude Code.

## Sviluppare dal PC Windows

In PowerShell, nella cartella della repository (per esempio `C:\Users\<nome>\progetti\Continuity_2.0`):

```powershell
git pull
pnpm install
pnpm test
```

`pnpm` si attiva con `corepack enable` oppure `npm install -g pnpm@10.17.1`.
