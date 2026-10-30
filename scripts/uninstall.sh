#!/bin/sh
# Rimuove il comando e l'applicazione installata. I dati delle run, i profili e la
# toolchain restano: la loro rimozione è esplicita e va chiesta con --all.
set -eu
continuity_data="${CONTINUITY_DATA_DIR:-$HOME/Library/Application Support/Continuity}"
# Dove l'installatore ha messo il comando; ~/.local/bin solo come ripiego.
continuity_bin="${CONTINUITY_BIN_DIR:-}"
if [ -z "$continuity_bin" ] && [ -f "$continuity_data/launcher-dir" ]; then
  continuity_bin=$(cat "$continuity_data/launcher-dir")
fi
[ -n "$continuity_bin" ] || continuity_bin="$HOME/.local/bin"

. "$(cd "$(dirname "$0")" && pwd)/nome-chiavi.sh"

# Con --all si chiede prima di togliere qualsiasi cosa: con una risposta
# diversa da ELIMINA non si tocca niente, nemmeno l'applicazione (ottavo
# collaudo, CT-2.0-605). Il percorso mostrato e cancellato è quello vero.
continuity_tutto=no
continuity_servizio=
if [ "${1:-}" = --all ]; then
  continuity_tutto=si
  continuity_vero=$(continuity_percorso_vero "$continuity_data" || printf '%s' "$continuity_data")
  continuity_servizio=$(continuity_nome_chiavi "$continuity_data" || true)
  case "$continuity_vero" in
  "" | / | "$HOME" | "$(cd "$HOME" && pwd -P)" | "$HOME/Library" | "$HOME/Library/Application Support")
    echo "Cartella dati non valida per --all: $continuity_vero" >&2
    exit 2
    ;;
  esac
  echo "Questa operazione elimina il comando, l'applicazione, run, evidenze, profili e toolchain in:"
  echo "  $continuity_vero"
  [ -n "$continuity_servizio" ] &&
    echo "e le chiavi dei servizi salvate nell'archivio delle chiavi come «${continuity_servizio}»."
  printf 'Scrivere ELIMINA per confermare: '
  read -r continuity_confirm
  if [ "$continuity_confirm" != ELIMINA ]; then
    echo 'Annullato: non è stato rimosso niente.'
    exit 0
  fi
fi

# Si rimuove solo un comando riconosciuto come nostro: in /opt/homebrew/bin o
# /usr/local/bin un file chiamato «continuity» potrebbe essere di altri.
continuity_rimosso=no
if [ -f "$continuity_bin/continuity" ] &&
  grep -q 'continuity_app=' "$continuity_bin/continuity" 2>/dev/null &&
  grep -q 'src/cli/main.ts' "$continuity_bin/continuity" 2>/dev/null; then
  rm -f "$continuity_bin/continuity"
  continuity_rimosso=si
elif [ -e "$continuity_bin/continuity" ]; then
  echo "Lascio $continuity_bin/continuity: non è il comando installato da Continuity."
fi
# L'alias con la maiuscola, solo se punta al nostro comando.
if [ -L "$continuity_bin/Continuity" ] &&
  [ "$(readlink "$continuity_bin/Continuity")" = continuity ]; then
  rm -f "$continuity_bin/Continuity"
fi
# In WSL anche il comando di Windows (piattaforme/linux-windows/windows.sh).
if [ "$(uname -s)" = Linux ] && { [ -n "${WSL_DISTRO_NAME:-}" ] || grep -qi microsoft /proc/version 2>/dev/null; }; then
  . "$(cd "$(dirname "$0")/.." && pwd)/piattaforme/linux-windows/windows.sh"
  continuity_togli_windows || true
fi
rm -rf "$continuity_data/app" "$continuity_data/app.precedente"
rm -f "$continuity_data/launcher-dir"
if [ "$continuity_rimosso" = si ]; then
  echo "Rimossi il comando $continuity_bin/continuity e l'applicazione."
else
  echo "Rimossa l'applicazione. Nessun comando continuity trovato in $continuity_bin."
fi

if [ "$continuity_tutto" = si ]; then
  # Una voce per servizio collegato: si toglie finché ce ne sono (al massimo
  # 50 giri). Il valore delle chiavi non si legge (settimo collaudo, CT-2.0-605).
  # Anche se la cartella è già stata cancellata a mano: il nome non dipende
  # dalla sua esistenza.
  continuity_chiavi=0
  [ -n "$continuity_servizio" ] && continuity_chiavi=$(continuity_togli_chiavi "$continuity_servizio")
  # La cartella vera; se quella indicata era un collegamento, anche il collegamento.
  rm -rf "$continuity_vero"
  [ -L "$continuity_data" ] && rm -f "$continuity_data"
  echo "Dati rimossi. Chiavi tolte dall'archivio delle chiavi: $continuity_chiavi."
else
  echo "Dati conservati in $continuity_data (usare --all per rimuoverli)."
fi
