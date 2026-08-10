-- ============================================================================
-- Add an optional free-text note for thumbs-down feedback on a cue — the
-- specific "what was wrong / how to improve" beyond the fixed reason category.
-- Backward compatible: existing rows get NULL. Kept distinct from
-- feedback_reason so the category and the free-text can be analysed separately.
-- ============================================================================

alter table public.sessions
  add column if not exists feedback_note text;
