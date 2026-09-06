-- ─────────────────────────────────────────────────────────────────────────────
-- Which records grounded a cue, not just how many.
--
-- `sessions` already records the grounding ARM, the COUNT injected, and the
-- count available. That is enough to measure whether grounding helps, and not
-- enough to act when it does not: a thumbs-down on a grounded cue currently
-- says "six records were involved" and cannot say which six.
--
-- That gap is what makes review unaffordable. With 5,059 published records and
-- no reviewers, reading the corpus is not a plan. Reading the handful of
-- records that keep appearing behind cues real users disliked is an evening —
-- but only if the trail from cue back to record exists.
--
-- Stored as ids rather than a join table because the relationship is
-- write-once and read rarely: the pipeline knows the set at the moment it
-- builds the prompt, and nothing ever mutates it afterwards.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.sessions
  add column if not exists grounding_record_ids uuid[];

comment on column public.sessions.grounding_record_ids is
  'The coaching_records actually injected into the coaching prompt, in rank '
  'order. NULL for sessions from before this column existed, and empty for '
  'ungrounded arms — the two are different and must not be conflated: NULL '
  'means unknown, {} means we know nothing was injected.';

-- Records implicated in disliked cues, worst first.
--
-- The review queue this makes possible. Deliberately a view rather than a
-- materialised one: the underlying counts are small, and a stale answer about
-- what to review next is worse than a slow one.
create or replace view public.record_feedback_signal as
select
  r.id,
  r.position,
  r.prescription,
  count(*) filter (where s.thumbs_up is false) as thumbs_down,
  count(*) filter (where s.thumbs_up is true)  as thumbs_up,
  count(*)                                     as times_grounded,
  array_agg(distinct s.feedback_reason)
    filter (where s.feedback_reason is not null) as reasons
from public.sessions s
  cross join lateral unnest(s.grounding_record_ids) as gid
  join public.coaching_records r on r.id = gid
group by r.id, r.position, r.prescription;

comment on view public.record_feedback_signal is
  'Per-record user feedback, derived from which records grounded which cues. '
  'A record with several thumbs-down and no thumbs-up is a review candidate — '
  'this is what replaces reading the whole corpus.';
