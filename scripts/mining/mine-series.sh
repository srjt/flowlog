#!/usr/bin/env bash
# Convenience wrapper. See mine-series.ts for usage.
set -euo pipefail
exec node --no-warnings=MODULE_TYPELESS_PACKAGE_JSON \
  "$(dirname "$0")/mine-series.ts" "$@"
