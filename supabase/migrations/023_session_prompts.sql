-- ─────────────────────────────────────────────────────────────────────────────
-- What the coaching model actually received (#121).
--
-- A Cue's prompt cannot be rebuilt after the fact. `generateCoaching` fills it
-- from inputs `sessions` never stored — skill level, recent mistakes, dominant
-- weakness, whether the quality gate retried, which provider answered — and
-- from coaching record text that publishing upserts in place. A reconstruction
-- presents today's values as history, which is the failure 019, 020, 021 and
-- 022 each had to repair. So the prompt is kept exactly as sent.
--
-- ── A table of its own, not a column on sessions ────────────────────────────
--
-- Clients read their own sessions with `select *` (RLS "Users own their
-- sessions"). A prompt column would ship the injected coaching record text to
-- the athlete's device with every session list — exactly what 008 and 009
-- exist to prevent. So, as in 009, the grants are revoked outright: service
-- role only, by construction rather than by the continued absence of a policy.
--
-- ── One row per attempt, grouped by run ──────────────────────────────────────
--
-- The Cue on a row comes from the first attempt, from a strict retry, or from
-- no attempt at all (the quality gate's fallback). Re-analysis (ADR 0011) runs
-- the whole thing again on the same session and overwrites its Cue, so the
-- LATEST run is the one that describes the row; earlier runs stay as history.
-- `produced_cue` marks the attempt whose Cue was kept. On a fallback every
-- attempt reads false, which is the truth.
--
-- Additive. Sessions from before this migration have no rows: absence means
-- "not recorded", never "no prompt". `pipeline_version` is deliberately NOT
-- bumped, by 022's rule — the prompt, the records and the Cue are unchanged;
-- only a record of them is written.
--
-- Deletion: the delete-account function deletes the user's sessions, and the
-- cascade below removes their prompts with them.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.session_prompts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null
    references public.sessions(id) on delete cascade,
  -- The attempts one pipeline run wrote together.
  run_id uuid not null,
  run text not null check (run in ('insert', 'reanalysis')),
  attempt smallint not null check (attempt >= 1),
  strict boolean not null,
  produced_cue boolean not null,
  provider text not null,
  model text not null,
  prompt text not null,
  created_at timestamptz not null default now(),
  unique (run_id, attempt)
);

create index if not exists session_prompts_session
  on public.session_prompts(session_id, created_at desc);

alter table public.session_prompts enable row level security;
revoke all on public.session_prompts from anon, authenticated;

comment on table public.session_prompts is
  'The coaching prompt exactly as sent to the model, one row per attempt (#121). '
  'Service-role only — grants revoked from anon/authenticated, because the prompt '
  'carries injected coaching record text (see 008/009). No rows for sessions '
  'generated before migration 023: absence means not recorded.';

comment on column public.session_prompts.run_id is
  'Groups the attempts of one pipeline run. Re-analysis adds a run to the same '
  'session; the latest run is the one that produced the Cue the session holds.';

comment on column public.session_prompts.produced_cue is
  'True for the attempt whose Cue the quality gate kept. False on every attempt '
  'when the gate fell back to its safe Cue — no prompt produced that Cue.';

comment on column public.session_prompts.prompt is
  'Exactly the text sent, strict-retry suffix included. Not rebuilt: record text '
  'can be edited after publishing, and several inputs are never stored elsewhere.';
