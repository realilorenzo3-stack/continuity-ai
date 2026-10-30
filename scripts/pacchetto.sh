#!/bin/sh
# Il pacchetto già pronto di una versione per un sistema (piano di
# pubblicazione, 30 ottobre: installazione in pochi secondi, come opencode).
#   sh scripts/pacchetto.sh <versione> <sistema-architettura> <cartella di uscita>
# sistema-architettura: darwin-arm64, darwin-x64, linux-x64, linux-arm64.
# Dentro: app/ (programma con le sole dipendenze che servono e il pannello web
# già compilato) e node/ (Node ufficiale da nodejs.org, con l'impronta
# controllata). L'installatore lo estrae e lo copia: niente npm, niente
# compilazione. Va eseguito sullo stesso sistema del pacchetto, perché le
# parti native delle dipendenze sono di quel sistema; prima serve `pnpm build`
# (per dist/).
set -eu

continuity_v=$1
continuity_piattaforma=$2
continuity_uscita=$3
continuity_node_v='26.10.0'
continuity_radice="$(cd "$(dirname "$0")/.." && pwd)"
continuity_nome="continuity-$continuity_v-$continuity_piattaforma"

[ -d "$continuity_radice/dist" ] || {
  echo 'Manca dist/: esegui prima pnpm build.' >&2
  exit 2
}
continuity_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

continuity_lavoro=$(mktemp -d)
trap 'rm -rf "$continuity_lavoro"' EXIT
continuity_app="$continuity_lavoro/$continuity_nome/app"
mkdir -p "$continuity_app/docs"
# Gli stessi file che copia l'installatore dai sorgenti, più dist/.
for item in package.json pnpm-lock.yaml tsconfig.json tsconfig.tui.json vite.config.ts \
  vitest.config.ts playwright.config.ts index.html .node-version \
  README.md LICENSE NOTICE THIRD_PARTY_NOTICES.md PRIVACY.md SECURITY.md \
  src schemas scripts piattaforme dist; do
  cp -R "$continuity_radice/$item" "$continuity_app/"
done
for item in CONFORMITA.md COPYRIGHT.md; do
  [ -e "$continuity_radice/docs/$item" ] && cp "$continuity_radice/docs/$item" "$continuity_app/docs/"
done
(cd "$continuity_app" && pnpm install --frozen-lockfile --prod --silent)
printf '%s\n' "$continuity_v" >"$continuity_app/.continuity-version"
printf '{"commit":"%s","installataIl":"%s","pronto":true}\n' \
  "$(git -C "$continuity_radice" rev-parse --short HEAD 2>/dev/null || true)" \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$continuity_app/.continuity-build.json"

# Node ufficiale per quel sistema, controllato con le impronte di nodejs.org.
continuity_node_pacchetto="node-v$continuity_node_v-$continuity_piattaforma.tar.gz"
curl -fsSL "https://nodejs.org/dist/v$continuity_node_v/$continuity_node_pacchetto" -o "$continuity_lavoro/node.tar.gz"
continuity_atteso=$(curl -fsSL "https://nodejs.org/dist/v$continuity_node_v/SHASUMS256.txt" |
  awk -v f="$continuity_node_pacchetto" '$2 == f { print $1 }')
if [ -z "$continuity_atteso" ] || [ "$continuity_atteso" != "$(continuity_sha256 "$continuity_lavoro/node.tar.gz")" ]; then
  echo "Node scaricato non corrisponde alla sua impronta." >&2
  exit 1
fi
mkdir -p "$continuity_lavoro/node-intero" "$continuity_lavoro/$continuity_nome/node/bin"
tar -xzf "$continuity_lavoro/node.tar.gz" -C "$continuity_lavoro/node-intero" --strip-components=1
# Solo il programma node e la sua licenza: npm, gli header e la documentazione
# (222 MB, migliaia di file) non servono a Continuity e rallentavano
# l'installazione.
cp "$continuity_lavoro/node-intero/bin/node" "$continuity_lavoro/$continuity_nome/node/bin/node"
cp "$continuity_lavoro/node-intero/LICENSE" "$continuity_lavoro/$continuity_nome/node/LICENSE"
rm -rf "$continuity_lavoro/node-intero" "$continuity_lavoro/node.tar.gz"

mkdir -p "$continuity_uscita"
tar -czf "$continuity_uscita/$continuity_nome.tar.gz" -C "$continuity_lavoro" "$continuity_nome"
echo "$continuity_uscita/$continuity_nome.tar.gz"
