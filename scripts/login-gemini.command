#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
. ./scripts/toolchain.sh
exec pnpm continuity gemini-login
