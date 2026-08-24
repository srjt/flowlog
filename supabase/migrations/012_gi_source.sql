-- Where a session's gi/no-gi value came from (#60).
--
-- The recording overrides a stale toggle on an explicit statement: someone who
-- last set the toggle weeks ago and says "no-gi class today" gets a no-gi
-- session. That is the right call — serving lapel-and-sleeve instructions to
-- someone in a rash guard is broken, while dropping the 27% of records that are
-- gi-specific is merely thinner.
--
-- But a silent override is a surprise, and a misfiring one would be invisible.
-- This column makes it countable:
--
--   select gi_source, count(*) from sessions group by gi_source;
--
-- 'toggle'     — the recorder's toggle stood (the ordinary case).
-- 'transcript' — the athlete stated the context and it beat the toggle.
-- 'none'       — no toggle, no statement. Grounding excludes gi-specific
--                records rather than gambling on which applies.
alter table public.sessions
  add column if not exists gi_source text
    check (gi_source in ('toggle', 'transcript', 'none'));

comment on column public.sessions.gi_source is
  'Provenance of sessions.gi (#60): toggle | transcript | none. Null on rows
   predating this column. Count transcript overrides here to catch misfires.';
