#!/usr/bin/env bash
# Validate the cue judge against the frozen human verdicts (#61).
#
#   scripts/judge/judge.sh              # full run (cached, so re-runs are free)
#   scripts/judge/judge.sh --limit 5    # cheap smoke run
#   scripts/judge/judge.sh --fresh      # ignore the cache and re-judge
#
# Exits non-zero when the judge misses the pass bar. That is a finding to
# report, not a number to tune until it agrees.
set -euo pipefail
exec node --no-warnings=MODULE_TYPELESS_PACKAGE_JSON \
  "$(dirname "$0")/run.ts" "$@"
