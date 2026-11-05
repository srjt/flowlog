-- ─────────────────────────────────────────────────────────────────────────────
-- Keep the side Extraction reported, on the Session (#130).
--
-- Extraction already decides which side of the position the athlete was on
-- (#48): 'top', 'bottom', or 'unknown' when the transcript never says. That
-- answer is what lets a free-text target like "half guard" resolve to
-- `half-guard-bottom` instead of to nothing, and until now it was thrown away
-- the moment the row was written.
--
-- Without it a Session's Grounding cannot be replayed. Side-dependent free text
-- ("De La Riva Guard", "half guard") resolves to no canonical position, so
-- Grounding finds nothing, and the cue review tool's rebuilt prompt arrives with
-- no Coaching records in it, for a Session the pipeline really grounded in 18.
-- The tool guesses the side back from the positions of the records the Session
-- was grounded in, then from `target_position_id`. Measured on production when
-- this was written, 8 of 35 grounded Sessions have neither, so for those the
-- rebuild is silently ungrounded.
--
-- ── NULL is "not recorded", and is said so up front ─────────────────────────
--
-- 018, 019, 020, 021 and 022 each had to repair, after the fact, a column whose
-- empty value could be read as a finding. This one states the rule on day one:
--
--   NULL       not recorded. Every Session written before this migration. It
--              is NEVER "Extraction could not tell", and must not be counted
--              as an abstention.
--   'unknown'  recorded: Extraction looked and could not tell. It abstains on
--              purpose rather than guessing a side, because a wrong side gives
--              confident coaching aimed at the other athlete. That is a
--              finding about the recording, not an absence of data.
--
-- So "how often does Extraction abstain" is `perspective = 'unknown'` over
-- `perspective is not null`, and never over the whole table.
--
-- ── Written on every path that writes an Extraction ─────────────────────────
--
-- The one-shot insert, the declined insert, the Re-analyze update and the
-- declined Re-analyze update. A declined Take has no Cue but still has an
-- Extraction, and its side is still what Extraction understood. Re-analysis
-- OVERWRITES the value: it regenerates the Extraction from an edited transcript
-- and the old side may no longer be true, the reasoning 021 applied to the
-- grounding provenance columns.
--
-- ── What this is NOT ─────────────────────────────────────────────────────────
--
--   * Not a backfill. A past Session's side can only be inferred, which the
--     review tool already does and labels as inferred. Writing a guess into a
--     column that reads as recorded truth is the failure this exists to end.
--   * Not a version boundary. `pipeline_version` is deliberately NOT bumped,
--     by 022's rule: the prompt, the records and the Cue are unchanged; one
--     extra value is written. A new column is self-describing, so there is
--     nothing to segment.
--   * Not shown to the athlete. Nothing in the app reads it.
--
-- Constrained to the three values Extraction emits, so nothing else can be
-- written. 'neutral' is deliberately absent: it is a property of a position
-- ("standing"), never of an Extraction, and both the client and the edge
-- function turn any other value into 'unknown' before it reaches this column.
--
-- Deletion: the column lives on the Session row, which the delete-account
-- function deletes with the account.
--
-- ORDER MATTERS ON DEPLOY. `process-session` writes this column on every
-- Session it inserts or re-analyses, so apply this migration BEFORE deploying
-- that function. The other order fails every write with PGRST204 (the
-- `feedback_reason` incident in docs/MIGRATIONS.md).
--
-- NOTHING IS DELETED AND NOTHING IS REWRITTEN.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.sessions
  add column if not exists perspective text
    check (perspective in ('top', 'bottom', 'unknown'));

comment on column public.sessions.perspective is
  $$Which side of the position the athlete was on, as Extraction reported it (#130).

    NULL means NOT RECORDED: the Session was written before migration 024. It is
    never "Extraction could not tell" and must not be counted as one. There is
    no backfill; the side of an older Session can only be inferred.

    top      the athlete was on top
    bottom   the athlete was underneath
    unknown  recorded: Extraction could not tell, and abstained rather than
             guess. A real finding about the recording, not missing data.

    Written on every path that writes an Extraction, a declined Take included.
    Re-analysis overwrites it with the side of the edited transcript, so it
    describes the Extraction the row holds now.$$;

notify pgrst, 'reload schema';
