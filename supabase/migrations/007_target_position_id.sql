-- Canonical target position id (issue #48, taxonomy from #47).
--
-- `target_position` is a free-text label from the coaching stage and stays as
-- the display string. This column holds the CANONICAL id — e.g.
-- 'side-control-bottom' — which is the stable key that mined instructional
-- records and any later grounding lookup join on.
--
-- Nullable on purpose, and null is the common case rather than an error: it
-- means the position or the side could not be determined, and callers must
-- abstain rather than fall back to matching on the free-text label. Existing
-- rows keep null and continue to load and display normally.
alter table public.sessions
  add column if not exists target_position_id text;

comment on column public.sessions.target_position_id is
  'Canonical position id (e.g. side-control-bottom). Null when the position or the side is undetermined — callers abstain rather than guess.';
