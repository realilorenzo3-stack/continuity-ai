#!/bin/sh
# Il comando «continuity» per PowerShell e il Prompt dei comandi di Windows,
# quando Continuity è installato in WSL 2 (decisione del 29 ottobre: Windows
# con WSL). È un piccolo file continuity.cmd che avvia Continuity in WSL nella
# cartella di Windows in cui si trova la persona: «wsl.exe --cd» traduce
# C:\Users\… in /mnt/c/Users/…. Così chi usa Windows apre il suo terminale
# nella sua cartella e scrive «continuity», come sul Mac.
#
# Il file sta in %LOCALAPPDATA%\Continuity\bin, aggiunta al PATH dell'utente di
# Windows (non a quello di sistema: niente permessi di amministratore).

# La cartella del comando, come percorso di WSL (/mnt/c/Users/…/Continuity/bin).
continuity_cartella_windows() {
  continuity_locale=$(cmd.exe /d /c "echo %LOCALAPPDATA%" 2>/dev/null | tr -d '\r' | tail -n 1)
  case "$continuity_locale" in
  [A-Za-z]:\\*) ;;
  *) return 1 ;;
  esac
  continuity_locale_wsl=$(wslpath -u "$continuity_locale") || return 1
  printf '%s\n' "$continuity_locale_wsl/Continuity/bin"
}

# Esegue uno script PowerShell senza problemi di caratteri (-EncodedCommand).
continuity_powershell() {
  continuity_codificato=$(printf '%s' "$1" | iconv -f UTF-8 -t UTF-16LE | base64 | tr -d '\n') || return 1
  powershell.exe -NoProfile -NonInteractive -EncodedCommand "$continuity_codificato"
}

# Crea continuity.cmd e aggiunge la sua cartella al PATH dell'utente.
# $1: il comando continuity installato in WSL; $2: la distribuzione WSL;
# $3 (facoltativo): una cartella dati diversa da quella predefinita.
continuity_installa_windows() {
  continuity_dove=$(continuity_cartella_windows) || return 1
  mkdir -p "$continuity_dove" || return 1
  continuity_dati_cmd=
  [ -n "${3:-}" ] && continuity_dati_cmd=" env \"CONTINUITY_DATA_DIR=$3\""
  # La distribuzione si nomina solo se se ne conosce il nome vero: senza, si
  # usa quella predefinita di WSL. Prima, senza nome, si scriveva «Ubuntu», e
  # dove la distribuzione si chiama «Ubuntu-24.04» il comando falliva con
  # WSL_E_DISTRO_NOT_FOUND (prova di Lorenzo su Windows, 30 ottobre).
  continuity_distro=
  [ -n "${2:-}" ] && continuity_distro="-d \"$2\" "
  # CRLF: è un file di Windows.
  printf '@echo off\r\nrem Continuity gira in WSL%s: questo comando lo avvia nella cartella corrente.\r\nwsl.exe %s--cd "%%CD%%" --%s "%s" %%*\r\n' \
    "${2:+ ($2)}" "$continuity_distro" "$continuity_dati_cmd" "$1" >"$continuity_dove/continuity.cmd" || return 1
  continuity_dove_win=$(wslpath -w "$continuity_dove") || return 1
  continuity_q=$(printf '%s' "$continuity_dove_win" | sed "s/'/''/g")
  continuity_powershell "\$d='$continuity_q';\$p=[Environment]::GetEnvironmentVariable('Path','User');if(-not \$p){\$p=''};if((\$p -split ';') -notcontains \$d){[Environment]::SetEnvironmentVariable('Path',((\$p.TrimEnd(';')+';'+\$d).TrimStart(';')),'User')}" >/dev/null 2>&1 || return 1
  printf '%s\n' "$continuity_dove_win"
}

# Toglie continuity.cmd e la cartella dal PATH dell'utente di Windows.
continuity_togli_windows() {
  continuity_dove=$(continuity_cartella_windows) || return 0
  [ -f "$continuity_dove/continuity.cmd" ] || return 0
  rm -f "$continuity_dove/continuity.cmd"
  rmdir "$continuity_dove" 2>/dev/null || true
  continuity_dove_win=$(wslpath -w "$continuity_dove" 2>/dev/null) || return 0
  continuity_q=$(printf '%s' "$continuity_dove_win" | sed "s/'/''/g")
  continuity_powershell "\$d='$continuity_q';\$p=[Environment]::GetEnvironmentVariable('Path','User');if(\$p){[Environment]::SetEnvironmentVariable('Path',((\$p -split ';' | Where-Object { \$_ -and \$_ -ne \$d }) -join ';'),'User')}" >/dev/null 2>&1 || true
  echo "Tolto il comando continuity di Windows."
}
