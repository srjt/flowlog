-- ─────────────────────────────────────────────────────────────────────────────
-- `grounding_candidates` has been a LOWER BOUND, not a count, since it shipped.
--
-- Migration 013 introduced the column to say how many records existed for a
-- session's positions BEFORE the gi filter and the relevance gate, so that
-- `grounding = 'no_records'` could be split into a corpus gap (mine it) and a
-- filter outcome (mining will not help). Its comment says "records found".
--
-- The fetch behind it never found them. `loadGroundingRecords` issued one
-- request with `limit=200` and NO `order by`, and the column stored the length
-- of what came back. Measured on 2026-09-07 over 5,574 bjj records in 42
-- positions, nine positions individually exceed 200:
--
--     standing            1,114 records   200 reachable   82.0% blind
--     closed-guard-bottom   712           200             71.9%
--     half-guard-bottom     652           200             69.3%
--     half-guard-top        447           200             55.3%
--     open-guard-bottom     445           200             55.1%
--     mount-top             268           200             25.4%
--     closed-guard-top      220           200              9.1%
--     back-mount-top        219           200              8.7%
--     mount-bottom          217           200              7.8%
--     ------------------------------------------------------------
--     total               4,294         1,800             58.1%
--
-- A session usually asks for several positions under that one limit, so its
-- own blind rate is worse than any row above.
--
-- Two consequences, and the second is the one that matters:
--
--   1. Records were unreachable. Bad, and the obvious reading.
--   2. The RANKING was wrong for the records that WERE reachable. `rankRecords`
--      computes IDF over the candidate pool on purpose — the pool is already
--      narrowed to a position, and that is the set the choice is made within.
--      Over a truncated slice every term's rarity is measured against the wrong
--      denominator, so truncation changed which records won, not only which
--      records were present.
--
-- And it was silent. `grounding_candidates = 200` reads as a healthy pool;
-- nothing distinguished "200 existed" from "at least 200 existed and we took
-- an arbitrary subset". Same failure shape as 019 and as the `{{GROUNDING}}`
-- gap that preceded it: a stage doing less than it claims while every column
-- reports success.
--
-- NOTHING IS DELETED AND NOTHING IS REWRITTEN. The historical values are true
-- statements about how many records were FETCHED and false statements about
-- how many EXISTED. What changes is that a reader can no longer take them for
-- the latter without deciding what to do about them.
-- ─────────────────────────────────────────────────────────────────────────────


-- ── The boundary is a version, not a timestamp ───────────────────────────────
--
-- Same rule as 019, for the same reason: a migration whose correctness depends
-- on being applied within the right minute of `supabase functions deploy` is a
-- trap. The fixed function ships as pipeline 1.2.0, so every row states for
-- itself which fetch wrote it, and this migration is correct whether it is
-- applied before or after the deploy.
--
-- Re-analysis (ADR 0011) updates a row in place and rewrites both
-- `pipeline_version` AND `grounding_candidates`, so a 1.1.0 row re-analysed on
-- 1.2.0 really does carry an exact count and really should stop being treated
-- as a lower bound. That pairing is load-bearing: rewriting the stamp without
-- the value would make this predicate lie about the row it is asked about.
create or replace function public.grounding_candidates_is_exact(
  p_pipeline_version text
)
returns boolean
language sql
immutable
parallel safe
as $$
  -- NULL is unknown, and unknown must never be read as "it was exact". Same
  -- rule as 019's `grounding_reached_model` and 018's NULL-vs-{} distinction:
  -- absence of evidence is not evidence.
  select coalesce(p_pipeline_version, '1.0.0') not in ('1.0.0', '1.1.0');
$$;

comment on function public.grounding_candidates_is_exact(text) is
  'Is sessions.grounding_candidates an exact count for a session of this '
  'pipeline version, or a lower bound? False for 1.0.0, 1.1.0 and NULL, whose '
  'candidate fetch was capped at 200 unordered rows (#114). The single place '
  'the 1.1.0 boundary is encoded — read it, do not re-type the version.';


-- ── Make the column impossible to read innocently ────────────────────────────
--
-- Restated in full rather than appended to, because `comment on` replaces.
comment on column public.sessions.grounding_candidates is
  $$Records that EXIST for the resolved positions, before the gi filter and the
    relevance gate (#58). Taken from the database's own count, not from the
    number of rows the pipeline fetched. Null on rows predating the column, and
    null when the count was unavailable — null is unknown, and the mining
    backlog excludes it rather than guessing.

    With grounding = no_records: 0 means the corpus is empty for that position
    (mine it), > 0 means records existed but were filtered out (mining will not
    help).

    CAVEAT (migration 020). On pipeline_version 1.0.0 and 1.1.0 this is a LOWER
    BOUND, not a count: the fetch was capped at 200 rows with no ordering, so
    the value is the number FETCHED and any row reading exactly 200 means "at
    least 200, true size unknown". Nine positions exceed 200 on their own, and
    58% of the records across them were unreachable. Gate every read on
    grounding_candidates_is_exact(pipeline_version), and never max() or average
    across the boundary — the two sides count different things.$$;


-- ── What this does NOT fix ───────────────────────────────────────────────────
--
-- The grounded/withheld experiment is not void over 1.1.0 rows, unlike 1.0.0:
-- both arms drew from the same truncated pool in any given run, so the
-- comparison stays internally valid. What is not valid is POOLING 1.1.0 and
-- 1.2.0 grounded sessions, because the grounded arm received a materially
-- different treatment on each side of the boundary — a cue grounded in the
-- best 20 of an arbitrary 200 is not a cue grounded in the best 20 of 1,114.
-- Segment on the version; do not backfill. Rewriting cues users have already
-- read and rated would break 018's `record_feedback_signal` in exactly the way
-- 019 was written to repair.
