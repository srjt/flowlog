#!/usr/bin/env bash
# Print the mining backlog (#58) — positions ranked by how often a session
# wanted grounding and the corpus had nothing.
#
#   scripts/backlog/backlog.sh
#
# Reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.
set -euo pipefail
exec node --no-warnings=MODULE_TYPELESS_PACKAGE_JSON \
  "$(dirname "$0")/backlog.ts" "$@"
