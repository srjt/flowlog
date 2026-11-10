-- ─────────────────────────────────────────────────────────────────────────────
-- The AI second opinion on a Cue, and the operator's better Cue.
--
-- Both serve one question (docs/ROADMAP.md): "I trust the cues it gives me."
-- The operator's verdicts (026) answer it today, one Cue at a time. This adds
-- two things beside them, and changes nothing either of them already holds.
--
-- ── Numbering ────────────────────────────────────────────────────────────────
--
-- 027 in merge order, after 026 (#132). Apply it AFTER 026. Draft PR #154 held
-- 027 while parked; it renumbers to 028 on its own branch, per the merge-order
-- rule in docs/ROADMAP.md.
--
-- ── 1. cue_verdicts.better_cue ──────────────────────────────────────────────
--
-- What the Cue should have said, in the operator's own words, optional, on a
-- shallow or wrong verdict only. Paired with the Cue it replaces, each one is a
-- preference pair: the seed of any later evaluation set, and the only training
-- data worth having if Flowlog ever tunes its own model. A sound Cue needs no
-- replacement, so the check forbids one there.
--
-- A better Cue is a Cue, so the 25-word hard cap applies. Word counting lives
-- in the review tool (scripts/admin/review.ts, `CUE_WORD_CAP`); the database
-- holds a character bound only, as 026 does for the note.
--
-- ── 2. cue_ai_opinions ──────────────────────────────────────────────────────
--
-- The cue judge (scripts/judge, #61) run over live Cues by `scripts/judge/
-- opine.sh` on the operator's machine. One row is one judge's opinion on one
-- exact Cue text: the per-claim checks, whether the Cue is defective, and
-- whether records backed the check (grounded) or not (ungrounded).
--
-- The judge FAILED its validation (scripts/judge/VALIDATION.md): it caught
-- 13/17 wrong Cues but condemned 4/11 sound ones, against a bar of at most
-- 2/11. So an opinion is a second opinion and nothing more:
--
--   * Blind first. The review tool shows an opinion only after the operator
--     has recorded a verdict on the same Cue, so the operator is never
--     anchored by it. The rule is enforced by the server, which does not send
--     an unrevealed opinion to the page.
--   * Never a verdict. Nothing here is written to cue_verdicts, counted in the
--     trust target, or read by the app, Grounding, the quality gate or the
--     certification queue.
--   * Earning trust in the open. The Cue trust page compares opinions with the
--     operator's verdicts over every Cue both have judged, against the same bar
--     the judge failed. Clearing it would justify a separate decision; it
--     switches nothing on.
--
-- Identity is (Session, judged Cue text, judge model, judge version), so a
-- Re-analyze (ADR 0011) gets a fresh opinion rather than inheriting one about
-- text it replaced, and a changed judge is a different instrument whose
-- readings are kept apart from the old one's.
--
-- Locked down as 023 and 026 are: RLS on, every grant revoked from anon and
-- authenticated, and no policy. Only the operator's machine reads or writes it,
-- with the service role key that never leaves that machine.
--
-- Deletion: the delete-account function deletes the user's sessions, and the
-- cascade below removes their opinions with them.
--
-- Additive. NOTHING IS DELETED AND NOTHING IS REWRITTEN.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.cue_verdicts
  add column if not exists better_cue text;

alter table public.cue_verdicts
  drop constraint if exists cue_verdicts_better_cue_not_sound;
alter table public.cue_verdicts
  add constraint cue_verdicts_better_cue_not_sound
    check (better_cue is null or verdict in ('shallow', 'wrong'));

alter table public.cue_verdicts
  drop constraint if exists cue_verdicts_better_cue_length;
alter table public.cue_verdicts
  add constraint cue_verdicts_better_cue_length
    check (better_cue is null or char_length(better_cue) between 1 and 300);

comment on column public.cue_verdicts.better_cue is
  $$What the Cue should have said, in the operator's words. Optional, and only
    on a shallow or wrong verdict. Capped at 25 words by the review tool, like
    any Cue. With `cue`, a preference pair.$$;

create table if not exists public.cue_ai_opinions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null
    references public.sessions(id) on delete cascade,
  -- The exact Cue text judged.
  cue text not null,
  -- The identity's key. md5 keeps the unique index small; it is not security.
  cue_md5 text generated always as (md5(cue)) stored,
  -- The judge's call.
  defective boolean not null,
  -- Whether records backed the check. Ungrounded calls are where the judge's
  -- false alarms came from (VALIDATION.md), so the trust page splits on it.
  mode text not null
    check (mode in ('grounded', 'ungrounded')),
  records_available integer not null default 0
    check (records_available >= 0),
  -- [{ claim, status, reason }], status one of supported / contradicted /
  -- off_target / unsupported.
  claims jsonb not null default '[]'
    check (jsonb_typeof(claims) = 'array'),
  rationale text not null default '',
  judge_model text not null,
  judge_version text not null,
  created_at timestamptz not null default now(),
  -- One opinion per Session, judged Cue text and judge.
  constraint cue_ai_opinions_one_per_judge
    unique (session_id, cue_md5, judge_model, judge_version)
);

alter table public.cue_ai_opinions enable row level security;
revoke all on public.cue_ai_opinions from anon, authenticated;

comment on table public.cue_ai_opinions is
  $$The cue judge's opinion on a Cue (scripts/judge/opine.sh): a second opinion,
    never a verdict. Blind first: the review tool reveals it only after the
    operator has judged the same Cue. Never written to cue_verdicts, never
    counted in the trust target, and never read by the app, Grounding, the
    quality gate or the certification queue. Service role only: grants revoked
    from anon and authenticated, no policy.$$;

comment on column public.cue_ai_opinions.cue is
  $$The exact Cue text judged. When this no longer equals sessions.coaching_cue,
    the opinion is about an earlier Cue and is not shown against the current one.$$;

comment on column public.cue_ai_opinions.judge_version is
  $$The judge's prompts and decision rule (JUDGE_VERSION in scripts/judge). A new
    version is a new instrument; its agreement is measured apart from the old one's.$$;

notify pgrst, 'reload schema';
