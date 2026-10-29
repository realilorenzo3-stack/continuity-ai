#!/bin/sh
# Il nome delle chiavi di una cartella dati nel Portachiavi: lo stesso calcolo
# di servizioPortachiavi (src/core/portachiavi.ts), che un test confronta.
# Il percorso si normalizza (assoluto, senza «.» e «..») e la parte che esiste
# si risolve come la vede il disco (/tmp e /private/tmp, collegamenti
# simbolici), anche se la cartella non c'è più (ottavo collaudo, CT-2.0-605/608).
continuity_percorso_vero() {
  continuity_p=$1
  case $continuity_p in /*) ;; *) continuity_p="$PWD/$continuity_p" ;; esac
  continuity_p=$(printf '%s\n' "$continuity_p" | awk -F/ '{
    n = 0
    for (i = 1; i <= NF; i++) {
      if ($i == "" || $i == ".") continue
      if ($i == "..") { if (n > 0) n--; continue }
      a[++n] = $i
    }
    s = ""
    for (i = 1; i <= n; i++) s = s "/" a[i]
    print (s == "" ? "/" : s)
  }')
  continuity_base=$continuity_p
  continuity_resto=
  while [ ! -e "$continuity_base" ] && [ "$continuity_base" != / ]; do
    continuity_resto="/$(basename "$continuity_base")$continuity_resto"
    continuity_base=$(dirname "$continuity_base")
  done
  continuity_base=$(cd "$continuity_base" 2>/dev/null && pwd -P) || return 1
  [ "$continuity_base" = / ] && continuity_base=
  printf '%s%s\n' "$continuity_base" "$continuity_resto"
}

# La cartella normale dei dati dei programmi (cartellaBaseDati in
# src/piattaforma.ts): «Application Support» sul Mac, ~/.local/share su Linux.
continuity_base_dati() {
  if [ "$(uname -s)" = Darwin ]; then
    printf '%s\n' "$HOME/Library/Application Support"
  else
    case "${XDG_DATA_HOME:-}" in
    /*) printf '%s\n' "$XDG_DATA_HOME" ;;
    *) printf '%s\n' "$HOME/.local/share" ;;
    esac
  fi
}

# Quale archivio delle chiavi: mac, wsl (archivio di Windows) o linux.
continuity_sistema() {
  # WSL_DISTRO_NAME c'è solo dentro WSL.
  if [ -n "${WSL_DISTRO_NAME:-}" ] || grep -qi microsoft /proc/version 2>/dev/null; then
    echo wsl
  elif [ "$(uname -s)" = Darwin ]; then
    echo mac
  else
    echo linux
  fi
}

continuity_nome_chiavi() {
  continuity_vero=$(continuity_percorso_vero "$1") || return 1
  continuity_base=$(continuity_percorso_vero "$(continuity_base_dati)") || continuity_base=$(continuity_base_dati)
  continuity_nome="Continuity · $(basename "$continuity_vero")"
  if [ "$(dirname "$continuity_vero")" = "$continuity_base" ]; then
    printf '%s\n' "$continuity_nome"
  else
    printf '%s · %s\n' "$continuity_nome" "$(printf '%s' "$continuity_vero" | shasum -a 256 | cut -c1-8)"
  fi
}

# Toglie tutte le chiavi salvate con quel nome e scrive quante. Il valore
# delle chiavi non si legge mai.
continuity_togli_chiavi() {
  continuity_s=$1
  continuity_n=0
  case "$(continuity_sistema)" in
  mac)
    command -v security >/dev/null 2>&1 || { echo 0; return; }
    while [ "$continuity_n" -lt 50 ] &&
      security delete-generic-password -s "$continuity_s" >/dev/null 2>&1; do
      continuity_n=$((continuity_n + 1))
    done
    ;;
  linux)
    command -v secret-tool >/dev/null 2>&1 || { echo 0; return; }
    continuity_n=$(secret-tool search --all service "$continuity_s" 2>/dev/null | grep -c '^\[' || true)
    secret-tool clear service "$continuity_s" >/dev/null 2>&1 || true
    ;;
  wsl)
    command -v powershell.exe >/dev/null 2>&1 || { echo 0; return; }
    # Lo stesso script di scriptVault("togliTutte") in src/core/portachiavi.ts.
    continuity_q=$(printf '%s' "$continuity_s" | sed "s/'/''/g")
    continuity_ps="[void][Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime];\$v=New-Object Windows.Security.Credentials.PasswordVault;\$n=0;try{foreach(\$c in \$v.FindAllByResource('$continuity_q')){\$v.Remove(\$c);\$n++}}catch{};[Console]::Out.Write(\$n)"
    continuity_codificato=$(printf '%s' "$continuity_ps" | iconv -f UTF-8 -t UTF-16LE | base64 | tr -d '\n')
    continuity_n=$(powershell.exe -NoProfile -NonInteractive -EncodedCommand "$continuity_codificato" 2>/dev/null | tr -dc '0-9')
    ;;
  esac
  printf '%s\n' "${continuity_n:-0}"
}

