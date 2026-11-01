# Installa Continuity su Windows, senza WSL (lavoro 7, Windows nativo, 31
# ottobre 2026). Da PowerShell:
#   irm https://raw.githubusercontent.com/realilorenzo3-stack/continuity-ai/main/scripts/install.ps1 | iex
# Scarica il pacchetto pronto per Windows (Node, programma, dipendenze) della
# versione più recente, ne controlla l'impronta (SHA-256), lo mette in
# %LOCALAPPDATA%\Continuity, crea il comando «continuity» e installa Codex e
# Claude Code con i loro installatori ufficiali se mancano. Niente
# amministratore, niente npm, niente compilazione.
#
# Con «irm | iex» lo script gira dentro la finestra della persona: niente
# «exit», che la chiuderebbe prima che si leggano i messaggi (30 ottobre).
#
# Per le prove e per «continuity update» (piattaforme/windows/aggiorna.ps1):
#   CONTINUITY_VERSIONE   una versione precisa (senza «v»)
#   CONTINUITY_PACCHETTO  un pacchetto .tar.gz già sul disco, senza scaricare
#   CONTINUITY_DATA_DIR   un'altra cartella al posto di %LOCALAPPDATA%\Continuity
#   CONTINUITY_API, CONTINUITY_RILASCI  altri indirizzi per le versioni
#   CONTINUITY_SENZA_CODEX=1, CONTINUITY_SENZA_CLAUDE=1, CONTINUITY_SENZA_PATH=1

