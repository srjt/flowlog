#!/usr/bin/env bash
set -euo pipefail
exec node --no-warnings=MODULE_TYPELESS_PACKAGE_JSON "$(dirname "$0")/replay.ts" "$@"
