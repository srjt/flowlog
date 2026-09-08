-- ─────────────────────────────────────────────────────────────────────────────
-- `grounding_available` is min(matched, 20), not "how many matched".
--
-- Migration 013 documented a three-tier funnel:
--
--   grounding_candidates  records found for the position (pre-filter)
--   grounding_available   survived gi + relevance (the control's counterfactual)
--   grounding_records     actually injected (0 unless grounded)
--
-- The middle tier does not measure that. `grounding_available` is written from
-- `assignGrounding(..., relevantRecords.length, ...)`, and `relevantRecords` is
-- the output of `rankRecords`, which ends in `.slice(0, GROUNDING_RECORD_LIMIT)`.
-- So the column is capped at 20 by construction and can never exceed it.
--
-- Measured on the session of 2026-09-08 (closed-guard-bottom, gi), replaying the
-- shipped modules over the live corpus:
--
--   candidates for the position          712
--   survived the gi filter               703
--   TRULY cleared the relevance gate      70   <- what the column claims to hold
--   recorded as grounding_available       20   <- what it actually held
--
-- Under-reported by 71%. Three consecutive sessions read exactly 20, which is
-- what surfaced it. On the largest realistic multi-position session the funnel
-- is 2,478 -> 2,386 -> 281 -> 20: the relevance gate cuts 88%, and
-- GROUNDING_RECORD_LIMIT cuts 93% of what survives. The limit — documented as a
-- dilution guard — is doing most of the filtering, and no row said so.
--
-- ── What this is NOT ─────────────────────────────────────────────────────────
--
-- A measurement gap and a false comment. NOT an active corruption, and it should
-- not be read as one:
--
--   * Nothing consumes the column. `scripts/backlog/rank.ts` reads `grounding`
--     and `grounding_candidates`; 018's `record_feedback_signal` reads
--     `grounding_record_ids`. Its one decision role — telling `withheld`-with-
--     records from `no_records` — works with any positive number.
--   * 019's wording is half right: "how many matched the mistake and COULD have
--     been injected". The second clause is TRUE, since only 20 can ever be
--     injected. It is the first clause that overstates.
--   * That is the difference from #114, where `grounding_candidates` fed mining
--     decisions and the truncation actively misdirected them.
--
-- Sharper still: in the grounded arm this column always EQUALS
-- `grounding_records` — 019 says so outright — and at GROUNDING_ROLLOUT = 1
-- there is no withheld arm. So today it carries no information at all beyond
-- `grounding_records`.
--
-- It is fixed because #116 must calibrate a cosine threshold against the current
-- keyword gate, and that comparison IS the gate's selectivity. The gap bites
-- exactly when that work starts, and it cannot be recovered retroactively: the
-- number was clipped before it was stored.
--
-- NOTHING IS DELETED AND NOTHING IS REWRITTEN.
-- ─────────────────────────────────────────────────────────────────────────────


-- ── A new column, so no version boundary is needed ───────────────────────────
--
-- Unlike 020 (a column's MEANING changed, so old values needed reinterpreting)
-- and 021 (values went stale, indistinguishable from correct ones), a new
-- nullable column is self-describing: NULL means "not recorded", and there is
-- nothing to segment. `pipeline_version` is deliberately NOT bumped — this
-- changes no behaviour. The prompt, the injected records and the cue are all
-- identical; one extra number is written. Stamping a new version would assert a
-- distinction that does not exist and blunt a field three migrations now rely on
-- for real segmentation.
alter table public.sessions
  add column if not exists grounding_gate_passed integer;

comment on column public.sessions.grounding_gate_passed is
  $$How many records cleared the relevance gate, BEFORE the rank cap (#119).

    The number grounding_available was always documented as holding and never
    did. Together they separate two different narrowings that used to be
    indistinguishable:

      grounding_candidates  -> grounding_gate_passed   the relevance gate
      grounding_gate_passed -> grounding_records       GROUNDING_RECORD_LIMIT

    NULL means not recorded: every row before this column existed, and any row
    where grounding was never looked up or ranked (a declined take, a lookup
    failure). NULL is not 0 — 0 means the gate rejected everything, which is a
    finding about the corpus, and reading one as the other is the #58 error one
    layer down.$$;


-- ── Say what grounding_available actually is ─────────────────────────────────
--
-- Restated in full rather than appended to, because `comment on` replaces. The
-- 1.1.0+ and re-analysis caveats from 019 and 021 are carried forward verbatim;
-- both still hold.
comment on column public.sessions.grounding_available is
  $$How many records COULD have been injected: min(grounding_gate_passed,
    GROUNDING_RECORD_LIMIT). Equal to grounding_records in the grounded arm; the
    same population in the withheld arm, which is what makes the two comparable
    — over 1.1.0+ rows only.

    CAVEAT (migration 022). This is NOT "how many matched the mistake", despite
    migration 013 describing the funnel that way. It is the length of the
    already-capped set, so it saturates at GROUNDING_RECORD_LIMIT and a value of
    exactly 20 means "at least 20". Use grounding_gate_passed for the gate's
    selectivity; this column cannot answer it, and is NULL-free but capped on
    every row written before 022.

    CAVEAT (migration 021). On a row re-analysed before 1.3.0, measured against
    the superseded extraction.$$;