function Installa-Continuity {
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'
  # Windows PowerShell 5.1 non usa TLS 1.2 da sé: GitHub lo richiede.
  try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch {}

  $repo = 'realilorenzo3-stack/continuity-ai'
  $api = if ($env:CONTINUITY_API) { $env:CONTINUITY_API } else { "https://api.github.com/repos/$repo" }
  $rilasci = if ($env:CONTINUITY_RILASCI) { $env:CONTINUITY_RILASCI } else { "https://github.com/$repo/releases/download" }
  $dati = if ($env:CONTINUITY_DATA_DIR) { $env:CONTINUITY_DATA_DIR } else { Join-Path $env:LOCALAPPDATA 'Continuity' }
  $piattaforma = 'win32-x64'

  if (-not [Environment]::Is64BitOperatingSystem) {
    Write-Host 'Continuity per Windows richiede Windows a 64 bit.'
    return
  }
  if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') {
    Write-Host 'Su Windows ARM Continuity usa il pacchetto x64 (con l''emulazione di Windows).'
  }
  if (-not (Get-Command tar.exe -ErrorAction SilentlyContinue)) {
    Write-Host 'Manca tar.exe, che Windows 10 e 11 hanno di serie: aggiorna Windows e ripeti.'
    return
  }

  # Lo spazio libero: Continuity, Codex e Claude Code occupano circa 1 GB, e
  # l'installatore di Claude Code ne usa il doppio mentre copia (31 ottobre,
  # il disco pieno sull'Ubuntu di Lorenzo). Sotto 400 MB non si comincia.
  try {
    $disco = Get-PSDrive -Name ($env:LOCALAPPDATA.Substring(0, 1)) -ErrorAction Stop
    $liberiMb = [int]($disco.Free / 1MB)
    if ($liberiMb -lt 400) {
      Write-Host "Spazio libero insufficiente: $liberiMb MB. Ne servono almeno 400 (meglio 1 GB): libera spazio e ripeti."
      return
    }
    if ($liberiMb -lt 1024) { Write-Host "Attenzione: restano solo $liberiMb MB liberi. Continuity, Codex e Claude Code occupano circa 1 GB." }
  } catch {}

  New-Item -ItemType Directory -Force -Path $dati | Out-Null
  $lavoro = Join-Path $dati ('installazione-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
  New-Item -ItemType Directory -Force -Path $lavoro | Out-Null
  try {
    # 1. Il pacchetto: dal disco (prove) o dalla versione pubblicata.
    $pacchetto = Join-Path $lavoro 'pacchetto.tar.gz'
    if ($env:CONTINUITY_PACCHETTO) {
      Copy-Item -LiteralPath $env:CONTINUITY_PACCHETTO -Destination $pacchetto
      Write-Host "Installo Continuity dal pacchetto $env:CONTINUITY_PACCHETTO"
    } else {
      $versione = $env:CONTINUITY_VERSIONE
      if (-not $versione) { $versione = Ultima-Versione $api }
      if (-not $versione) {
        Write-Host "Non trovo l'ultima versione di Continuity su GitHub ($repo): controlla la connessione e riprova."
        return
      }
      $nome = "continuity-$versione-$piattaforma.tar.gz"
      $somme = (Invoke-WebRequest -UseBasicParsing -Uri "$rilasci/v$versione/SHA256SUMS").Content
      if ($somme -is [byte[]]) { $somme = [Text.Encoding]::UTF8.GetString($somme) }
      $atteso = $null
      foreach ($riga in ($somme -split "`n")) {
        if ($riga -match '^([0-9a-f]{64})\s+\*?(.+?)\s*$' -and $Matches[2] -eq $nome) { $atteso = $Matches[1] }
      }
      if (-not $atteso) {
        Write-Host "La versione $versione non ha ancora il pacchetto per Windows: riprova con la prossima versione."
        return
      }
      Write-Host "Scarico Continuity $versione (pronto per Windows)"
      Invoke-WebRequest -UseBasicParsing -Uri "$rilasci/v$versione/$nome" -OutFile $pacchetto
      $vero = (Get-FileHash -Algorithm SHA256 -LiteralPath $pacchetto).Hash.ToLower()
      if ($vero -ne $atteso) {
        Write-Host 'Il pacchetto scaricato non corrisponde alla sua impronta (SHA-256): installazione interrotta.'
        return
      }
    }

    # 2. Si apre nella cartella dati (stesso disco: poi gli spostamenti sono
    # istantanei).
    $estratto = Join-Path $lavoro 'estratto'
    New-Item -ItemType Directory -Force -Path $estratto | Out-Null
    # Il tar di Windows: quello di Git (se viene prima nel PATH) legge «C:»
    # come un computer remoto.
    $tar = Join-Path $env:SystemRoot 'System32\tar.exe'
    if (-not (Test-Path $tar)) { $tar = 'tar.exe' }
    & $tar -xzf $pacchetto -C $estratto
    if ($LASTEXITCODE -ne 0) { Write-Host 'Il pacchetto non si apre: installazione interrotta.'; return }
    $radice = Get-ChildItem -LiteralPath $estratto -Directory | Select-Object -First 1
    if (-not $radice -or -not (Test-Path (Join-Path $radice.FullName 'app\src\cli\main.ts')) -or -not (Test-Path (Join-Path $radice.FullName 'node\node.exe'))) {
      Write-Host 'Il pacchetto non è quello di Continuity per Windows: installazione interrotta.'
      return
    }
    $nuova = (Get-Content -Raw (Join-Path $radice.FullName 'app\.continuity-version')).Trim()
    Write-Host "Continuity $nuova → $dati"

    # 3. Il servizio in esecuzione usa i file di prima: si ferma, se non sta
    # lavorando. Un turno in corso non si interrompe mai.
    if (-not (Ferma-Servizio $dati)) { return }

    # 4. Al loro posto: la versione di prima resta da parte
    # («continuity update --indietro»), una sola.
    $app = Join-Path $dati 'app'
    $precedente = Join-Path $dati 'app.precedente'
    $node = Join-Path $dati 'node'
    # Windows libera i file di un processo appena fermato con qualche istante
    # di ritardo: si riprova per una decina di secondi.
    $spostata = $false
    for ($i = 0; $i -lt 10 -and -not $spostata; $i++) {
      try {
        if (Test-Path $precedente) { Togli-Cartella $precedente }
        if (Test-Path $app) { Rename-Item -LiteralPath $app -NewName 'app.precedente' }
        $spostata = $true
      } catch { Start-Sleep -Seconds 1 }
    }
    if (-not $spostata) {
      Write-Host 'Continuity è aperto in un''altra finestra e i suoi file sono in uso: chiudilo (/esci) e ripeti.'
      return
    }
    try {
      Move-Item -LiteralPath (Join-Path $radice.FullName 'app') -Destination $app
      if (Test-Path $node) { Togli-Cartella $node }
      Move-Item -LiteralPath (Join-Path $radice.FullName 'node') -Destination $node
    } catch {
      # Si rimette com'era.
      if (-not (Test-Path (Join-Path $app 'src')) -and (Test-Path $precedente)) {
        if (Test-Path $app) { try { Togli-Cartella $app } catch {} }
        Rename-Item -LiteralPath $precedente -NewName 'app' -ErrorAction SilentlyContinue
      }
      Write-Host "Non riesco a mettere al loro posto i file nuovi ($($_.Exception.Message)). Chiudi Continuity (/esci) e ripeti."
      return
    }

    # 5. Il comando «continuity», nella cartella bin dei dati, nel PATH
    # dell'utente.
    $bin = Join-Path $dati 'bin'
    New-Item -ItemType Directory -Force -Path $bin | Out-Null
    Scrivi-Comando $bin
    $nelPath = $true
    if (-not $env:CONTINUITY_SENZA_PATH) { $nelPath = Aggiungi-AlPath $bin }
    Set-Content -LiteralPath (Join-Path $dati 'launcher-dir') -Value $bin -Encoding ASCII
    Write-Host "Installato: $bin\continuity.cmd"
  } finally {
    try { Togli-Cartella $lavoro } catch {}
  }

  # 6. Git per Windows: serve per la copia di lavoro e per la consegna.
  if (-not (Get-Command git.exe -ErrorAction SilentlyContinue)) {
    Write-Host ''
    Write-Host 'Manca Git per Windows, che serve a Continuity. Installalo e riapri il terminale:'
    Write-Host '  winget install Git.Git'
  }

  # 7. Codex e Claude Code (decisioni di Lorenzo del 30 ottobre): se ce n'è già
  # uno che funziona non si tocca; se manca, l'installatore ufficiale.
  $nodeExe = Join-Path $dati 'node\node.exe'
  $appDir = Join-Path $dati 'app'
  if (-not $env:CONTINUITY_SENZA_CODEX) {
    Installa-Cli 'codex' 'Codex' 'https://chatgpt.com/codex/install.ps1' 'programma gratuito di OpenAI, serve ai servizi gratuiti per lavorare sui file' $nodeExe $appDir $dati
  }
  if (-not $env:CONTINUITY_SENZA_CLAUDE) {
    Installa-Cli 'claude' 'Claude Code' 'https://claude.ai/install.ps1' 'programma ufficiale di Anthropic, per usarlo serve il tuo abbonamento Claude' $nodeExe $appDir $dati
    # L'installatore di Claude Code lo mette in ~\.local\bin ma non aggiunge
    # la cartella al PATH (31 ottobre, provato su questo PC).
    $locale = Join-Path $env:USERPROFILE '.local\bin'
    if (-not $env:CONTINUITY_SENZA_PATH -and (Test-Path (Join-Path $locale 'claude.exe'))) { Aggiungi-AlPath $locale | Out-Null }
  }

  Write-Host ''
  Write-Host 'Per cominciare:'
  Write-Host '  1. apri una nuova finestra di PowerShell o di Windows Terminal (questa non vede ancora il comando)'
  Write-Host '  2. continuity setup   configurazione iniziale (in italiano: continuity configura)'
  Write-Host '  3. continuity         nella cartella di un progetto'
}

