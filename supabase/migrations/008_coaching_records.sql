-- Coaching records: the serving store for grounded cues (wayfinder #30, #37/#54).
--
-- Distilled mechanics used to ground a coaching cue. Deliberately carries NO
-- link to the material it was derived from — no instructor, no title, no
-- volume, no timestamp, and no verbatim quote. The full records, with their
-- provenance, live only on the authoring machine and are never uploaded.
--
-- These are a STARTING POINT intended to be refined and certified by expert
-- reviewers, not a reproduction of anyone's system.
create table if not exists public.coaching_records (
  -- Opaque. Deliberately not derived from anything about the source: an id
  -- like "gff-guard-retention-v8-0429" would itself be a citation.
  id uuid primary key default gen_random_uuid(),
  sport_key text not null default 'bjj',

  -- Canonical position id from the sport taxonomy, e.g. 'half-guard-bottom'.
  -- Perspective is part of the identity: advice for the player underneath is
  -- wrong for the player on top.
  position text not null,

  -- What to do, or not do. Instructors phrase mistakes as prohibitions, so the
  -- mistake is the negative half of this — there is deliberately no separate
  -- "mistake" column.
  prescription text not null,
  -- Why it works, or why the alternative fails. The field that carries depth
  -- rather than mere specificity; do not treat it as optional.
  why text,
  detail text,
  counter text,

  -- Conditions under which the prescription holds. Without these, records for
  -- the same position appear to contradict each other when they were simply
  -- describing different circumstances.
  gi text not null default 'either'
    check (gi in ('gi', 'no-gi', 'either')),
  level text not null default 'any'
    check (level in ('beginner', 'intermediate', 'advanced', 'any')),
  opponent text,

  -- Review gates. `certified` defaults false and is set only by human review.
  -- `contested` marks a record another record contradicts once preconditions
  -- are accounted for; a contested position should not ground a cue unaided.
  certified boolean not null default false,
  contested boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The lookup the pipeline actually performs: records for one position,
-- filtered by applicability.
create index if not exists coaching_records_position
  on public.coaching_records(sport_key, position);
create index if not exists coaching_records_position_gi
  on public.coaching_records(sport_key, position, gi);

alter table public.coaching_records enable row level security;

-- Deliberately NO policy for authenticated users. This is server-side
-- reference data read by the process-session function via the service role,
-- which bypasses RLS. Clients must never read it directly: it is derived from
-- third-party material and has no business reaching a device.
-- RLS enabled with no policy = no access for anon or authenticated.

comment on table public.coaching_records is
  'Distilled coaching mechanics used to ground cues. No link to source material by design; full provenance stays on the authoring machine. Server-side only — read via service role, never exposed to clients.';
