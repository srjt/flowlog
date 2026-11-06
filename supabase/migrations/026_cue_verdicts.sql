-- ─────────────────────────────────────────────────────────────────────────────
-- The operator's verdict on a Cue, from the cue review tool (#132).
--
-- The review tool (docs/ADMIN.md) shows an operator everything behind a Cue:
-- the transcript, the Extraction, the Coaching records that grounded it and the
-- prompt the model received. Until now the conclusion had nowhere to go. This
-- table keeps it, so patterns across Cues can be counted and the records that
-- keep sitting behind wrong Cues can be found.
--
-- ── Numbering ────────────────────────────────────────────────────────────────
--
-- 026 in merge order: 024 is #130 (PR #142) and 025 is #135 phase b (PR #149).
-- Apply it AFTER 024 and 025. `supabase db push` refuses a migration whose
-- number sorts below one already applied, so if this merges before either of
-- them, whichever merges later renumbers (docs/ROADMAP.md). Nothing here
-- depends on their schema; only the order of application matters.
--
-- ── A table of its own, service role only ───────────────────────────────────
--
-- Locked down as 023 locks down `session_prompts`: RLS on, every grant revoked
-- from anon and authenticated, and no policy. Only the local review tool writes
-- it, with the service role key that never leaves that machine. Nothing in the
-- app reads it, and the athlete never sees it.
--
-- ── A verdict judges a Cue, not a Session ───────────────────────────────────
--
-- Re-analysis (ADR 0011) replaces a Session's Cue in place. A verdict naming
-- only the Session would, after a correction, appear to judge text the operator
-- never read: the corruption 021 repaired for the grounding columns, arriving
-- through a new door. So `cue` is a NOT NULL snapshot of the exact text judged,
-- and identity is one verdict per (Session, judged Cue text). Changing a
-- verdict upserts on that identity. When `cue` no longer equals the Session's
-- `coaching_cue`, the verdict is about an earlier Cue, and the tool says so
-- instead of showing it as a judgement of the current one.
--
-- `run_id` is the prompt log's handle (023) on the run behind the judged Cue.
-- It is NULL for Sessions that predate the prompt log. It is a pointer, not the
-- identity: `cue` is.
--
-- ── The records behind the Cue are snapshotted too ──────────────────────────
--
-- `record_ids` copies the Session's `grounding_record_ids` when the verdict is
-- recorded, so per-record aggregation is a function of verdicts alone and stays
-- right after a Re-analyze rewrites the Session's ids.
--
-- They are copied only when the tool's record trail vouches for them, which it
-- records in `record_trail` at the same moment. A trail that is `not_recorded`
-- (018), `never_reached_model` (019) or `unverified` (021) does not say which
-- records produced this Cue, and copying its ids would charge a wrong Cue to
-- records that were never behind it. Those verdicts keep `record_ids = '{}'`,
-- and `record_trail` says why. Per 018, an empty list is read as "no records
-- went in" only when the trail says so (`none_selected`), never otherwise.
--
-- ── What a verdict is, and is not ───────────────────────────────────────────
--
--   * No row means UNJUDGED. There is no "fine by default": a Cue nobody has
--     judged has no row, and must never be counted as sound.
--   * Never averaged with athlete feedback. `thumbs_up` / `feedback_*` on the
--     Session are the athlete's claim, from a vantage point that cannot see the
--     records. This is the operator's. They are different evidence and stay in
--     different places; nothing here feeds `record_feedback_signal` (018).
--   * An observation, not a gate. Nothing in Grounding, the quality gate or the
--     certification queue reads it. Feeding verdicts into the certification
--     queue's order (#132 story 12) is a deliberate follow-up.
--   * Not the record votes (014). Those are reviewers judging a record, settled
--     by two agreeing reviewers. This is one operator judging an output.
--
-- The verdict labels are the three of the frozen #36 baseline
-- (`cue-verdicts.json`), so the two stay comparable.
--
-- Deletion: the delete-account function deletes the user's sessions, and the
-- cascade below removes their verdicts with them.
--
-- Additive. NOTHING IS DELETED AND NOTHING IS REWRITTEN.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.cue_verdicts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null
    references public.sessions(id) on delete cascade,
  -- The prompt-log run behind the judged Cue; NULL before 023.
  run_id uuid,
  -- The exact Cue text judged.
  cue text not null,
  -- The identity's key. md5 keeps the unique index small; it is not security.
  cue_md5 text generated always as (md5(cue)) stored,
  verdict text not null
    check (verdict in ('sound', 'shallow', 'wrong')),
  reason text
    check (reason in (
      'transcript_misheard',
      'extraction_wrong',
      'records_wrong',
      'records_misapplied',
      'off_target',
      'model_wrong'
    )),
  note text,
  record_ids uuid[] not null default '{}',
  record_trail text not null
    check (record_trail in (
      'trusted',
      'none_selected',
      'not_recorded',
      'never_reached_model',
      'unverified'
    )),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A reason says why a Cue is wrong, so it is required then and only then.
  constraint cue_verdicts_reason_iff_wrong
    check ((verdict = 'wrong') = (reason is not null)),
  -- Ids are copied only when the trail vouches for them (see above).
  constraint cue_verdicts_records_iff_trusted
    check ((record_trail = 'trusted') = (cardinality(record_ids) > 0)),
  -- One verdict per Session and judged Cue text.
  constraint cue_verdicts_one_per_cue unique (session_id, cue_md5)
);

alter table public.cue_verdicts enable row level security;
revoke all on public.cue_verdicts from anon, authenticated;

comment on table public.cue_verdicts is
  $$The operator's verdict on a Cue, recorded in the local cue review tool (#132).

    No row means UNJUDGED, never "fine". Service role only: grants revoked from
    anon and authenticated, no policy. Never averaged with the athlete's
    thumbs_up / feedback_* and never fed into record_feedback_signal: they are
    different evidence. An observation, not a gate: nothing in Grounding, the
    quality gate or the certification queue reads it.$$;

comment on column public.cue_verdicts.cue is
  $$The exact Cue text judged. Re-analysis replaces a Session's Cue in place, so
    a verdict naming only the Session would come to judge text the operator never
    read. When this no longer equals sessions.coaching_cue, the verdict is about
    an earlier Cue and must not be read as judging the current one.$$;

comment on column public.cue_verdicts.run_id is
  $$The session_prompts run (023) behind the judged Cue. NULL for Sessions that
    predate the prompt log. A pointer, not the identity; the identity is
    (session_id, cue).$$;

comment on column public.cue_verdicts.reason is
  $$Why the Cue is wrong; required when verdict = 'wrong', NULL otherwise.

    transcript_misheard  the transcript was misheard (vocabulary priming, upstream)
    extraction_wrong     the wrong mistake, position or side was extracted
    records_wrong        an injected record is itself wrong
    records_misapplied   the records were right and the model misused them
    off_target           sound jiu-jitsu aimed at the wrong problem
    model_wrong          no relevant records, and the model's own jiu-jitsu was wrong$$;

comment on column public.cue_verdicts.record_ids is
  $$The records injected behind the judged Cue, copied from
    sessions.grounding_record_ids when the verdict was recorded, so that
    per-record aggregation survives a Re-analyze. Copied only when record_trail is
    'trusted'; otherwise empty, and record_trail says whether that means "none"
    (none_selected) or "not known".$$;

comment on column public.cue_verdicts.record_trail is
  $$What the review tool's record trail said about the Session's
    grounding_record_ids when the verdict was recorded (docs/ADMIN.md). Only
    'trusted' ids are copied into record_ids.$$;

notify pgrst, 'reload schema';
