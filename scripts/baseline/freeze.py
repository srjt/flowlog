#!/usr/bin/env python3
"""Freeze the cue baseline for wayfinder #32 (map #30).

Takes the JSON downloaded from the Supabase SQL editor (see export.sql) and
writes an immovable, checksummed snapshot, then reports what's in it.

    scripts/baseline/freeze.py ~/Downloads/result.json
    scripts/baseline/freeze.py ~/Downloads/result.json --out baseline/

The snapshot is the reference every later claim on the map is measured against
(#35), so it must not be regenerated in place. Re-running against an existing
snapshot VERIFIES instead of overwriting: it re-checksums and reports any drift.

Stdlib only. Writes outside the repo tree by default — the snapshot holds real
transcripts and must never be committed.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

# Positions the escape corpus can speak to. Used only for a rough in-corpus
# read — the real judgement is the hand-read in #36.
ESCAPE_TERMS = [
    "mount", "mounted", "side control", "sidecontrol", "north south",
    "north-south", "knee on belly", "knee-on-belly", "turtle", "back control",
    "back mount", "took my back", "pinned", "pin", "kesa", "scarf",
    "escape", "stuck under", "underneath", "flatten", "bridge", "shrimp",
    "upa", "elbow escape",
]

FIELDS = [
    "id", "user_id", "sport_key", "session_date", "created_at",
    "raw_transcript", "positions_visited", "key_mistake", "opponent_action",
    "sentiment", "coaching_cue", "target_position", "quality_gate_passed",
    "pipeline_version", "thumbs_up", "feedback_reason", "feedback_note",
    "audio_storage_path", "skill_level",
]


def die(msg: str):
    sys.exit(f"error: {msg}")


def canonical(rows: list[dict]) -> str:
    """Stable serialisation — sorted keys, fixed row order, so the checksum
    only changes when the DATA changes."""
    norm = [{k: r.get(k) for k in FIELDS} for r in rows]
    norm.sort(key=lambda r: (str(r.get("session_date")), str(r.get("id"))))
    return json.dumps(norm, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def load(path: Path) -> list[dict]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        die(f"could not read {path}: {exc}")
    # The dashboard exports a bare array; tolerate a wrapped shape too.
    if isinstance(data, dict):
        for key in ("rows", "data", "result"):
            if isinstance(data.get(key), list):
                data = data[key]
                break
    if not isinstance(data, list):
        die("expected a JSON array of session rows")
    if not data:
        die("export is empty — check the query returned rows for your user")
    missing = [f for f in ("id", "coaching_cue", "raw_transcript") if f not in data[0]]
    if missing:
        die(f"rows are missing expected fields: {', '.join(missing)} "
            f"(did you run scripts/baseline/export.sql?)")
    return data


def in_corpus(row: dict) -> bool:
    blob = " ".join(str(row.get(f) or "") for f in
                    ("raw_transcript", "key_mistake", "opponent_action",
                     "target_position")).lower()
    blob += " " + " ".join(str(x).lower() for x in (row.get("positions_visited") or []))
    return any(t in blob for t in ESCAPE_TERMS)


def report(rows: list[dict]) -> None:
    n = len(rows)
    inc = [r for r in rows if in_corpus(r)]
    rated = [r for r in rows if r.get("thumbs_up") is not None]
    down = [r for r in rated if r.get("thumbs_up") is False]
    gate_failed = [r for r in rows if r.get("quality_gate_passed") is False]
    versions = sorted({str(r.get("pipeline_version")) for r in rows})
    no_cue = [r for r in rows if not (r.get("coaching_cue") or "").strip()]

    print(f"\n  sessions                {n}")
    print(f"  escape-relevant (rough) {len(inc)}  ({100*len(inc)//max(n,1)}%)"
          f"   <- #36 reads these; the rest are out-of-corpus")
    print(f"  rated by you            {len(rated)}   ({len(down)} thumbs-down)")
    print(f"  quality gate failed     {len(gate_failed)}")
    print(f"  pipeline versions       {', '.join(versions)}")
    if no_cue:
        print(f"  !! sessions with no cue {len(no_cue)}")
    if len(versions) > 1:
        print("  !! multiple pipeline versions — cues were not all produced by the "
              "same code; note this when comparing before/after")
    if n < 20:
        print(f"  !! only {n} sessions — thinner than the ~20 the map assumed")

    lengths = sorted(len((r.get("raw_transcript") or "").split()) for r in rows)
    if lengths:
        mid = lengths[len(lengths) // 2]
        print(f"  transcript words        min {lengths[0]} / median {mid} / max {lengths[-1]}")
    print()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("export", type=Path, help="JSON downloaded from the SQL editor")
    ap.add_argument("--out", type=Path,
                    default=Path.home() / "flowlog-baseline",
                    help="snapshot directory (default: ~/flowlog-baseline, "
                         "deliberately outside the repo — holds real transcripts)")
    ap.add_argument("--force", action="store_true",
                    help="overwrite an existing snapshot (you almost never want this — "
                         "the baseline is meant to be immovable)")
    args = ap.parse_args()

    rows = load(args.export)
    body = canonical(rows)
    digest = hashlib.sha256(body.encode()).hexdigest()

    args.out.mkdir(parents=True, exist_ok=True)
    snap = args.out / "baseline.json"
    meta_path = args.out / "baseline.meta.json"

    if snap.exists() and not args.force:
        existing = snap.read_text(encoding="utf-8")
        old = hashlib.sha256(existing.encode()).hexdigest()
        print(f"\nSnapshot already exists: {snap}")
        if old == digest:
            print(f"VERIFIED — identical to the frozen baseline (sha256 {digest[:16]}…)")
        else:
            print("DRIFT — the export differs from the frozen baseline.")
            print(f"  frozen : {old[:16]}…\n  export : {digest[:16]}…")
            print("The baseline is the fixed point every later comparison uses; it is\n"
                  "not supposed to change. Investigate before using --force.")
        report(rows)
        return

    snap.write_text(body, encoding="utf-8")
    meta_path.write_text(json.dumps({
        "frozen_at": datetime.now(timezone.utc).isoformat(),
        "sha256": digest,
        "session_count": len(rows),
        "fields": FIELDS,
        "source": str(args.export),
        "note": "Frozen baseline for wayfinder #32 (map #30). Do not regenerate "
                "in place — later comparisons are measured against this file.",
    }, indent=2) + "\n", encoding="utf-8")

    print(f"\nFROZEN  {snap}")
    print(f"        sha256 {digest}")
    report(rows)


if __name__ == "__main__":
    main()
