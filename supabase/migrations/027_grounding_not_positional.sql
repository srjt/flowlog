-- ─────────────────────────────────────────────────────────────────────────────
-- Don't ground a Cue on co-mentioned positions when the mistake isn't about a
-- position (#153, split out of #116).
--
-- Grounding resolves every position in `positions_visited` and injects records
-- for them. When the key mistake is about finishing a submission or executing
-- a transition, those positions were only co-mentioned. Session `5e78158b`:
--
--   mistake    unable to finish the reverse triangle, opponent stacked it
--   positions  ["Side Control", "Reverse Triangle"]
--   grounded   9 records, all side-control-bottom (escaping a pin)
--
-- Measured in #116, 3 of 16 grounded Sessions received records for a different
-- problem this way. The prompt tells the model it may discard them, and so far
-- it has, but that is prompt budget spent on waste.
--
-- `target_position_id` cannot be the condition: it is resolved from the
-- coaching output, AFTER the call the records are for. So Extraction now
-- reports what the key mistake concerns, and grounding abstains on an explicit
-- 'submission' or 'transition' with a new outcome, `not_positional`.
-- 'position' and 'unknown' ground exactly as before, so an unsure Extraction
-- never quietly loses grounding.
--
-- ── `not_positional` is not `no_position` ───────────────────────────────────
--
-- `no_position` means the taxonomy failed to resolve a position, and the mining
-- backlog files its free text as a taxonomy fix. An abstention is a decision
-- about the mistake, not a gap in the taxonomy or the corpus, so it gets its
-- own value and is counted as neither `no_position` nor `no_records`. Like
-- those two it is eligibility, not an experiment arm.
--
-- An abstained Session looks nothing up and ranks nothing, so it writes the
-- funnel the declined Take writes: grounding_records 0, grounding_available 0,
-- grounding_record_ids {}, and grounding_candidates and grounding_gate_passed
-- NULL. NULL is "not measured". 0 would claim the corpus was empty (#58) or
-- that the gate rejected everything (#119), and neither happened.
--
-- ── Version boundary ────────────────────────────────────────────────────────
--
-- Record selection changes, so pipeline_version moves to 1.4.0, by the rule in
-- src/constants/pipelineVersion.ts. `not_positional` appears only on 1.4.0+
-- rows. A row before 1.4.0 that would abstain today grounded on co-mentioned
-- positions instead; its mistake_concerns is NULL.
--
-- ── NULL is "not recorded", and is said so up front ─────────────────────────
--
-- The rule 024 stated for `perspective`, for the same reason:
--
--   NULL       not recorded. Every Session written before this migration. It
--              is NEVER "Extraction could not tell", and must not be counted
--              as one.
--   'unknown'  recorded: Extraction could not tell, and said so rather than
--              guess. It grounds exactly as 'position' does.
--
-- So "how often does Extraction say a mistake is not about a position" is
-- counted over `mistake_concerns is not null`, never over the whole table. The
-- column exists to audit the classifier, e.g. 'position' whose Cue then
-- resolved to no target position, or 'submission' whose Cue resolved to one.
--
-- ── Written on every path that writes an Extraction ─────────────────────────
--
-- The one-shot insert, the declined insert, the Re-analyze update and the
-- declined Re-analyze update, as 024's `perspective` is. Re-analysis
-- OVERWRITES it: the edited transcript is a new Extraction.
--
-- ── The constraint ──────────────────────────────────────────────────────────
--
-- 010 declared the CHECK inline on the column, so Postgres named it
-- `sessions_grounding_check`; no migration since has redefined it. It is
-- dropped and recreated by that name, keeping every existing value, in ONE
-- statement so there is no moment without it. `drop constraint` deliberately
-- has no `if exists`: should the name ever differ, the migration fails here,
-- instead of leaving the old constraint in place to reject every abstained
-- Session the function writes.
--
-- ORDER MATTERS ON DEPLOY. `process-session` writes `mistake_concerns` on every
-- Session and `grounding = 'not_positional'` on abstained ones, so apply this
-- migration BEFORE deploying that function. The other order fails writes with
-- PGRST204 (the `feedback_reason` incident in docs/MIGRATIONS.md), or with a
-- CHECK violation that costs the athlete the Session.
--
-- Not a backfill: a past Session's mistake can only be re-classified, and a
-- guess written into a column that reads as recorded truth is the failure the
-- NULL rule exists to end.
--
-- NOTHING IS DELETED AND NOTHING IS REWRITTEN.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.sessions
  drop constraint sessions_grounding_check,
  add constraint sessions_grounding_check
    check (grounding in ('grounded', 'withheld', 'no_position', 'no_records', 'declined', 'not_positional'));

alter table public.sessions
  add column if not exists mistake_concerns text
    check (mistake_concerns in ('position', 'submission', 'transition', 'unknown'));

comment on column public.sessions.mistake_concerns is
  $$What the key mistake is about, as Extraction reported it (#153).

    NULL means NOT RECORDED: the Session was written before migration 027. It
    is never "Extraction could not tell" and must not be counted as one. There
    is no backfill.

    position    holding, escaping, passing, retaining or recovering a
                position, defending a submission from one included
    submission  failing to finish or secure the athlete's own submission
    transition  failing to execute a specific move that is not about
                controlling a position
    unknown     recorded: Extraction could not tell, and said so rather than
                guess. Grounds exactly as 'position' does.

    Grounding abstains, as grounding = 'not_positional', on 'submission' and
    'transition' only. Written on every path that writes an Extraction, a
    declined Take included. Re-analysis overwrites it with the edited
    transcript's answer, so it describes the Extraction the row holds now.$$;


-- ── Restate the outcome list ─────────────────────────────────────────────────
--
-- Restated in full rather than appended to, because `comment on` replaces. The
-- 019 and 021 caveats are carried forward verbatim; they still hold.

comment on column public.sessions.grounding is
  $$Why the cue was or was not grounded.
    grounded       - records were SELECTED for injection
    withheld       - records WERE available but the experiment assigned this
                     session to the control arm; the counterfactual for 'grounded'
    no_position    - the free-text position never resolved to a canonical id
                     (usually the side was unknown, or it was a submission).
                     Fix: taxonomy or extraction.
    no_records     - the id resolved but the corpus has nothing. Fix: mine that position.
    declined       - the take had nothing coachable in it (#44); no cue was written.
    not_positional - Extraction said the key mistake is about finishing a
                     submission or executing a transition, not a position
                     (mistake_concerns, #153), so grounding abstained and
                     looked nothing up. A decision, not a gap: neither
                     no_position nor no_records, and nothing to mine or fix.
                     Only on pipeline_version 1.4.0+ (migration 027).

    CAVEAT (migration 019). On pipeline_version 1.0.0 this column records what
    was SELECTED, not what the model received: the prompt carried the literal
    `{{GROUNDING}}` and no mechanics. Gate every read on
    grounding_reached_model(pipeline_version). 'grounded' and 'withheld' are
    the same condition over those rows.

    CAVEAT (migration 021). On a row re-analysed before 1.3.0 this describes the
    ORIGINAL run, not the cue the row now holds. A declined re-analysis left it
    reading 'grounded' on a row with a NULL cue. reanalyzed_at is NULL for every
    such row, so they cannot be identified — treat 'grounded' on any row with
    reanalyzed_at IS NULL and pipeline_version < 1.3.0 as unverified.$$;

comment on column public.sessions.grounding_candidates is
  $$Records that EXIST for the resolved positions, before the gi filter and the
    relevance gate (#58). Taken from the database's own count, not from the
    number of rows the pipeline fetched. Null on rows predating the column, and
    null when the count was unavailable — null is unknown, and the mining
    backlog excludes it rather than guessing. Null too when grounding =
    'not_positional' (migration 027): grounding abstained and looked nothing up.

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

comment on column public.sessions.grounding_gate_passed is
  $$How many records cleared the relevance gate, BEFORE the rank cap (#119).

    The number grounding_available was always documented as holding and never
    did. Together they separate two different narrowings that used to be
    indistinguishable:

      grounding_candidates  -> grounding_gate_passed   the relevance gate
      grounding_gate_passed -> grounding_records       GROUNDING_RECORD_LIMIT

    NULL means not recorded: every row before this column existed, and any row
    where grounding was never looked up or ranked (a declined take, a lookup
    failure, or grounding = 'not_positional', migration 027). NULL is not 0 —
    0 means the gate rejected everything, which is a finding about the corpus,
    and reading one as the other is the #58 error one layer down.$$;

notify pgrst, 'reload schema';
