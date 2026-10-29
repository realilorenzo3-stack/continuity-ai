# Installa Continuity su Windows, in WSL 2 (decisione del 29 ottobre 2026:
# Windows con WSL). Da PowerShell:
#   irm https://raw.githubusercontent.com/realilorenzo3-stack/continuity-ai/main/scripts/install.ps1 | iex
# Continuity gira dentro Linux (WSL): così Codex e Claude Code lavorano nella
# loro sandbox, come su Mac e Linux. L'installatore di Linux crea anche il
# comando «continuity» per PowerShell e il Prompt dei comandi.
$ErrorActionPreference = 'Stop'
$installatore = 'https://raw.githubusercontent.com/realilorenzo3-stack/continuity-ai/main/scripts/install.sh'

function Scrivi([string]$testo) { Write-Host $testo }

if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) {
  Scrivi 'Continuity su Windows gira in WSL 2, che qui non c''è.'
  Scrivi '1. Apri PowerShell come amministratore e scrivi:  wsl --install'
  Scrivi '2. Riavvia il computer, apri «Ubuntu» dal menu Start e crea il tuo utente Linux.'
  Scrivi '3. Torna qui e rilancia questo comando.'
  exit 1
}

# Una distribuzione Linux pronta? (wsl -e true risponde solo se c'è.)
& wsl.exe -e true 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
  Scrivi 'WSL c''è, ma non ha ancora una distribuzione Linux pronta.'
  Scrivi '1. Scrivi:  wsl --install -d Ubuntu   (poi riavvia, se lo chiede)'
  Scrivi '2. Apri «Ubuntu» dal menu Start e crea il tuo utente Linux.'
  Scrivi '3. Torna qui e rilancia questo comando.'
  exit 1
}

Scrivi 'Installo Continuity in WSL (Linux)...'
& wsl.exe -e sh -c "curl -fsSL '$installatore' | sh"
if ($LASTEXITCODE -ne 0) {
  Scrivi 'L''installazione in WSL non è riuscita: guarda i messaggi qui sopra.'
  exit $LASTEXITCODE
}
Scrivi ''
Scrivi 'Fatto. Apri un nuovo PowerShell nella cartella di un progetto e scrivi:  continuity'
