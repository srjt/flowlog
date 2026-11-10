#!/usr/bin/env bash
# AI second opinions on live Cues (migration 027). Run from the repo root.
#
#   scripts/judge/opine.sh              # dry run: what it would judge, and the cost
#   scripts/judge/opine.sh --go         # judge them and store the opinions
#   scripts/judge/opine.sh --go --limit 10
#
# Blind first: it reports how many opinions it stored, never what they say.
# The review tool shows each one after you've judged the Cue yourself.
set -euo pipefail
exec node --no-warnings=MODULE_TYPELESS_PACKAGE_JSON \
  "$(dirname "$0")/opine.ts" "$@"
