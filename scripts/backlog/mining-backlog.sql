-- The mining backlog (#58).
--
-- Turns grounding outcomes into a ranked list of what to mine next, driven by
-- live traffic rather than guesswork. The corpus was originally chosen from one
-- person's sessions; once testers arrive this is what says which positions
-- actually matter.
--
-- Run in the Supabase SQL editor.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. THE BACKLOG — positions worth mining, most-wanted first.
--
-- Only `no_records` WITH `grounding_candidates = 0` is a mining problem. A
-- session where records existed and were filtered out by gi context or the
-- relevance gate is NOT a corpus gap, and mining more would not change it.
-- Rows predating that column (null) are excluded rather than guessed at.
-- ─────────────────────────────────────────────────────────────────────────────
select
  target_position_id                             as position,
  count(*)                                       as sessions_wanting_it,
  count(distinct user_id)                        as users_affected,
  min(created_at)::date                          as first_seen,
  max(created_at)::date                          as last_seen
from public.sessions
where grounding = 'no_records'
  and grounding_candidates = 0
  and target_position_id is not null
group by target_position_id
order by sessions_wanting_it desc, users_affected desc;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. NOT A MINING PROBLEM — records existed, nothing survived the filters.
--
-- These need a look at the gi filter (#60) or the relevance gate (#57), not
-- more corpus. If a position appears here repeatedly, the gate may be too
-- strict for it.
-- ─────────────────────────────────────────────────────────────────────────────
select
  target_position_id      as position,
  count(*)                as sessions,
  max(grounding_candidates) as most_records_available,
  count(*) filter (where gi = 'no-gi') as of_which_no_gi
from public.sessions
where grounding = 'no_records'
  and grounding_candidates > 0
group by target_position_id
order by sessions desc;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. TAXONOMY GAPS — the position never resolved to a canonical id.
--
-- A DIFFERENT problem with a DIFFERENT fix: extraction or the taxonomy, not
-- mining. Adding "Octopus Guard" to the taxonomy would only move these rows to
-- `no_records`, so fixing this without also mining buys nothing on its own.
--
-- When grounding is `no_position`, NOTHING in positions_visited resolved, so
-- the array is exactly the set of free-text positions that failed.
-- ─────────────────────────────────────────────────────────────────────────────
select
  lower(trim(pos))        as unresolved_position,
  count(*)                as times_seen,
  count(distinct user_id) as users_affected
from public.sessions,
     unnest(positions_visited) as pos
where grounding = 'no_position'
group by lower(trim(pos))
order by times_seen desc;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. HEALTH — the split across every outcome.
--
-- `declined` is not a grounding failure: there was nothing coachable in the
-- recording, so grounding never ran. Counting it as a gap would inflate the
-- backlog with sessions that had no content to ground.
-- ─────────────────────────────────────────────────────────────────────────────
select
  coalesce(grounding, 'not recorded')  as outcome,
  count(*)                             as sessions,
  round(100.0 * count(*) / sum(count(*)) over (), 1) as pct,
  round(avg(grounding_records) filter (where grounding = 'grounded'), 1)
                                       as avg_records_injected
from public.sessions
group by grounding
order by sessions desc;
