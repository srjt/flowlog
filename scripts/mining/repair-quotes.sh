#!/usr/bin/env bash
# Trim spliced quotes in a mined record store to a verbatim span.
# Costs nothing. Dry-run by default.
#
#   scripts/mining/repair-quotes.sh
#   scripts/mining/repair-quotes.sh --write
set -euo pipefail
exec node --no-warnings=MODULE_TYPELESS_PACKAGE_JSON \
  "$(dirname "$0")/repair-quotes.ts" "$@"