# La versione più alta pubblicata (anche le anteprime, «-beta»), confrontando i
# numeri come numeri: lo stesso confronto di piuNuova in
# src/core/aggiornamenti.ts e di install.sh.
function Ultima-Versione([string]$api) {
  try {
    $elenco = Invoke-RestMethod -UseBasicParsing -Uri "$api/releases?per_page=100" -Headers @{ 'User-Agent' = 'continuity-installatore' }
  } catch { return $null }
  $migliore = $null
  foreach ($r in $elenco) {
    $v = ([string]$r.tag_name) -replace '^v', ''
    if ($v -notmatch '^\d+\.\d+\.\d+') { continue }
    if (-not $migliore -or (Piu-Nuova $v $migliore)) { $migliore = $v }
  }
  return $migliore
}

function Piu-Nuova([string]$a, [string]$b) {
  $pa = $a.Split('-', 2); $pb = $b.Split('-', 2)
  $na = $pa[0].Split('.'); $nb = $pb[0].Split('.')
  for ($i = 0; $i -lt 3; $i++) {
    if ([int]$na[$i] -ne [int]$nb[$i]) { return [int]$na[$i] -gt [int]$nb[$i] }
  }
  $xa = if ($pa.Count -gt 1) { $pa[1] } else { '' }
  $xb = if ($pb.Count -gt 1) { $pb[1] } else { '' }
  if ($xa -eq '' -or $xb -eq '') { return ($xa -eq '' -and $xb -ne '') }
  $sa = $xa.Split('.'); $sb = $xb.Split('.')
  $n = [Math]::Max($sa.Count, $sb.Count)
  for ($i = 0; $i -lt $n; $i++) {
    if ($i -ge $sa.Count) { return $false }
    if ($i -ge $sb.Count) { return $true }
    if ($sa[$i] -match '^\d+$' -and $sb[$i] -match '^\d+$') {
      if ([int]$sa[$i] -ne [int]$sb[$i]) { return [int]$sa[$i] -gt [int]$sb[$i] }
    } elseif ($sa[$i] -ne $sb[$i]) { return [string]::CompareOrdinal($sa[$i], $sb[$i]) -gt 0 }
  }
  return $false
}

