# Working notes

## About the learner
- Owns this codebase. Do not explain TypeScript, Supabase, or git.
- Picked: improve cue quality, debug it, explain it. Did NOT pick operating it.
  So: teach seams, measurements and traces — not runbooks.

## Teaching preferences observed
- (none stated yet — update as they emerge)

## House rules for this workspace
- Lives in `.teach/` rather than the repo root: the root already has an
  `assets/` directory (Expo), and this repo is public. Consider gitignoring.
- **Never** paste verbatim instructional text into a lesson. The review store is
  third-party copyrighted material; that is the whole point of the two stores.
- Every claim in a lesson cites a file and line in this repo.

## Open threads to teach later
- **Next lesson (3): the measurement stack**, promised at the end of lesson 2 —
  it is what makes the lesson-2 knobs safe to turn. The measurement stack: `record-quality.sh`, `record-agreement.sh`,
  `blind-compare.sh`, `scripts/judge/`, `scripts/replay/`. The replay harness is
  the tool for "would this change have made cues better?" — directly on mission.
- The certification loop (migrations 014-017) and `record_feedback_signal`:
  how a thumbs-down becomes a review task.
- Position taxonomy + `normalizePosition`: the `no_position` failure cause, and
  why perspective is part of a position's identity.
- The A/B experiment: `assignGrounding`, the `withheld` arm, and what it can and
  cannot conclude. Now re-runnable from pipeline 1.1.0 via `grounding_experiment`.
- The 200-row fetch limit (lesson 2, decision 6) — the open defect. Measure
  run-to-run stability of the untruncated query BEFORE proposing a fix.
