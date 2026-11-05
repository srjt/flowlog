# Database

## Platform: Supabase (Postgres)

## Tables

| Table       | Purpose                                          | RLS     |
| ----------- | ------------------------------------------------ | ------- |
| profiles    | Extends auth.users, stores sport and skill level | Enabled |
| sessions    | Core session entity with full pipeline output    | Enabled |
| user_trends | Computed trends, updated after each session      | Enabled |
| session_prompts | The coaching prompt exactly as sent, one row per attempt (#121, migration 023). Service role only: grants revoked, because it carries coaching record text | Enabled, no client grants |

## Multi-Sport Design

`sport_key` field on both `sessions` and `user_trends` enables per-sport trend
tracking. A user with both BJJ and golf sessions gets separate trend lines per
sport.

## Migration Rules

- NEVER modify existing migration files
- ALWAYS create a new numbered migration: `{number}_{description}.sql`
- ALWAYS update this document when schema changes
- ALWAYS apply migrations with `supabase db push` (updates history AND reloads
  the PostgREST cache) — NEVER by pasting SQL into the dashboard, which drifts
  the schema from the migration history. See **[`MIGRATIONS.md`](./MIGRATIONS.md)**
  for the sync/recovery runbook.

Migrations: `001_initial_schema.sql` (base schema), `002_auto_create_profile.sql`
(profile auto-create trigger + backfill), `003_feedback_reason.sql`
(`sessions.feedback_reason`), `004_onboarding_complete.sql`
(`profiles.onboarding_complete` — gates first-run onboarding; existing users
backfilled to `true`), `005_launch_hardening.sql` (`sessions.client_session_id`
+ idempotency index, `client_events` table + RLS, own-audio delete policy),
`006_feedback_note.sql` (`sessions.feedback_note`), `007_target_position_id.sql` (`sessions.target_position_id` — the canonical
position id from the BJJ taxonomy; nullable, and null is the normal case when
the position or the side could not be determined).

## Key Design Decisions

- `pipeline_version` on sessions: enables re-processing with improved pipeline.
  It is also the **behaviour boundary** for the grounding columns. Pipeline
  `1.0.0` recorded `grounding = 'grounded'` while sending the literal
  `{{GROUNDING}}` to the model, so over those rows the grounding columns
  describe what was *selected*, never what the model *saw*, and the
  grounded/withheld arms are the same condition. `1.1.0` is the first version
  that actually injects. Gate every read on
  `public.grounding_reached_model(pipeline_version)` (migration 019) rather
  than re-typing the version — `record_feedback_signal` and
  `grounding_experiment` already do.
- `perspective` on sessions (migration 024, #130): which side of the position
  the athlete was on, as Extraction reported it. One of `top`, `bottom` or
  `unknown`, enforced by a CHECK constraint. **NULL means not recorded** (a
  Session written before 024) and is never read as "Extraction could not
  tell"; that is `unknown`, a recorded abstention. So an abstention rate is
  `perspective = 'unknown'` over `perspective is not null`, never over the
  whole table. Written on every path that writes an Extraction (the insert,
  the declined insert, Re-analyze and the declined Re-analyze), and
  overwritten by Re-analyze, so it describes the Extraction the row holds now.
  Not backfilled, and `pipeline_version` was not bumped for it. It is what
  lets a Session's Grounding be replayed: side-dependent free text ("half
  guard") resolves to no canonical position without it. The cue review tool
  (`docs/ADMIN.md`) reads it first and infers a side only for older Sessions.
  `process-session` writes it on every Session, so apply 024 before deploying
  that function.
- The cue force-diagram columns on sessions (migration 026, #135):
  `diagram_spec` (jsonb, the validated spec), `diagram_outcome` (why there is
  or is not one: `spec`, `no_base`, `not_attempted`, `empty`, `invalid` or
  `unavailable`, enforced by a CHECK that a test holds equal to
  `DIAGRAM_OUTCOMES` in `src/visualization/diagramStage.ts`), and the
  provenance `grammar_version`, `base_library_version` and
  `spec_prompt_version`, stored beside the spec rather than inside it so it
  stays re-renderable. **NULL means not recorded** (a Session written before
  026), never "no diagram", so a coverage rate is `diagram_outcome = 'spec'`
  over `diagram_outcome is not null`. A spec is present exactly when the
  outcome is `spec`; `base_library_version` is set whenever the library was
  consulted (every outcome but `not_attempted`); the grammar and prompt
  versions only when a prompt was built. All five are written together on
  every Session write (the insert, the declined insert as `not_attempted`,
  Re-analyze, which regenerates them, and the declined Re-analyze, which clears
  them to `not_attempted`). Until phase c the base library is empty, so every
  coachable Session reads `no_base`; grouped by `target_position_id`, those
  rows are the base-authoring backlog, as `no_records` is for mining.
  `pipeline_version` was not bumped. `process-session` writes these columns on
  every Session, so apply 026 (and 024) before deploying that function.
- `quality_gate_passed` stored: dashboard can filter to high-confidence outputs only
- `thumbs_up` field: binary user feedback, feeds quality monitoring pipeline
- Audio stored in Supabase Storage (bucket `session-audio`), path referenced in
  the sessions table

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
