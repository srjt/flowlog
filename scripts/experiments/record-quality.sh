#!/usr/bin/env bash
# Score mined records against their transcripts. Costs nothing — runs no model.
#
#   scripts/experiments/record-quality.sh
#   scripts/experiments/record-quality.sh --compare ~/flowlog-records-local
set -euo pipefail
exec node --no-warnings=MODULE_TYPELESS_PACKAGE_JSON \
  "$(dirname "$0")/record-quality.ts" "$@"
