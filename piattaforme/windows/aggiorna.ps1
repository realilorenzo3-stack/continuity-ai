# continuity update (o aggiorna) su Windows: porta Continuity all'ultima
# versione pubblicata, o con --indietro rimette quella di prima. Lo esegue il
# comando continuity.cmd (scripts/install.ps1, Scrivi-Comando), che passa la
# cartella dati. Un turno in corso non si interrompe mai. La versione per Mac
# e Linux è scripts/aggiorna.sh. Parte della distribuzione Windows
# (piattaforme/windows/LEGGIMI.md).
param([Parameter(Mandatory = $true)][string]$Dati, [string]$Scelta = '')
# Il comando passa la scelta con una «x» davanti (continuity.cmd).
if ($Scelta.StartsWith('x')) { $Scelta = $Scelta.Substring(1) }

$ErrorActionPreference = 'Stop'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch {}
$app = Join-Path $Dati 'app'
$precedente = Join-Path $Dati 'app.precedente'
$installatore = Join-Path $app 'scripts\install.ps1'
$attuale = (Get-Content -Raw (Join-Path $app '.continuity-version') -ErrorAction SilentlyContinue)
$attuale = if ($attuale) { $attuale.Trim() } else { 'sconosciuta' }

# Le funzioni dell'installatore (versione più recente, servizio), senza
# installare: lo si carica con CONTINUITY_SOLO_FUNZIONI. Letto come UTF-8:
# Windows PowerShell 5.1 leggerebbe male le lettere accentate.
$env:CONTINUITY_SOLO_FUNZIONI = '1'
. ([ScriptBlock]::Create([IO.File]::ReadAllText($installatore, [Text.Encoding]::UTF8)))
$env:CONTINUITY_SOLO_FUNZIONI = ''

switch ($Scelta) {
  { $_ -in '--indietro', '--back' } {
    if (-not (Test-Path $precedente)) { Write-Host "Non c'è una versione precedente da rimettere."; exit 1 }
    $prima = (Get-Content -Raw (Join-Path $precedente '.continuity-version') -ErrorAction SilentlyContinue)
    if (-not (Ferma-Servizio $Dati)) { exit 1 }
    try {
      Rename-Item -LiteralPath $app -NewName 'app.scambio'
      Rename-Item -LiteralPath $precedente -NewName 'app'
      Rename-Item -LiteralPath (Join-Path $Dati 'app.scambio') -NewName 'app.precedente'
    } catch {
      Write-Host 'Continuity è aperto in un''altra finestra e i suoi file sono in uso: chiudilo (/esci) e ripeti.'
      exit 1
    }
    Write-Host "Tornato a Continuity $(if ($prima) { $prima.Trim() }) (la $attuale resta da parte: continuity update la riporta)."
    exit 0
  }
  { $_ -in '', '--controlla', '--check' } { }
  default { Write-Host 'Uso: continuity update [--controlla | --indietro]'; exit 2 }
}

$api = if ($env:CONTINUITY_API) { $env:CONTINUITY_API } else { 'https://api.github.com/repos/realilorenzo3-stack/continuity-ai' }
$ultima = Ultima-Versione $api
if (-not $ultima) { Write-Host "Non riesco a sapere qual è l'ultima versione: controlla la connessione e riprova."; exit 1 }
if ($ultima -eq $attuale) { Write-Host "Continuity è aggiornato ($attuale)."; exit 0 }
if ($Scelta -in '--controlla', '--check') {
  Write-Host "È disponibile Continuity $ultima (ora: $attuale). Per aggiornare: continuity update"
  exit 0
}
Write-Host "Aggiorno Continuity da $attuale a $ultima"
$env:CONTINUITY_VERSIONE = $ultima
$env:CONTINUITY_DATA_DIR = $Dati
# Codex e Claude Code ci sono già dall'installazione: non si ricontrollano.
$env:CONTINUITY_SENZA_CODEX = '1'
$env:CONTINUITY_SENZA_CLAUDE = '1'
Invoke-Expression ([IO.File]::ReadAllText($installatore, [Text.Encoding]::UTF8))
Write-Host "Fatto. Se qualcosa non va: continuity update --indietro"
