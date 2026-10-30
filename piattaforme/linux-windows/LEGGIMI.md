# Distribuzione Linux e Windows (WSL 2)

**Stato: in sviluppo.**
- Si installa e funziona su Ubuntu: lo provano GitHub Actions e le prove di Lorenzo su un Ubuntu vero.
- Su Windows l'installazione è riuscita, ma il comando per PowerShell non è ancora verificato.

I lavori aperti sono in [CONTESTO_LAVORI.md](CONTESTO_LAVORI.md).

Su Windows Continuity gira dentro **WSL 2** (decisione del 29 ottobre). Su Windows nativo Claude Code non ha la sandbox; in WSL 2 Codex e Claude Code hanno quella di Linux, quindi la sicurezza è la stessa del Mac.

## Che cosa c'è qui

| File | Che cosa fa |
|---|---|
| `sistema.ts` | cartella dati in `~/.local/share` (o `$XDG_DATA_HOME`); link con `xdg-open`, oppure `wslview` / `explorer.exe` in WSL; appunti con `wl-clipboard`, `xclip` o `xsel`, oppure `clip.exe` e PowerShell in WSL; copia delle dipendenze con `cp -R --reflink=auto`; processi rimasti da `/proc`; tasto per incollare ctrl+shift+V |
| `portachiavi.ts` | chiavi in libsecret (`secret-tool`) su Linux; nell'archivio credenziali di Windows (PasswordVault, attraverso `powershell.exe`) in WSL; la chiave entra sempre dallo standard input |
| `allegati.ts` | finestra di scelta dei file con `zenity`, se c'è |
| `git.ts` | progetti sul disco di Windows (`/mnt/c/…`): fine riga di Git per Windows (`core.autocrlf`) e `core.fileMode=false` |
| `windows.sh` | il comando `continuity` per PowerShell (`%LOCALAPPDATA%\Continuity\bin\continuity.cmd`, che avvia `wsl.exe` nella cartella corrente), e il PATH dell'utente di Windows |

Il resto sta negli script comuni, che riconoscono il sistema da soli:
- `scripts/install.sh`, che indica i pacchetti mancanti e il profilo AppArmor;
- `scripts/install.ps1`, il comando unico per Windows;
- `scripts/uninstall.sh` e `scripts/nome-chiavi.sh`.

## Requisiti

- **Ubuntu e Debian:**
  ```sh
  sudo apt install git curl libsecret-tools gnome-keyring bubblewrap socat
  ```
  Opzionale: `wl-clipboard` o `xclip` per gli appunti.
- **Ubuntu 24.04:** il profilo AppArmor per `bwrap`. L'installatore e la configurazione danno i comandi esatti.
- **Servizi gratuiti** (Groq, NVIDIA, Google…): il programma Codex, senza abbonamento:
  ```sh
  curl -fsSL https://chatgpt.com/codex/install.sh | sh
  ```
- **Windows:** WSL 2 con una distribuzione Linux:
  ```powershell
  wsl --install
  ```

## Sviluppare dal PC Windows

1. In PowerShell, una volta: `wsl --install`, poi riavvia. Apri «Ubuntu» e crea il tuo utente.
2. Dentro Ubuntu:
   ```sh
   sudo apt install git curl libsecret-tools gnome-keyring bubblewrap socat
   ```
   Poi installa GitHub CLI e collegala (vedi CONTESTO_LAVORI, voce «Preparare il PC»).
3. Clona la repository **dentro Linux, non su `/mnt/c`**, dove sarebbe molto più lenta:
   ```sh
   mkdir -p ~/progetti && cd ~/progetti
   gh repo clone realilorenzo3-stack/Continuity_2.0
   ```
4. Toolchain (Node 26.10 e pnpm), nella cartella dati di sviluppo:
   ```sh
   npm install --prefix ~/.local/share/Continuity_2.0/toolchain --no-audit --no-fund --save-exact node@26.10.0 pnpm@10.17.1
   ```
   Se npm non c'è, prima `sudo apt install npm`.
5. Dipendenze e prove:
   ```sh
   . ./scripts/toolchain.sh
   pnpm install --frozen-lockfile
   pnpm test
   ```
6. Per provare Continuity dalla repository: `bin/continuity2` (dati in `~/.local/share/Continuity_2.0`, porta 4318).

Da VS Code su Windows: estensione «WSL», poi «Apri cartella in WSL» su `~/progetti/Continuity_2.0`. Codex e Claude Code vanno installati e collegati **dentro Ubuntu**.
