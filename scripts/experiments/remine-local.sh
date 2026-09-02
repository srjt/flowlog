#!/usr/bin/env bash
# Re-mine every Gemini-mined volume with the local model, for comparison.
#
#   scripts/experiments/remine-local.sh                 # start or resume
#   scripts/experiments/remine-local.sh --list          # show the work list only
#
# Costs no money. Costs days.
#
# ~88 volumes, ~980 chunk windows, ~2 minutes per window on a rested machine:
# roughly 33 hours if throughput held, and it does not. Sustained local
# inference on this Mac decays from ~12 tok/s to 1-2 tok/s after roughly half
# an hour, and a full Ollama restart does not reliably clear it (see
# docs/LOCAL_MINING.md). Plan for several days of wall clock, not one night.
#
# So this is built to be interrupted. It is IDEMPOTENT: a volume that already
# has a records file in the output directory is skipped, so Ctrl-C and re-run
# picks up exactly where it stopped and costs nothing for what is done.
#
# Ollama is restarted before each volume. That is not a cure for the decay —
# it was measured failing to be — but it is free and it helps often enough to
# be worth the 15 seconds.
set -uo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
NODE="${NODE:-node}"
MODEL="${MODEL:-qwen3:32b}"
OUT="${OUT:-$HOME/flowlog-records-local-all}"
WORK="${WORK:-$OUT/worklist.tsv}"
LOGS="$OUT/logs"

mkdir -p "$OUT" "$LOGS"

# Build the work list once: every volume that Gemini has already mined and
# whose transcript is still on disk. Sorted shortest first, so a run that is
# cut short still covers the most volumes.
if [ ! -s "$WORK" ]; then
  "$NODE" --no-warnings=MODULE_TYPELESS_PACKAGE_JSON "$REPO/scripts/experiments/remine-worklist.ts" > "$WORK"
fi
TOTAL=$(wc -l < "$WORK" | tr -d ' ')

if [ "${1:-}" = "--list" ]; then
  cat "$WORK"; echo "($TOTAL volumes)"; exit 0
fi

DONE=$(ls "$OUT"/*.records.json 2>/dev/null | wc -l | tr -d ' ')
echo "re-mining with $MODEL -> $OUT"
echo "$DONE of $TOTAL already done; $((TOTAL - DONE)) to go"
echo

while IFS=$'\t' read -r slug path ser vol inst; do
  [ -f "$OUT/$slug.records.json" ] && continue

  pkill -f "ollama serve" 2>/dev/null; sleep 4
  ollama serve > "$LOGS/ollama.log" 2>&1 &
  for _ in $(seq 1 60); do
    curl -sf http://localhost:11434/api/version >/dev/null && break; sleep 2
  done
  # Force the model resident before the real request: a call that arrives while
  # llama-server is still loading returns a 500 and used to lose the volume.
  curl -sf http://localhost:11434/api/generate \
    -d "{\"model\":\"$MODEL\",\"prompt\":\"hi\",\"stream\":false,\"options\":{\"num_predict\":1}}" \
    >/dev/null 2>&1 || true

  start=$(date +%s)
  printf '%s  START %s\n' "$(date +%H:%M:%S)" "$slug" | tee -a "$OUT/progress.log"
  "$NODE" --no-warnings=MODULE_TYPELESS_PACKAGE_JSON "$REPO/scripts/mining/mine.ts" "$path" \
    --provider ollama --model "$MODEL" --chunk 480 \
    --instructor "$inst" --instructional "$ser" --volume "$vol" \
    --out "$OUT" > "$LOGS/$slug.log" 2>&1
  rc=$?
  secs=$(( $(date +%s) - start ))
  n=$(grep -oE '^RECORDS +[0-9]+' "$LOGS/$slug.log" | grep -oE '[0-9]+' | head -1)
  printf '%s  %-6s %-52s %5ss  %s records\n' \
    "$(date +%H:%M:%S)" "$([ $rc -eq 0 ] && echo OK || echo FAIL)" "$slug" "$secs" "${n:-0}" \
    | tee -a "$OUT/progress.log"
done < "$WORK"

echo
echo "REMINE_COMPLETE  $(ls "$OUT"/*.records.json 2>/dev/null | wc -l | tr -d ' ') of $TOTAL"
