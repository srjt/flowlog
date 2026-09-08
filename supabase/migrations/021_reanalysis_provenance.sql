-- ─────────────────────────────────────────────────────────────────────────────
-- Re-analysis left the grounding provenance columns describing the PREVIOUS run.
--
-- ADR 0011 makes correction a post-hoc action: the user edits a saved session's
-- transcript and re-analyses, which re-runs extraction -> coaching -> quality
-- gate and updates the same row in place. That path rewrote the cue, the
-- extraction fields and `pipeline_version` — and left `grounding`,
-- `grounding_records`, `grounding_available` and `grounding_record_ids` exactly
-- as the original run wrote them.
--
-- The whole point of re-analysis is that the transcript changed, which changes
-- `key_mistake`, which changes the terms `rankRecords` scores on. A re-analysed
-- session therefore generally grounds on a DIFFERENT set of records than the one
-- its row names.
--
-- Three consequences:
--
--   1. `grounding_record_ids` names the records behind a cue that no longer
--      exists, so 018's `record_feedback_signal` attributes a thumbs-up or down
--      on the NEW cue to the records that grounded the OLD one. This is the same
--      corruption 019 was written to repair, arriving through a different door —
--      and 019's guard does not catch it. That gates on
--      `grounding_reached_model(pipeline_version)`, and a re-analysed row
--      carries a FRESH version stamp, so it passes the gate holding stale ids.
--
--   2. A declined re-analysis (#44) set the cue to NULL while leaving
--      `grounding = 'grounded'`, a record count and populated record ids — a row
--      claiming records grounded a cue it does not have. The INSERT path has
--      always handled the same situation correctly ('declined', 0, 0, {}, null).
--
--   3. Re-analysis never consulted the experiment arm at all: `assignGrounding`
--      was called only on the insert path. A session assigned to `withheld`
--      received a fully grounded cue on re-analysis while its row went on
--      reading `withheld`.
--
-- On (3) — the honest scope. `GROUNDING_ROLLOUT` is 1: the experiment is
-- concluded and every eligible session is grounded, so `assignGrounding` cannot
-- currently return `withheld` and re-analysis grounding unconditionally AGREES
-- with the insert path. The 7 historical `withheld` rows are all
-- pipeline_version 1.0.0, which 019 already voids for an unrelated reason. So
-- this was a LATENT bug, not an active one — and live again the moment a holdout
-- returns, which experiment.ts explicitly anticipates ("set this to 0.9 rather
-- than 0.5"). It is fixed now because a tripwire nobody has reason to look at is
-- how the last three of these survived.
--
-- NOTHING IS DELETED AND NOTHING IS REWRITTEN.
-- ─────────────────────────────────────────────────────────────────────────────


-- ── The version cannot mark this boundary; a timestamp has to ────────────────
--
-- 019 and 020 could each say "rows of version X are wrong", because the version
-- was written once at insert. That instrument does not reach this bug:
-- re-analysis stamps whatever version was CURRENT AT THE TIME, so a row
-- re-analysed under 1.0.0 still reads 1.0.0 and is indistinguishable from a row
-- never re-analysed. Every session in the table is 1.0.0 today, and there is no
-- way to tell which of them have been through re-analysis at all.
--
-- So the marker is the fact itself. Null means "not since this column existed",
-- which is honestly weaker than "never" and must not be read as the latter.
alter table public.sessions
  add column if not exists reanalyzed_at timestamptz;

comment on column public.sessions.reanalyzed_at is
  'When this session was last re-analysed from an edited transcript (ADR 0011). '
  'NULL means not since this column existed (migration 021) — NOT that it never '
  'happened: re-analysis before 021 left no trace, because it stamps whatever '
  'pipeline_version was current rather than a version of its own. Set on both '
  'the successful and the declined re-analysis paths.';


-- ── Make the affected columns impossible to read innocently ──────────────────
--
-- Restated in full rather than appended to, because `comment on` replaces.
-- The 1.0.0 caveats from 019 are carried forward verbatim; they still hold.

comment on column public.sessions.grounding is
  $$Why the cue was or was not grounded.
    grounded    - records were SELECTED for injection
    withheld    - records WERE available but the experiment assigned this session
                  to the control arm; the counterfactual for 'grounded'
    no_position - the free-text position never resolved to a canonical id
                  (usually the side was unknown, or it was a submission).
                  Fix: taxonomy or extraction.
    no_records  - the id resolved but the corpus has nothing. Fix: mine that position.
    declined    - the take had nothing coachable in it (#44); no cue was written.

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

comment on column public.sessions.grounding_records is
  $$How many records were selected for injection. 0 unless grounding =
    'grounded'. On pipeline_version 1.0.0, selected but NOT injected — see
    grounding_reached_model(). On a row re-analysed before 1.3.0, a count from
    the superseded run (migration 021).$$;

comment on column public.sessions.grounding_available is
  'How many matched the mistake and COULD have been injected. Equal to '
  'grounding_records in the grounded arm; the same population in the withheld '
  'arm, which is what makes the two comparable — over 1.1.0+ rows only. On a '
  'row re-analysed before 1.3.0, measured against the superseded extraction '
  '(migration 021).';

comment on column public.sessions.grounding_record_ids is
  $$The coaching_records selected for the coaching prompt, in rank order. NULL
    for sessions from before this column existed, and empty for ungrounded
    arms — the two are different and must not be conflated: NULL means unknown,
    {} means we know nothing was selected.

    CAVEAT (migration 019). On pipeline_version 1.0.0 these were selected but
    never reached the model.

    CAVEAT (migration 021). On a row re-analysed before 1.3.0 these are the
    records that grounded the PREVIOUS cue. 018's record_feedback_signal joins
    user feedback onto this column, so a rating of the current cue lands on
    them. Unlike the 1.0.0 case this cannot be gated on pipeline_version —
    re-analysis rewrites the stamp — which is why reanalyzed_at exists.$$;
