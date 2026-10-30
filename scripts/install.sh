#!/bin/sh
# Installa Continuity per l'utente corrente: toolchain Node fissata, applicazione nella
# directory dati e comando `continuity` in una cartella già nel PATH (di solito
# /opt/homebrew/bin o ~/.local/bin). Nessun sudo, nessuna modifica
# al Node di sistema. Disinstallazione: continuity uninstall (scripts/uninstall.sh).
#
# Due modi (piano di pubblicazione, punto 4):
# - dai sorgenti: sh scripts/install.sh, dalla cartella del programma;
# - con un comando solo, da GitHub:
#     curl -fsSL https://raw.githubusercontent.com/realilorenzo3-stack/continuity-ai/main/scripts/install.sh | sh
#   Qui accanto non ci sono i sorgenti: si scarica il pacchetto della versione
#   (l'ultima pubblicata, o CONTINUITY_VERSIONE), se ne controlla l'impronta e
#   si esegue il suo installatore.
set -eu

continuity_repo="${CONTINUITY_REPO:-realilorenzo3-stack/continuity-ai}"
# Gli indirizzi si possono cambiare per le prove (anche file://).
continuity_api="${CONTINUITY_API:-https://api.github.com/repos/$continuity_repo}"
continuity_rilasci="${CONTINUITY_RILASCI:-https://github.com/$continuity_repo/releases/download}"

continuity_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

# I sorgenti di Continuity sono qui accanto? Si controlla il nome del
# pacchetto: con «curl | sh» la cartella è quella della persona, che può
# essere un suo progetto con un package.json qualsiasi.
continuity_source="$(cd "$(dirname "$0")/.." 2>/dev/null && pwd)" || continuity_source=
# CONTINUITY_DA_GITHUB=1 (continuity update): sempre la versione pubblicata.
if [ -n "${CONTINUITY_DA_GITHUB:-}" ] || [ -z "$continuity_source" ] || [ ! -d "$continuity_source/src" ] ||
  ! grep -q '"name": "continuity-local"' "$continuity_source/package.json" 2>/dev/null; then
  command -v curl >/dev/null 2>&1 || {
    echo 'Prerequisito mancante: curl. Installalo e ripeti.' >&2
    exit 2
  }
  command -v tar >/dev/null 2>&1 || {
    echo 'Prerequisito mancante: tar. Installalo e ripeti.' >&2
    exit 2
  }
  continuity_v="${CONTINUITY_VERSIONE:-}"
  if [ -z "$continuity_v" ]; then
    # La versione più recente pubblicata (anche le anteprime, «-beta»).
    continuity_v=$(curl -fsSL "$continuity_api/releases?per_page=1" |
      sed -n 's/.*"tag_name": *"v\{0,1\}\([^"]*\)".*/\1/p' | head -n 1) || continuity_v=
  fi
  if [ -z "$continuity_v" ]; then
    echo "Non trovo l'ultima versione di Continuity su GitHub ($continuity_repo). Riprova più tardi." >&2
    exit 1
  fi
  continuity_tmp=$(mktemp -d)
  trap 'rm -rf "$continuity_tmp"' EXIT
  echo "Scarico Continuity $continuity_v"
  curl -fsSL "$continuity_rilasci/v$continuity_v/continuity-$continuity_v.tar.gz" -o "$continuity_tmp/pacchetto.tar.gz"
  curl -fsSL "$continuity_rilasci/v$continuity_v/SHA256SUMS" -o "$continuity_tmp/SHA256SUMS"
  continuity_atteso=$(sed -n "s/^\([0-9a-f]\{64\}\)  continuity-$continuity_v\.tar\.gz\$/\1/p" "$continuity_tmp/SHA256SUMS")
  if [ -z "$continuity_atteso" ] || [ "$continuity_atteso" != "$(continuity_sha256 "$continuity_tmp/pacchetto.tar.gz")" ]; then
    echo "Il pacchetto scaricato non corrisponde alla sua impronta (SHA-256): installazione interrotta." >&2
    exit 1
  fi
  tar -xzf "$continuity_tmp/pacchetto.tar.gz" -C "$continuity_tmp"
  continuity_esito=0
  CONTINUITY_DA_GITHUB= sh "$continuity_tmp/continuity-$continuity_v/scripts/install.sh" || continuity_esito=$?
  exit "$continuity_esito"
fi