# Ferma il servizio di Continuity se è acceso e non sta lavorando. $false se
# un turno è in corso (allora non si installa nulla: i file sono in uso).
function Ferma-Servizio([string]$dati) {
  # Una finestra di Continuity aperta rifà partire il servizio appena lo si
  # ferma, e tiene in uso i file (1 novembre, prova da capo della 2.0.0):
  # prima di toccare qualcosa si chiede di chiuderla.
  $processi = Processi-Continuity $dati
  if (@($processi | Where-Object { $_.CommandLine -notmatch 'src[\\/]server[\\/]main\.ts' }).Count -gt 0) {
    Write-Host 'Continuity è aperto in un''altra finestra: chiudilo (/esci) e ripeti. Nulla è stato cambiato.'
    return $false
  }
  $file = Join-Path $dati 'service.json'
  if (Test-Path $file) {
    try {
      $s = Get-Content -Raw $file | ConvertFrom-Json
      $stato = Invoke-RestMethod -UseBasicParsing -TimeoutSec 2 -Uri "$($s.origin)/api/v1/health"
      if ($stato.occupato -eq $true) {
        Write-Host 'Un turno di Continuity è in corso: aspetta che finisca, poi ripeti. Nulla è stato cambiato.'
        return $false
      }
    } catch {}
  }
  # Il servizio di questa installazione (con o senza service.json): si
  # riconosce dal suo node.exe, quindi non si ferma mai un altro programma.
  $servizi = @($processi | Where-Object { $_.CommandLine -match 'src[\\/]server[\\/]main\.ts' })
  if ($servizi.Count -gt 0) {
    Write-Host 'Arresto del servizio in esecuzione per applicare l''aggiornamento'
    foreach ($p in $servizi) { & taskkill.exe /T /F /PID ([int]$p.ProcessId) 2>$null | Out-Null }
  }
  # Si aspetta che i processi di questa installazione siano davvero finiti
  # (una finestra appena chiusa può metterci qualche secondo).
  for ($i = 0; $i -lt 20 -and (Processi-Continuity $dati).Count -gt 0; $i++) { Start-Sleep -Milliseconds 500 }
  return $true
}

