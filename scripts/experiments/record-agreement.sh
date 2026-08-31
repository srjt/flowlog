#!/usr/bin/env bash
# How close is a candidate miner to the Gemini output already in the corpus?
# Costs nothing — runs no model.
#
#   scripts/experiments/record-agreement.sh ~/flowlog-records-q32 ~/flowlog-records-local-chunked
set -euo pipefail
exec node --no-warnings=MODULE_TYPELESS_PACKAGE_JSON \
  "$(dirname "$0")/record-agreement.ts" "$@"
