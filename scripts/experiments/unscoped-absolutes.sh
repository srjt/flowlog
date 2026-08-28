#!/usr/bin/env bash
# Records that state an absolute without saying when it applies (#102).
# Costs nothing — runs no model.
set -euo pipefail
exec node --no-warnings=MODULE_TYPELESS_PACKAGE_JSON \
  "$(dirname "$0")/unscoped-absolutes.ts" "$@"
