-- ============================================================================
-- Add a nullable reason for thumbs-down feedback on a session's coaching cue.
-- Backward compatible: existing rows get NULL.
-- ============================================================================

alter table public.sessions
  add column if not exists feedback_reason text;
