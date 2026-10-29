#!/bin/sh
# Sourced by launchers after changing to the application directory.
# Continuity 2.0 gira su Node 26.4 o più recente: OpenTUI, la nuova interfaccia,
# usa node:ffi (Fase 2, 14 ottobre 2026). La toolchain della 2.0 sta nella sua
# cartella dati e non tocca quella di Continuity 1 (Node 24).
continuity_toolchain_bin="${CONTINUITY_TOOLCHAIN_BIN:-$HOME/Library/Application Support/Continuity_2.0/toolchain/node_modules/.bin}"
if [ -x "$continuity_toolchain_bin/node" ] && [ -x "$continuity_toolchain_bin/pnpm" ]; then
  export PATH="$continuity_toolchain_bin:$PATH"
fi
if ! command -v node >/dev/null 2>&1 || ! command -v pnpm >/dev/null 2>&1; then
  echo 'Toolchain di Continuity 2.0 assente. Installarla con:' >&2
  echo 'npm install --prefix "$HOME/Library/Application Support/Continuity_2.0/toolchain" --no-audit --no-fund --save-exact node@26.10.0 pnpm@10.17.1' >&2
  exit 2
fi
if ! node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a===26&&b>=4?0:1)'; then
  echo "Continuity 2.0 richiede Node 26.4 o più recente (trovato $(node -v)). Installare la toolchain indicata nel README." >&2
  exit 2
fi
