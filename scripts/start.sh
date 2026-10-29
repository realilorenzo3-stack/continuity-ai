#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
. ./scripts/toolchain.sh
if [ ! -d node_modules ]; then
  echo 'Installare Node 26.4+ e pnpm 10.17.1, poi eseguire pnpm install --frozen-lockfile.' >&2
  exit 2
fi
pnpm build
exec pnpm start
