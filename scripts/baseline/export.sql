-- Baseline export for wayfinder #32 (map #30).
-- Run in the Supabase dashboard SQL editor, then "Download JSON".
-- Read-only. Returns every field the pipeline produced for your own sessions,
-- plus the feedback signal, ordered oldest-first so the snapshot is stable.
--
-- Scoped to the signed-in dashboard user by default. To pin a specific user,
-- replace `auth.uid()` with that user's uuid.

select
  s.id,
  s.user_id,
  s.sport_key,
  s.session_date,
  s.created_at,
  s.raw_transcript,
  s.positions_visited,
  s.key_mistake,
  s.opponent_action,
  s.sentiment,
  s.coaching_cue,
  s.target_position,
  s.quality_gate_passed,
  s.pipeline_version,
  s.thumbs_up,
  s.feedback_reason,
  s.feedback_note,
  s.audio_storage_path,
  p.skill_level
from public.sessions s
left join public.profiles p on p.id = s.user_id
where s.user_id = auth.uid()
  and s.sport_key = 'bjj'
order by s.session_date asc, s.id asc;
