#!/usr/bin/env bash
# Do two contradicting absolutes reach the same prompt? (#102)
# Costs nothing — runs no model. Run before and after mining a new title.
set -euo pipefail
exec node --no-warnings=MODULE_TYPELESS_PACKAGE_JSON \
  "$(dirname "$0")/collisions.ts" "$@"