# La versione è quella di package.json (prima era scritta qui, ferma a 0.1.0).
continuity_version=$(sed -n 's/^  "version": "\(.*\)",$/\1/p' "$continuity_source/package.json")
[ -n "$continuity_version" ] || continuity_version=sconosciuta
# Node 26.4+ per OpenTUI (Fase 2). Il resto dell'installatore si rifà nella Fase 3.
continuity_node='26.10.0'
continuity_pnpm='10.17.1'
# La cartella dati: «Application Support» sul Mac, ~/.local/share su Linux e
# WSL (cartellaBaseDati in src/piattaforma.ts).
if [ "$(uname -s)" = Darwin ]; then
  continuity_base="$HOME/Library/Application Support"
else
  case "${XDG_DATA_HOME:-}" in
  /*) continuity_base="$XDG_DATA_HOME" ;;
  *) continuity_base="$HOME/.local/share" ;;
  esac
fi
continuity_data="${CONTINUITY_DATA_DIR:-$continuity_base/Continuity}"
continuity_app="$continuity_data/app"
# Il comando deve funzionare subito: si preferisce una cartella già nel PATH e
# scrivibile, così non serve toccare la configurazione della shell.
continuity_bin="${CONTINUITY_BIN_DIR:-}"
if [ -z "$continuity_bin" ]; then
  for candidata in /opt/homebrew/bin /usr/local/bin "$HOME/.local/bin"; do
    case ":$PATH:" in
    *":$candidata:"*)
      if [ -w "$candidata" ] || [ ! -e "$candidata" ]; then
        continuity_bin="$candidata"
        break
      fi
      ;;
    esac
  done
fi
[ -n "$continuity_bin" ] || continuity_bin="$HOME/.local/bin"

# Un comando «continuity» che non è il nostro (un altro programma, o un
# collegamento di Homebrew verso il suo Cellar) non si tocca: scriverci sopra
# sostituiva il file di un altro pacchetto, attraverso il collegamento.
if [ -L "$continuity_bin/continuity" ] || {
  [ -e "$continuity_bin/continuity" ] &&
    ! { grep -q 'continuity_app=' "$continuity_bin/continuity" 2>/dev/null &&
      grep -q 'src/cli/main.ts' "$continuity_bin/continuity" 2>/dev/null; }
}; then
  echo "In $continuity_bin c'è già un comando continuity che non è di Continuity: non lo sostituisco." >&2
  echo "Scegli un'altra cartella con CONTINUITY_BIN_DIR, oppure rimuovilo tu se è un residuo." >&2
  exit 2
fi

# macOS, Linux e Windows con WSL 2 (decisione del 29 ottobre). Windows senza
# WSL non è supportato: lì questo script non arriva nemmeno.
case "$(uname -s)" in
Darwin | Linux) ;;
*)
  echo 'Continuity funziona su macOS, Linux e Windows con WSL 2. Questo sistema non è supportato.' >&2
  exit 2
  ;;
esac
command -v git >/dev/null 2>&1 || {
  if [ "$(uname -s)" = Darwin ]; then
    echo "Prerequisito mancante: git. Installalo (xcode-select --install) e ripeti." >&2
  else
    echo "Prerequisito mancante: git. Installalo (su Ubuntu e Debian: sudo apt install git) e ripeti." >&2
  fi
  exit 2
}

echo "Continuity $continuity_version → $continuity_app"
mkdir -p "$continuity_data" "$continuity_bin"
chmod 700 "$continuity_data"

continuity_toolchain="$continuity_data/toolchain"
# Node si scarica da nodejs.org e si controlla con l'impronta scritta qui (non
# solo con quella del sito): npm non serve più. pnpm si installa con l'npm di
# quel Node. Se il download non riesce e c'è npm, il metodo di prima.
continuity_impronta_node() {
  case "$1" in
  darwin-arm64) echo 751fdf7439f115d87ee2a8f3f18c065b6151852068e3e666ac60ac2996f75ac9 ;;
  darwin-x64) echo ebbe9ab9b58ad6bb54390d6e2c862c1afa7d4475fb7e8ae8146acde211bf70df ;;
  linux-arm64) echo 423a41bff8e2a2fa15e702fefe2919ef95823b2378744daccb8439302534b44f ;;
  linux-x64) echo cb5c9ce9c80d7b8821e3a258543c71b939138cf17c74d5cc44bbe85d6dbc5ad8 ;;
  esac
}
continuity_scarica_node() {
  case "$(uname -s)" in Darwin) continuity_os=darwin ;; *) continuity_os=linux ;; esac
  case "$(uname -m)" in arm64 | aarch64) continuity_arch=arm64 ;; x86_64 | amd64) continuity_arch=x64 ;; *) return 1 ;; esac
  continuity_pacchetto="node-v$continuity_node-$continuity_os-$continuity_arch"
  continuity_impronta=$(continuity_impronta_node "$continuity_os-$continuity_arch")
  [ -n "$continuity_impronta" ] && command -v curl >/dev/null 2>&1 || return 1
  continuity_scaricato=$(mktemp)
  curl -fsSL "${CONTINUITY_NODE_URL:-https://nodejs.org/dist}/v$continuity_node/$continuity_pacchetto.tar.gz" -o "$continuity_scaricato" || return 1
  if [ "$(continuity_sha256 "$continuity_scaricato")" != "$continuity_impronta" ]; then
    rm -f "$continuity_scaricato"
    echo "Node scaricato non corrisponde alla sua impronta: non lo uso." >&2
    return 1
  fi
  rm -rf "$continuity_toolchain/node"
  mkdir -p "$continuity_toolchain/node" "$continuity_toolchain/node_modules/.bin"
  tar -xzf "$continuity_scaricato" -C "$continuity_toolchain/node" --strip-components=1
  rm -f "$continuity_scaricato"
  PATH="$continuity_toolchain/node/bin:$PATH" "$continuity_toolchain/node/bin/npm" install \
    --prefix "$continuity_toolchain" --no-audit --no-fund --save-exact "pnpm@$continuity_pnpm" >/dev/null
  ln -sf ../../node/bin/node "$continuity_toolchain/node_modules/.bin/node"
}
if [ ! -x "$continuity_toolchain/node_modules/.bin/node" ] ||
  [ ! -x "$continuity_toolchain/node_modules/.bin/pnpm" ]; then
  echo "Installazione toolchain: Node $continuity_node, pnpm $continuity_pnpm"
  if ! continuity_scarica_node; then
    if command -v npm >/dev/null 2>&1; then
      npm install --prefix "$continuity_toolchain" --no-audit --no-fund --save-exact \
        "node@$continuity_node" "pnpm@$continuity_pnpm" >/dev/null
    else
      echo "Non riesco a scaricare Node $continuity_node da nodejs.org: controlla la connessione e riprova." >&2
      exit 1
    fi
  fi
fi
PATH="$continuity_toolchain/node_modules/.bin:$PATH"
export PATH

echo 'Copia dell applicazione'
rm -rf "$continuity_app.new"
mkdir -p "$continuity_app.new"
# Gli avvisi di terzi, la privacy e la sicurezza vanno con il programma
# installato (licenze MIT di opencode e delle dipendenze, ricerca legale del
# 28 ottobre 2026).
# tsconfig.tui.json mancava: la compilazione dell'installata falliva
# (settimo collaudo, CT-2.0-601). Ogni file dell'elenco è obbligatorio.
for item in package.json pnpm-lock.yaml tsconfig.json tsconfig.tui.json vite.config.ts \
  vitest.config.ts playwright.config.ts index.html .node-version \
  README.md LICENSE NOTICE THIRD_PARTY_NOTICES.md PRIVACY.md SECURITY.md \
  src tests schemas scripts; do
  if [ ! -e "$continuity_source/$item" ]; then
    echo "Manca $item nei sorgenti: installazione interrotta." >&2
    exit 2
  fi
  cp -R "$continuity_source/$item" "$continuity_app.new/"
done
# I documenti a cui rimandano README e PRIVACY.
mkdir -p "$continuity_app.new/docs"
for item in CONFORMITA.md COPYRIGHT.md; do
  [ -e "$continuity_source/docs/$item" ] && cp "$continuity_source/docs/$item" "$continuity_app.new/docs/"
done
printf '%s\n' "$continuity_version" >"$continuity_app.new/.continuity-version"
# Quando è stata fatta l'ultima modifica a ciò che si installa: la schermata
# iniziale lo mostra, così si capisce subito se la versione è quella aggiornata.
continuity_installata=$(date -u +%Y-%m-%dT%H:%M:%SZ)
if git -C "$continuity_source" rev-parse --git-dir >/dev/null 2>&1; then
  continuity_commit=$(git -C "$continuity_source" rev-parse --short HEAD 2>/dev/null || true)
  continuity_data_commit=$(git -C "$continuity_source" log -1 --format=%cI 2>/dev/null || true)
  continuity_sporca=false
  [ -n "$(git -C "$continuity_source" status --porcelain -- src scripts schemas package.json 2>/dev/null)" ] && continuity_sporca=true
  printf '{"commit":"%s","dataCommit":"%s","nonRegistrate":%s,"installataIl":"%s"}\n' \
    "$continuity_commit" "$continuity_data_commit" "$continuity_sporca" "$continuity_installata" \
    >"$continuity_app.new/.continuity-build.json"
else
  printf '{"installataIl":"%s"}\n' "$continuity_installata" >"$continuity_app.new/.continuity-build.json"
fi

echo 'Installazione dipendenze'
(cd "$continuity_app.new" && pnpm install --frozen-lockfile --silent)
echo 'Compilazione'
# L'uscita si tiene in un file: se la compilazione fallisce se ne mostra la
# fine, invece di uscire senza dire perché.
continuity_log="$continuity_data/installazione.log"
if ! (cd "$continuity_app.new" && pnpm build) >"$continuity_log" 2>&1; then
  echo "Compilazione non riuscita. Ultime righe (tutto in $continuity_log):" >&2
  tail -n 20 "$continuity_log" >&2
  exit 1
fi

# La versione di prima resta da parte: «continuity update --indietro» la
# rimette (piano di pubblicazione, punto 4). Una sola, la più recente.
rm -rf "$continuity_data/app.precedente"
[ -d "$continuity_app" ] && mv "$continuity_app" "$continuity_data/app.precedente"
mv "$continuity_app.new" "$continuity_app"

# Un servizio già in esecuzione continuerebbe a far girare la versione vecchia:
# viene fermato qui, i dati restano dove sono.
if [ -f "$continuity_data/service.json" ]; then
  continuity_pid=$(sed -n 's/.*"pid":\([0-9]*\).*/\1/p' "$continuity_data/service.json")
  continuity_origin=$(sed -n 's/.*"origin":"\([^"]*\)".*/\1/p' "$continuity_data/service.json")
  # Un turno in corso non si interrompe: il servizio nuovo prenderà il posto
  # del vecchio alla prima apertura di Continuity in cui non sta lavorando.
  if [ -n "$continuity_origin" ] && curl -s --max-time 2 "$continuity_origin/api/v1/health" 2>/dev/null | grep -q '"occupato":true'; then
    echo 'Un turno è in corso: il servizio verrà aggiornato appena finisce, senza interromperlo'
  # Il pid di service.json può appartenere ormai a un altro programma (dopo
  # un riavvio): si ferma solo se è davvero il servizio di Continuity.
  elif [ -n "$continuity_pid" ] && kill -0 "$continuity_pid" 2>/dev/null &&
    ps -o command= -p "$continuity_pid" 2>/dev/null | grep -q 'src/server/main.ts'; then
    echo 'Arresto del servizio in esecuzione per applicare l aggiornamento'
    kill -TERM "$continuity_pid" 2>/dev/null || true
    sleep 2
  fi
