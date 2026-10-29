#!/bin/sh
set -eu
continuity_data="${CONTINUITY_DATA_DIR:-$HOME/Library/Application Support/Continuity}"
continuity_agy="$HOME/Library/Application Support/Continuity/toolchain/antigravity/1.2.8/agy"
continuity_profile="$continuity_data/antigravity-profile"
mkdir -p "$continuity_profile"
cd "$continuity_profile"
echo 'Completa Google Auth nel browser e torna qui SENZA premere Ctrl+C.'
echo 'Se il browser mostra un codice, inseriscilo SOLO quando Antigravity chiede il codice di autorizzazione.'
echo 'Lascia Antigravity aperto dopo il login e avvisa Continuity. Non inviare task.'
set +e
env -i HOME="$continuity_profile" PATH=/usr/bin:/bin:/usr/sbin:/sbin TERM=xterm-256color TERM_PROGRAM=Apple_Terminal LANG=en_US.UTF-8 "$continuity_agy" --sandbox --disable-slash-commands

continuity_exit=$?
printf '\nAntigravity terminato (codice %s). La chiusura non conferma il login.\n' "$continuity_exit"
echo 'Antigravity è CHIUSO: qui NON inserire codici di accesso.'
echo 'Premi soltanto Invio per chiudere questa finestra.'
read -r continuity_close
exit "$continuity_exit"
