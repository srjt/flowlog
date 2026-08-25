#!/usr/bin/env bash
# Read what reviewers said about records they rejected or disputed (#84).
#
#   scripts/review/notes.sh          # rejected + contested only
#   scripts/review/notes.sh --all    # every note
set -euo pipefail
exec node --no-warnings=MODULE_TYPELESS_PACKAGE_JSON \
  "$(dirname "$0")/notes.ts" "$@"