fi

cat >"$continuity_bin/continuity" <<'LAUNCHER'
#!/bin/sh
set -eu
if [ "$(uname -s)" = Darwin ]; then
  continuity_base="$HOME/Library/Application Support"
else
  case "${XDG_DATA_HOME:-}" in
  /*) continuity_base="$XDG_DATA_HOME" ;;
  *) continuity_base="$HOME/.local/share" ;;
  esac
fi
continuity_data="${CONTINUITY_DATA_DIR:-$continuity_base/Continuity}"
continuity_app="$continuity_data/app"
continuity_node="$continuity_data/toolchain/node_modules/.bin"
[ -d "$continuity_app" ] || {
  echo 'Continuity non installato: eseguire di nuovo install.sh' >&2
  exit 2
}
PATH="$continuity_node:$PATH"
export PATH
# Aggiornare e disinstallare: script della versione installata.
case "${1:-}" in
update | aggiorna)
  shift
  CONTINUITY_DATA_DIR="$continuity_data" exec sh "$continuity_app/scripts/aggiorna.sh" "$@"
  ;;
uninstall | disinstalla)
  shift
  CONTINUITY_DATA_DIR="$continuity_data" exec sh "$continuity_app/scripts/uninstall.sh" "$@"
  ;;
esac
# La cartella da cui l'utente ha lanciato il comando è il progetto su cui vuole
# lavorare: il cd serve solo a risolvere i moduli dell'applicazione.
CONTINUITY_CWD="$PWD"
export CONTINUITY_CWD
cd "$continuity_app"
if [ "${1:-}" = version ] || [ "${1:-}" = --version ]; then
  cat .continuity-version
  exit 0
fi
exec node --import tsx src/cli/main.ts "$@"
LAUNCHER
chmod 755 "$continuity_bin/continuity"
# Su macOS il filesystem non distingue le maiuscole, ma un collegamento esplicito
# evita sorprese a chi scrive Continuity con la maiuscola.
[ -e "$continuity_bin/Continuity" ] || ln -s continuity "$continuity_bin/Continuity" 2>/dev/null || true

echo
# Il disinstallatore deve sapere dove è finito il comando: senza, cercava solo
# in ~/.local/bin e lasciava il comando in /opt/homebrew/bin (collaudo del 3
# ottobre, CT-015).
printf '%s\n' "$continuity_bin" >"$continuity_data/launcher-dir"
echo "Installato: $continuity_bin/continuity"
# In WSL: anche il comando «continuity» per PowerShell e il Prompt dei comandi
# di Windows (scripts/windows.sh).
if [ "$(uname -s)" = Linux ] && { [ -n "${WSL_DISTRO_NAME:-}" ] || grep -qi microsoft /proc/version 2>/dev/null; }; then
  . "$continuity_source/scripts/windows.sh"
  if continuity_comando_win=$(continuity_installa_windows "$continuity_bin/continuity" "${WSL_DISTRO_NAME:-}" "${CONTINUITY_DATA_DIR:-}"); then
    echo "Su Windows: apri un nuovo PowerShell nella cartella del progetto e scrivi continuity ($continuity_comando_win)"
  else
    echo "Su Windows il comando continuity non è stato creato: da PowerShell usa «wsl continuity»."
  fi
fi
# Il comando nel PATH: se la cartella non c'è, la riga va nel file della
# shell. Il terminale già aperto non la rilegge da solo: lo si dice in fondo,
# con il comando esatto (prova di Lorenzo su Ubuntu, 29 ottobre).
continuity_rileggi=
case ":$PATH:" in
*":$continuity_bin:"*) ;;
*)
  if [ -n "${SHELL##*zsh}" ]; then
    continuity_rc="$HOME/.bashrc"
  else
    continuity_rc="$HOME/.zshrc"
  fi
  if ! grep -q 'Continuity: comando' "$continuity_rc" 2>/dev/null; then
    printf '\n# Continuity: comando disponibile nel terminale\nexport PATH="%s:$PATH"\n' "$continuity_bin" >>"$continuity_rc"
  fi
  continuity_rileggi="source $continuity_rc"
  ;;
esac

# Che cosa manca al sistema, con i comandi esatti per sistemarlo.
if [ "$(uname -s)" = Linux ]; then
  continuity_pacchetti=
  if [ -n "${WSL_DISTRO_NAME:-}" ] || grep -qi microsoft /proc/version 2>/dev/null; then
    command -v powershell.exe >/dev/null 2>&1 || {
      echo
      echo "Attenzione: powershell.exe non si avvia da WSL. Serve per salvare le chiavi nell'archivio di Windows."
    }
  elif ! command -v secret-tool >/dev/null 2>&1; then
    # Le chiavi dei servizi gratuiti: libsecret e un portachiavi.
    continuity_pacchetti="libsecret-tools gnome-keyring"
  fi
  # La sandbox di Claude Code su Linux e WSL 2 (code.claude.com/docs/en/sandboxing):
  # senza, Continuity non fa partire Claude (failIfUnavailable).
  if ! command -v bwrap >/dev/null 2>&1 || ! command -v socat >/dev/null 2>&1; then
    continuity_pacchetti="${continuity_pacchetti:+$continuity_pacchetti }bubblewrap socat"
  fi
  if [ -n "$continuity_pacchetti" ]; then
    echo
    echo 'Mancano dei programmi del sistema (portachiavi per le chiavi, sandbox per Claude Code). Su Ubuntu e Debian:'
    echo "  sudo apt install $continuity_pacchetti"
  fi
  if [ "$(sysctl -n kernel.apparmor_restrict_unprivileged_userns 2>/dev/null || echo 0)" = 1 ]; then
    echo
    echo 'Ubuntu (AppArmor) blocca la sandbox di Claude Code. Per sbloccare solo bubblewrap:'
    cat <<'APPARMOR'
  sudo tee /etc/apparmor.d/bwrap > /dev/null <<'EOF'
abi <abi/4.0>,
include <tunables/global>

profile bwrap /usr/bin/bwrap flags=(unconfined) {
  userns,
  include if exists <local/bwrap>
}
EOF
  sudo systemctl reload apparmor
APPARMOR
  fi
fi

echo
echo 'Per cominciare:'
continuity_n=1
if [ -n "$continuity_rileggi" ]; then
  echo "  $continuity_n. $continuity_rileggi   (rende visibile il comando in questo terminale; oppure aprine uno nuovo)"
  continuity_n=$((continuity_n + 1))
fi
echo "  $continuity_n. continuity setup   configurazione iniziale (in italiano: continuity configura)"
echo "  $((continuity_n + 1)). continuity         nella cartella di un progetto"
