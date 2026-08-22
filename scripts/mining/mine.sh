#!/usr/bin/env bash
# Convenience wrapper for the miner, mirroring scripts/transcribe.sh.
#
# Runs mine.ts on Node's native TypeScript support and silences the
# MODULE_TYPELESS_PACKAGE_JSON notice. That warning fires because the taxonomy
# it imports lives under src/, which stays CommonJS for the Expo app — the
# re-parse is harmless and the warning is pure noise on every run.
#
#   scripts/mining/mine.sh <volume.txt> --instructor X --instructional Y --volume N
#   scripts/mining/mine.sh --list-models
set -euo pipefail
exec node --no-warnings=MODULE_TYPELESS_PACKAGE_JSON \
  "$(dirname "$0")/mine.ts" "$@"
