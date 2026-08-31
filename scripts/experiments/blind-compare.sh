#!/usr/bin/env bash
# Blind side-by-side review sheet, Gemini vs a local run. Costs nothing.
#
#   scripts/experiments/blind-compare.sh ~/flowlog-records-q32 --sample 20
#   scripts/experiments/blind-compare.sh ~/flowlog-records-q32 --sample 20 --key
set -euo pipefail
exec node --no-warnings=MODULE_TYPELESS_PACKAGE_JSON \
  "$(dirname "$0")/blind-compare.ts" "$@"
