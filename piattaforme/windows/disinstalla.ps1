# continuity uninstall (o disinstalla) su Windows: toglie il comando, il
# programma e Node, e la cartella del comando dal PATH. I dati (sessioni,
# profili) restano; con --all, dopo aver scritto ELIMINA, anche loro e le
# chiavi dei servizi nell'archivio credenziali di Windows (tolte per nome,
# senza leggerle). La versione per Mac e Linux è scripts/uninstall.sh. Parte
# della distribuzione Windows (piattaforme/windows/LEGGIMI.md).
param([Parameter(Mandatory = $true)][string]$Dati, [string]$Scelta = '')
# Il comando passa la scelta con una «x» davanti (continuity.cmd).
if ($Scelta.StartsWith('x')) { $Scelta = $Scelta.Substring(1) }

$ErrorActionPreference = 'Stop'
$Dati = [IO.Path]::GetFullPath($Dati)
$bin = Join-Path $Dati 'bin'
$tutto = $Scelta -in '--all', '--tutto'

# I programmi avviati con il Node di questa installazione. Una finestra di
# Continuity aperta rifà partire il servizio appena lo si ferma e tiene in uso
# i file: la disinstallazione si fermava a metà (1 novembre, prova da capo
# della 2.0.0). Prima di toccare qualcosa si chiede di chiuderla.
$nodeInstallato = Join-Path $Dati 'node\node.exe'
$processi = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.ExecutablePath -and ([IO.Path]::GetFullPath($_.ExecutablePath) -ieq $nodeInstallato) })
if (@($processi | Where-Object { $_.CommandLine -notmatch 'src[\\/]server[\\/]main\.ts' }).Count -gt 0) {
  Write-Host 'Continuity è aperto in un''altra finestra: chiudilo (/esci) e ripeti. Non è stato rimosso niente.'
  exit 1
}

if ($tutto) {
  # Mai la cartella personale, la radice o AppData stessa.
  $vietate = @($env:USERPROFILE, $env:LOCALAPPDATA, $env:APPDATA, [IO.Path]::GetPathRoot($Dati)) | ForEach-Object { if ($_) { $_.TrimEnd('\') } }
  if ($vietate -contains $Dati.TrimEnd('\')) { Write-Host "Cartella dati non valida per --all: $Dati"; exit 2 }
  Write-Host "Questa operazione elimina il comando, il programma, le sessioni, i profili e le chiavi dei servizi salvate per Continuity, in:"
  Write-Host "  $Dati"
  $conferma = Read-Host 'Scrivere ELIMINA per confermare'
  if ($conferma -cne 'ELIMINA') { Write-Host 'Annullato: non è stato rimosso niente.'; exit 0 }
}

# Il servizio usa i file del programma: si ferma (anche durante un turno: la
# persona ha chiesto di disinstallare), con o senza service.json.
$servizi = @($processi | Where-Object { $_.CommandLine -match 'src[\\/]server[\\/]main\.ts' })
foreach ($p in $servizi) { & taskkill.exe /T /F /PID ([int]$p.ProcessId) 2>$null | Out-Null }
if ($servizi.Count -gt 0) { Start-Sleep -Seconds 2 }

# Le chiavi prima di togliere Node, che serve a calcolarne il nome.
$chiavi = 0
if ($tutto) {
  $node = Join-Path $Dati 'node\node.exe'
  $app = Join-Path $Dati 'app'
  if ((Test-Path $node) -and (Test-Path $app)) {
    Push-Location $app
    try { $chiavi = [int](& $node --disable-warning=ExperimentalWarning --import tsx piattaforme\windows\togli-chiavi.ts $Dati 2>$null | Select-Object -Last 1) } catch {} finally { Pop-Location }
  }
}

# La cartella del comando fuori dal PATH dell'utente (valore non espanso del
# registro, come l'ha scritto l'installatore).
try {
  $chiave = Get-Item -LiteralPath 'HKCU:\Environment'
  $attuale = [string]$chiave.GetValue('Path', '', 'DoNotExpandEnvironmentNames')
  $voci = @($attuale -split ';' | Where-Object { $_ -and $_.TrimEnd('\') -ine $bin.TrimEnd('\') })
  if ($voci.Count -ne @($attuale -split ';' | Where-Object { $_ }).Count) {
    Set-ItemProperty -LiteralPath 'HKCU:\Environment' -Name 'Path' -Value ($voci -join ';') -Type ExpandString
  }
} catch {}

# Il comando si toglie per ultimo: è il file che cmd sta eseguendo (la riga
# che ha avviato questo script è già stata letta per intero).
$rimossi = @()
foreach ($voce in 'app', 'app.precedente', 'node') {
  $percorso = Join-Path $Dati $voce
  if (Test-Path $percorso) {
    # Windows libera i file del servizio appena fermato con qualche istante
    # di ritardo: si riprova per qualche secondo.
    for ($i = 0; $i -lt 8 -and (Test-Path $percorso); $i++) {
      # .NET con «\\?\»: anche i percorsi oltre i 260 caratteri.
      try { [IO.Directory]::Delete("\\?\$percorso", $true) } catch { Start-Sleep -Seconds 1 }
    }
    if (Test-Path $percorso) { Write-Host "Non riesco a togliere $percorso (in uso?): chiudi Continuity e ripeti." } else { $rimossi += $voce }
  }
}
Remove-Item -Force -LiteralPath (Join-Path $Dati 'launcher-dir') -ErrorAction SilentlyContinue
if ($tutto) {
  # Tutto tranne la cartella del comando, che cmd sta ancora leggendo.
  Get-ChildItem -LiteralPath $Dati -Force | Where-Object { $_.Name -ne 'bin' } | ForEach-Object {
    try { if ($_.PSIsContainer) { [IO.Directory]::Delete("\\?\$($_.FullName)", $true) } else { Remove-Item -Force -LiteralPath $_.FullName } } catch {}
  }
}
# Il comando (e con --all la cartella dati) si toglie pochi secondi dopo,
# quando cmd ha finito: cancellato subito, cmd non ritrovava il file che
# stava eseguendo e scriveva «Impossibile trovare il percorso specificato».
$dopo = if ($tutto) { $Dati } else { $bin }
Start-Process -WindowStyle Hidden -FilePath cmd.exe -ArgumentList '/c', "ping -n 3 127.0.0.1 >nul & rmdir /s /q `"$dopo`""
Write-Host 'Rimossi il comando continuity e il programma.'

if ($tutto) {
  Write-Host "Dati rimossi. Chiavi tolte dall'archivio credenziali di Windows: $chiavi."
} else {
  Write-Host "Dati conservati in $Dati (continuity uninstall --all per toglierli)."
}
