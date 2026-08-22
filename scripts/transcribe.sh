#!/usr/bin/env bash
# Convenience wrapper. The script is stdlib-only, so any python3 works.
# Usage: scripts/transcribe.sh <file-or-directory> [--model large-v3] [--timestamps]
set -euo pipefail
exec python3 "$(dirname "$0")/transcribe.py" "$@"
