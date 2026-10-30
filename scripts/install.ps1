# Installa Continuity su Windows, in WSL 2 (decisione del 29 ottobre 2026:
# Windows con WSL). Da PowerShell:
#   irm https://raw.githubusercontent.com/realilorenzo3-stack/continuity-ai/main/scripts/install.ps1 | iex
# Continuity gira dentro Linux (WSL): così Codex e Claude Code lavorano come su
# Mac e Linux. L'installatore di Linux crea anche il comando «continuity» per
# PowerShell e il Prompt dei comandi.
#
# Con «irm | iex» lo script gira dentro la finestra della persona: niente
# «exit», che la chiuderebbe prima che si leggano i messaggi (30 ottobre).
$installatore = 'https://raw.githubusercontent.com/realilorenzo3-stack/continuity-ai/main/scripts/install.sh'
# wsl.exe scrive in UTF-16: con WSL_UTF8 i nomi delle distribuzioni si leggono.
$env:WSL_UTF8 = '1'

function Scrivi([string]$testo) { Write-Host $testo }

function Installa-Continuity {
  if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) {
    Scrivi 'Continuity su Windows gira in WSL 2, che qui non c''è.'
    Scrivi '1. Apri PowerShell come amministratore e scrivi:  wsl --install -d Ubuntu'
    Scrivi '2. Riavvia il computer, apri «Ubuntu» dal menu Start e crea il tuo utente Linux.'
    Scrivi '3. Torna qui e rilancia questo comando.'
    return
  }

  # Le distribuzioni installate (senza quelle interne di Docker Desktop).
  $distribuzioni = @(& wsl.exe -l -q 2>$null | ForEach-Object { ($_ -replace "`0", '').Trim() } |
      Where-Object { $_ -and $_ -notmatch '^docker-desktop' })
  if ($distribuzioni.Count -eq 0) {
    Scrivi 'WSL c''è, ma non ha ancora una distribuzione Linux.'
    Scrivi '1. Scrivi:  wsl --install -d Ubuntu   (poi riavvia, se lo chiede)'
    Scrivi '2. Apri «Ubuntu» dal menu Start e crea il tuo utente Linux.'
    Scrivi '3. Torna qui e rilancia questo comando.'
    return
  }

  # La distribuzione predefinita risponde? Se WSL ne ricorda una che non c'è
  # più (WSL_E_DISTRO_NOT_FOUND, prova di Lorenzo del 30 ottobre), si sceglie
  # una di quelle installate, Ubuntu se c'è, e la si rende predefinita.
  & wsl.exe -e true 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) {
    $scelta = ($distribuzioni | Where-Object { $_ -match '^Ubuntu' } | Select-Object -First 1)
    if (-not $scelta) { $scelta = $distribuzioni[0] }
    Scrivi "La distribuzione predefinita di WSL non risponde: uso «$scelta» e la rendo predefinita."
    & wsl.exe --set-default $scelta | Out-Null
    & wsl.exe -e true 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) {
      Scrivi "«$scelta» non si avvia. Apri «$scelta» dal menu Start una volta (crea il tuo utente Linux, se lo chiede), poi rilancia questo comando."
      Scrivi "Distribuzioni trovate: $($distribuzioni -join ', ')"
      return
    }
  }

  Scrivi 'Installo Continuity in WSL (Linux)...'
  & wsl.exe -e sh -c "curl -fsSL '$installatore' | sh"
  if ($LASTEXITCODE -ne 0) {
    Scrivi 'L''installazione in WSL non è riuscita: guarda i messaggi qui sopra.'
    return
  }
  Scrivi ''
  Scrivi 'Fatto. Chiudi questa finestra, apri un nuovo PowerShell nella cartella di un progetto e scrivi:'
  Scrivi '  continuity setup     (la prima volta: configurazione)'
  Scrivi '  continuity           (le volte dopo)'
}

Installa-Continuity
