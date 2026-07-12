-- ============================================================================
-- 005 — launch hardening: idempotent pipeline, client error events,
-- storage owner-delete. All additive and backward compatible with the
-- currently-shipped client (which sends no client_session_id).
-- ============================================================================

-- Idempotency key for process-session: the client generates one uuid per
-- accepted take and retries reuse it, so a timeout-then-retry can never
-- insert two sessions for one recording. Nullable so old rows and old
-- clients are unaffected; the partial unique index enforces at most one
-- session per (user, key) without touching null-keyed rows.
alter table public.sessions
  add column if not exists client_session_id uuid;

create unique index if not exists sessions_user_client_session
  on public.sessions (user_id, client_session_id)
  where client_session_id is not null;

-- Client-side error events: the app's logger fire-and-forgets error reports
-- here so production failures are visible without a crash-reporting SDK.
-- INSERT-only for authenticated users; no select policy (read via the
-- dashboard / service role only). No FK on user_id on purpose: inserts must
-- never fail on profile timing, and account-deletion ordering stays trivial.
create table if not exists public.client_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid default auth.uid(),
  level text not null default 'error',
  event text not null,
  detail text,
  created_at timestamptz not null default now()
);

alter table public.client_events enable row level security;

create policy "client events insert own"
  on public.client_events for insert to authenticated
  with check (auth.uid() = user_id);

-- Let owners delete their own audio objects (mirrors the existing
-- "own audio insert" / "own audio read" policies created per
-- supabase/SETUP.md step 4). Used by session deletion and account deletion.
-- If `db push` fails here with "must be owner of table objects", create this
-- identical policy via Dashboard -> Storage -> Policies instead (precedent:
-- the insert/read policies were created through the dashboard).
create policy "own audio delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'session-audio'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
