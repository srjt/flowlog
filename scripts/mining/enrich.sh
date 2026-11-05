#!/usr/bin/env bash
# Second pass: fill empty counter / opponent from the transcript window around
# each record. Every addition must carry verifiable evidence or it is dropped.
#
#   scripts/mining/enrich.sh <records-dir> --dry-run
#   scripts/mining/enrich.sh <records-dir> --only ageless
#
# <records-dir> is normally the canonical store, defined once in stores.ts:
#   scripts/mining/enrich.sh "$(scripts/mining/publish.sh --which-store)" --dry-run
set -euo pipefail
exec node --no-warnings=MODULE_TYPELESS_PACKAGE_JSON \
  "$(dirname "$0")/enrich.ts" "$@"