# Una cartella del programma, anche con percorsi oltre i 260 caratteri
# (node_modules sotto una cartella dati lunga), che Remove-Item non toglie.
function Togli-Cartella([string]$percorso) {
  # .NET con «\\?\» (cmd /c rd riceveva le virgolette rotte da PowerShell 5.1).
  [IO.Directory]::Delete("\\?\$([IO.Path]::GetFullPath($percorso))", $true)
}

# I programmi avviati con il Node di questa installazione: l'interfaccia, i
# comandi e il servizio.
function Processi-Continuity([string]$dati) {
  $node = [IO.Path]::GetFullPath((Join-Path $dati 'node\node.exe'))
  @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
      Where-Object { $_.ExecutablePath -and ([IO.Path]::GetFullPath($_.ExecutablePath) -ieq $node) })
}

# Il comando «continuity» per PowerShell e il Prompt dei comandi. Un solo
# file, che conosce la sua cartella: niente percorsi scritti dentro.
function Scrivi-Comando([string]$bin) {
  $testo = @'
@echo off
rem Il comando continuity, creato dall'installatore di Continuity per Windows
rem (scripts/install.ps1). La cartella dati è quella sopra a questo file.
setlocal
for %%I in ("%~dp0..") do set "CONTINUITY_DATA_DIR=%%~fI"
set "CONTINUITY_APP=%CONTINUITY_DATA_DIR%\app"
if not exist "%CONTINUITY_APP%\src\cli\main.ts" (
  echo Continuity non e' installato: ripeti l'installazione.
  exit /b 2
)
if /i "%~1"=="update" goto aggiorna
if /i "%~1"=="aggiorna" goto aggiorna
if /i "%~1"=="uninstall" goto disinstalla
if /i "%~1"=="disinstalla" goto disinstalla
if /i "%~1"=="version" goto versione
if /i "%~1"=="--version" goto versione
rem La cartella da cui si lancia il comando e' il progetto; il cambio di
rem cartella serve solo a trovare i moduli del programma.
set "CONTINUITY_CWD=%CD%"
cd /d "%CONTINUITY_APP%"
"%CONTINUITY_DATA_DIR%\node\node.exe" --disable-warning=ExperimentalWarning --import tsx src\cli\main.ts %*
exit /b %ERRORLEVEL%
:versione
type "%CONTINUITY_APP%\.continuity-version"
exit /b 0
rem Aggiornare e disinstallare possono riscrivere questo file: tutto sulla
rem stessa riga, che cmd ha gia' letto per intero. La scelta va con il suo
rem nome e una «x» davanti: «--indietro» da solo PowerShell lo prende per
rem un parametro, e una scelta vuota non arriverebbe.
:aggiorna
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%CONTINUITY_APP%\piattaforme\windows\aggiorna.ps1" -Dati "%CONTINUITY_DATA_DIR%" -Scelta "x%~2" & exit /b
:disinstalla
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%CONTINUITY_APP%\piattaforme\windows\disinstalla.ps1" -Dati "%CONTINUITY_DATA_DIR%" -Scelta "x%~2" & exit /b
'@
  $file = Join-Path $bin 'continuity.cmd'
  # Uno stesso contenuto non si riscrive: cmd legge il file mentre lo esegue.
  $vecchio = if (Test-Path $file) { Get-Content -Raw $file } else { '' }
  if ($vecchio -ne $testo) { [IO.File]::WriteAllText($file, ($testo -replace "`r?`n", "`r`n"), [Text.Encoding]::ASCII) }
}

