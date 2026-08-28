#!/usr/bin/env bash
# Does a second instructional on the same position change the prompt? (#99)
# Costs nothing — runs no model.
set -euo pipefail
exec node --no-warnings=MODULE_TYPELESS_PACKAGE_JSON \
  "$(dirname "$0")/multi-source.ts" "$@"
