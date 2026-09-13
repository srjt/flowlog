#!/usr/bin/env bash
# The local, read-only cue review tool (docs/ADMIN.md).
#
#   scripts/admin/serve.sh        # http://127.0.0.1:4321
#
# Needs SUPABASE_SERVICE_ROLE_KEY, ADMIN_USER and ADMIN_PASSWORD in .env.
set -euo pipefail
cd "$(dirname "$0")/../.."
exec node --no-warnings=MODULE_TYPELESS_PACKAGE_JSON \
  --disable-warning=ExperimentalWarning \
  scripts/admin/server.ts "$@"
