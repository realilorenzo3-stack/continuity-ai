#!/bin/sh
# continuity update (o aggiorna): porta Continuity all'ultima versione
# pubblicata su GitHub, o con --indietro rimette quella di prima (piano di
# pubblicazione, punto 4). Lo esegue il comando installato, dalla cartella
# dell'applicazione: CONTINUITY_DATA_DIR e la cartella del comando sono già
# note. Un turno in corso non si interrompe mai.
set -eu

continuity_data="${CONTINUITY_DATA_DIR:?}"
continuity_app="$continuity_data/app"
continuity_repo="${CONTINUITY_REPO:-realilorenzo3-stack/continuity-ai}"
continuity_api="${CONTINUITY_API:-https://api.github.com/repos/$continuity_repo}"
continuity_attuale=$(cat "$continuity_app/.continuity-version" 2>/dev/null || echo sconosciuta)

# Il servizio in esecuzione gira con il codice di prima: si ferma, se non sta
# lavorando, e riparte da solo alla prossima apertura (come in install.sh).
continuity_ferma_servizio() {
  [ -f "$continuity_data/service.json" ] || return 0
  continuity_pid=$(sed -n 's/.*"pid":\([0-9]*\).*/\1/p' "$continuity_data/service.json")
  continuity_origin=$(sed -n 's/.*"origin":"\([^"]*\)".*/\1/p' "$continuity_data/service.json")
  if [ -n "$continuity_origin" ] && curl -s --max-time 2 "$continuity_origin/api/v1/health" 2>/dev/null | grep -q '"occupato":true'; then
    echo 'Un turno è in corso: la versione nuova parte appena finisce, senza interromperlo.'
  elif [ -n "$continuity_pid" ] && kill -0 "$continuity_pid" 2>/dev/null &&
    ps -o command= -p "$continuity_pid" 2>/dev/null | grep -q 'src/server/main.ts'; then
    kill -TERM "$continuity_pid" 2>/dev/null || true
  fi
}

case "${1:-}" in
--indietro | --back)
  if [ ! -d "$continuity_data/app.precedente" ]; then
    echo "Non c'è una versione precedente da rimettere." >&2
    exit 1
  fi
  continuity_prima=$(cat "$continuity_data/app.precedente/.continuity-version" 2>/dev/null || echo sconosciuta)
  mv "$continuity_app" "$continuity_data/app.scambio"
  mv "$continuity_data/app.precedente" "$continuity_app"
  mv "$continuity_data/app.scambio" "$continuity_data/app.precedente"
  continuity_ferma_servizio
  echo "Tornato a Continuity $continuity_prima (la $continuity_attuale resta da parte: continuity update la riporta)."
  exit 0
  ;;
"" | --controlla | --check) ;;
*)
  echo 'Uso: continuity update [--controlla | --indietro]' >&2
  exit 2
  ;;
esac

command -v curl >/dev/null 2>&1 || {
  echo 'Serve curl per scaricare la versione nuova.' >&2
  exit 2
}
continuity_ultima=$(curl -fsSL "$continuity_api/releases?per_page=1" |
  sed -n 's/.*"tag_name": *"v\{0,1\}\([^"]*\)".*/\1/p' | head -n 1) || continuity_ultima=
if [ -z "$continuity_ultima" ]; then
  echo "Non riesco a sapere qual è l'ultima versione: controlla la connessione e riprova." >&2
  exit 1
fi
if [ "$continuity_ultima" = "$continuity_attuale" ]; then
  echo "Continuity è aggiornato ($continuity_attuale)."
  exit 0
fi
if [ "${1:-}" = --controlla ] || [ "${1:-}" = --check ]; then
  echo "È disponibile Continuity $continuity_ultima (ora: $continuity_attuale). Per aggiornare: continuity update"
  exit 0
fi
echo "Aggiorno Continuity da $continuity_attuale a $continuity_ultima"
CONTINUITY_DA_GITHUB=1 CONTINUITY_VERSIONE="$continuity_ultima" CONTINUITY_DATA_DIR="$continuity_data" \
  CONTINUITY_BIN_DIR="${CONTINUITY_BIN_DIR:-$(cat "$continuity_data/launcher-dir" 2>/dev/null || true)}" \
  sh "$continuity_app/scripts/install.sh"
echo "Fatto. Se qualcosa non va: continuity update --indietro"
