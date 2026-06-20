-- ============================================================================
-- Flowlog — initial schema (migration 001)
-- Tables: profiles, sessions, user_trends. RLS enabled on all.
-- Multi-sport from day one: sport_key on sessions and user_trends.
-- NEVER edit this file after it ships — create a new numbered migration.
-- ============================================================================

-- Profiles (extends Supabase auth.users)
create table public.profiles (
  id uuid references auth.users primary key,
  display_name text,
  active_sport text default 'bjj',
  skill_level text,                   -- belt for BJJ, handicap tier for golf etc
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Sessions (core entity)
create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles not null,
  sport_key text not null default 'bjj',
  session_date timestamptz not null,
  audio_storage_path text,
  raw_transcript text,
  positions_visited text[],
  key_mistake text,
  opponent_action text,
  sentiment text,
  coaching_cue text,
  target_position text,
  quality_gate_passed boolean default false,
  thumbs_up boolean,
  pipeline_version text,
  created_at timestamptz default now()
);

-- Trends (computed after each session)
create table public.user_trends (
  user_id uuid references public.profiles primary key,
  sport_key text not null default 'bjj',
  dominant_weakness text,
  positions_struggled jsonb default '{}',
  session_count integer default 0,
  streak_days integer default 0,
  last_session_at timestamptz,
  updated_at timestamptz default now()
);

-- Enable RLS
alter table public.profiles enable row level security;
alter table public.sessions enable row level security;
alter table public.user_trends enable row level security;

-- RLS policies
create policy "Users own their profile"
  on public.profiles for all using (auth.uid() = id);

create policy "Users own their sessions"
  on public.sessions for all using (auth.uid() = user_id);

create policy "Users own their trends"
  on public.user_trends for all using (auth.uid() = user_id);

-- Indexes
create index sessions_user_date on public.sessions(user_id, session_date desc);
create index sessions_user_mistake on public.sessions(user_id, key_mistake);
create index sessions_sport on public.sessions(sport_key);
