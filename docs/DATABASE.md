# Database

## Platform: Supabase (Postgres)

## Tables

| Table       | Purpose                                          | RLS     |
| ----------- | ------------------------------------------------ | ------- |
| profiles    | Extends auth.users, stores sport and skill level | Enabled |
| sessions    | Core session entity with full pipeline output    | Enabled |
| user_trends | Computed trends, updated after each session      | Enabled |
| cue_images  | Shared cue→image catalog, reused across users    | Enabled |

## Multi-Sport Design

`sport_key` field on both `sessions` and `user_trends` enables per-sport trend
tracking. A user with both BJJ and golf sessions gets separate trend lines per
sport.

## Migration Rules

- NEVER modify existing migration files
- ALWAYS create a new numbered migration: `{number}_{description}.sql`
- ALWAYS update this document when schema changes

Migrations: `001_initial_schema.sql` (base schema), `002_auto_create_profile.sql`
(profile auto-create trigger + backfill), `003_feedback_reason.sql`
(`sessions.feedback_reason`), `004_onboarding_complete.sql`
(`profiles.onboarding_complete` — gates first-run onboarding; existing users
backfilled to `true`), `005_launch_hardening.sql` (`sessions.client_session_id`
idempotency key + `client_events`), `006_cue_image_catalog.sql` (shared
`cue_images` catalog + `cue-images` storage bucket + `sessions.cue_image_key`
pointer; see ADR 0012).

## Key Design Decisions

- `pipeline_version` on sessions: enables re-processing with improved pipeline
- `quality_gate_passed` stored: dashboard can filter to high-confidence outputs only
- `thumbs_up` field: binary user feedback, feeds quality monitoring pipeline
- Audio stored in Supabase Storage (bucket `session-audio`), path referenced in
  the sessions table
- `cue_images` is deliberately NOT user-scoped: RLS allows read by any
  authenticated user and writes only via the service role, so one generated
  image is reused across users. `sessions.cue_image_key` points into it
  (nullable, no FK — the image stage is best-effort). See ADR 0012.

## Indexes

- `sessions(user_id, session_date DESC)` — log screen query
- `sessions(user_id, key_mistake)` — trend computation
- `sessions(sport_key)` — sport filtering

## Row ↔ Domain Mapping

The DB uses `snake_case` columns; the app speaks `camelCase` domain types
(`src/types/session.ts`). All mapping is isolated in
`SupabaseStorageProvider.ts` so nothing else in the app deals with column names.

## Edge Functions

- `process-session` (BUILT) — runs the full pipeline server-side and inserts the
  `sessions` row using the caller's JWT (RLS-scoped). Writes audio reads from the
  `session-audio` Storage bucket. Also serves **re-analysis**: given a
  `reanalyzeSessionId` + `editedTranscript`, it re-runs the AI stages on the
  edited text and UPDATEs that row in place (no new session; see ADR 0011).
  See `supabase/functions/README.md`.

## Planned (not yet built)

- `compute-trends` edge function to recompute `user_trends` after each session
  insert (currently `user_trends` is written by no automated job yet).
- Storage bucket `session-audio` with per-user RLS policies (create on setup).
