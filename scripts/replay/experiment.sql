-- Read out the grounded-cue experiment (wayfinder #30).
--
-- Only 'grounded' and 'withheld' are in the experiment: both had matching
-- records, and the arm decided whether they were used. The other outcomes are
-- excluded because both arms would have produced an identical cue.
select
  grounding                                             as arm,
  count(*)                                              as sessions,
  count(*) filter (where thumbs_up is not null)         as rated,
  count(*) filter (where thumbs_up)                     as thumbs_up,
  round(100.0 * count(*) filter (where thumbs_up)
        / nullif(count(*) filter (where thumbs_up is not null), 0), 1) as pct_up
from public.sessions
where sport_key = 'bjj'
  and grounding in ('grounded', 'withheld')
group by grounding
order by grounding;

-- The mining backlog: positions users hit that the corpus cannot serve.
select target_position_id, count(*) as sessions
from public.sessions
where grounding = 'no_records' and target_position_id is not null
group by 1 order by 2 desc limit 20;

-- Positions we could not identify at all — a taxonomy or extraction problem,
-- NOT a mining one. Kept separate because the two have opposite fixes.
select target_position, count(*) as sessions
from public.sessions
where grounding = 'no_position'
group by 1 order by 2 desc limit 20;
