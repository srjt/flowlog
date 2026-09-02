#!/usr/bin/env bash
# Second pass: fill empty counter / opponent from the transcript window around
# each record. Every addition must carry verifiable evidence or it is dropped.
#
#   scripts/mining/enrich.sh ~/flowlog-records-local-all --dry-run
#   scripts/mining/enrich.sh ~/flowlog-records-local-all --only ageless
set -euo pipefail
exec node --no-warnings=MODULE_TYPELESS_PACKAGE_JSON \
  "$(dirname "$0")/enrich.ts" "$@"