# Aggiunge una cartella al PATH dell'utente, senza perdere le voci con
# %VARIABILI% (si legge e si scrive il valore non espanso del registro) e
# avvisando le finestre aperte dopo. Anche alla sessione corrente.
function Aggiungi-AlPath([string]$cartella) {
  $chiave = Get-Item -LiteralPath 'HKCU:\Environment'
  $attuale = [string]$chiave.GetValue('Path', '', 'DoNotExpandEnvironmentNames')
  $voci = @($attuale -split ';' | Where-Object { $_ })
  if (-not ($voci | Where-Object { $_.TrimEnd('\') -ieq $cartella.TrimEnd('\') })) {
    $nuovo = (@($voci) + $cartella) -join ';'
    Set-ItemProperty -LiteralPath 'HKCU:\Environment' -Name 'Path' -Value $nuovo -Type ExpandString
    try {
      Add-Type -Namespace ContinuityInstalla -Name Ambiente -MemberDefinition @'
[DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out UIntPtr lpdwResult);
'@ -ErrorAction SilentlyContinue
      $r = [UIntPtr]::Zero
      [ContinuityInstalla.Ambiente]::SendMessageTimeout([IntPtr]0xffff, 0x1A, [UIntPtr]::Zero, 'Environment', 2, 5000, [ref]$r) | Out-Null
    } catch {}
  }
  if (-not (($env:Path -split ';') | Where-Object { $_.TrimEnd('\') -ieq $cartella.TrimEnd('\') })) { $env:Path = "$env:Path;$cartella" }
  return $true
}

# Codex o Claude Code: si cerca con la ricerca di Continuity
# (scripts/trova-cli.ts: PATH, cartelle degli installatori ufficiali,
# estensioni di VS Code) e la prova «--version». Solo se manca si installa,
# e poi si ricontrolla davvero. Un errore non ferma l'installazione.
function Installa-Cli([string]$id, [string]$nome, [string]$url, [string]$nota, [string]$nodeExe, [string]$appDir, [string]$dati) {
  $trovato = Trova-Cli $id $nodeExe $appDir $dati
  if ($trovato) {
    Write-Host ''
    Write-Host "$nome è già installato ($($trovato -replace "`t", ', ')): lo uso così com'è."
    return
  }
  Write-Host ''
  Write-Host "Installo ${nome}: $nota"
  $registro = Join-Path $dati "$id-installazione.log"
  $env:CODEX_NON_INTERACTIVE = '1'
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "irm '$url' | iex" *> $registro
  # La cartella di Codex entra nel PATH dalla sessione dopo: qui si guarda
  # comunque nelle cartelle note.
  $trovato = Trova-Cli $id $nodeExe $appDir $dati
  if ($trovato) {
    Write-Host "  $nome installato."
  } else {
    $motivo = (Select-String -LiteralPath $registro -Pattern 'error|errore|fail' -ErrorAction SilentlyContinue | Select-Object -Last 1).Line
    if (Select-String -LiteralPath $registro -Pattern 'ENOSPC|no space left|spazio' -Quiet -ErrorAction SilentlyContinue) { $motivo = 'spazio su disco esaurito: libera spazio' }
    Write-Host "  $nome non installato$(if ($motivo) { " ($($motivo.Trim().Substring(0, [Math]::Min(200, $motivo.Trim().Length))))" }). /collega $id lo riproporrà. Dettagli in $registro."
  }
}

function Trova-Cli([string]$id, [string]$nodeExe, [string]$appDir, [string]$dati) {
  Push-Location $appDir
  try {
    $uscita = & $nodeExe --disable-warning=ExperimentalWarning --import tsx scripts\trova-cli.ts $id $dati 2>$null
    if ($LASTEXITCODE -eq 0 -and $uscita) { return ([string]($uscita | Select-Object -First 1)).Trim() }
  } catch {} finally { Pop-Location }
  return $null
}

# piattaforme/windows/aggiorna.ps1 carica solo le funzioni.
if (-not $env:CONTINUITY_SOLO_FUNZIONI) { Installa-Continuity }
