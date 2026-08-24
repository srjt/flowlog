-- Human certification of coaching records (#77).
--
-- #42 settled on "mine broad, certify narrow". The broad half ran and produced
-- 1,322 records; the narrow half had never started, and `certified` /
-- `contested` were being read by the pipeline and then ignored by ranking.
-- This adds the votes behind those flags.

-- ─────────────────────────────────────────────────────────────────────────────
-- Reviewers. Invite-only: a row here is what makes an auth user a reviewer,
-- so access is granted by inserting and revoked by setting active = false
-- rather than by deleting an account.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.reviewers (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  -- Recorded because whose judgement it is matters when reading disagreement.
  credential text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Votes. One per reviewer per record; changing your mind updates in place
-- rather than stacking a second opinion from the same person.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.record_votes (
  -- uuid, not text: the SERVING store uses opaque uuids. The slug-shaped ids
  -- ("…-v3-0144") belong to the local review store, and publish.ts maps between
  -- them — that mapping is what keeps certification alive across a re-mine.
  record_id uuid not null
    references public.coaching_records(id) on delete cascade,
  reviewer_id uuid not null references public.reviewers(id) on delete cascade,
  -- 'certify' = sound as written. 'reject' = wrong, or wrong for this position.
  verdict text not null check (verdict in ('certify', 'reject')),
  -- Why. Load-bearing on a reject: "wrong" without a reason cannot be acted on.
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (record_id, reviewer_id)
);

create index if not exists record_votes_record on public.record_votes(record_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- A third state the flags did not have.
--
-- `contested` means reviewers disagree. It does NOT cover the case where they
-- AGREE the record is wrong. Without `rejected`, a record two black belts both
-- called wrong stays eligible to ground a cue — a worse outcome than a
-- contested one, because nothing about it looks suspect.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.coaching_records
  add column if not exists rejected boolean not null default false;

-- ─────────────────────────────────────────────────────────────────────────────
-- Derive the flags from the votes, so they can never drift from their evidence.
--
--   certified  two or more certify votes, and nobody rejected it
--   contested  at least one of each — reviewers disagree
--   rejected   two or more rejects, and nobody certified it
--
-- Two agreeing rather than one: cheap enough to finish a real queue, while a
-- single wrong call cannot become ground truth on its own. Disagreement is
-- kept rather than averaged away — two black belts disagreeing about a
-- mechanic is a finding about the mechanic.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.recompute_record_review(target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  yes integer;
  no integer;
begin
  select
    count(*) filter (where verdict = 'certify'),
    count(*) filter (where verdict = 'reject')
  into yes, no
  from public.record_votes
  where record_id = target;

  update public.coaching_records
  set certified = (yes >= 2 and no = 0),
      contested = (yes > 0 and no > 0),
      rejected  = (no >= 2 and yes = 0),
      updated_at = now()
  where id = target;
end;
$$;

create or replace function public.on_record_vote_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.recompute_record_review(coalesce(new.record_id, old.record_id));
  return coalesce(new, old);
end;
$$;

drop trigger if exists record_votes_recompute on public.record_votes;
create trigger record_votes_recompute
  after insert or update or delete on public.record_votes
  for each row execute function public.on_record_vote_change();

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS. Reviewers see records and their own votes; nobody else sees either.
-- `coaching_records` itself stays service-role only for the pipeline, so this
-- adds a read policy scoped to active reviewers rather than opening the table.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.reviewers enable row level security;
alter table public.record_votes enable row level security;

create policy "Reviewers read their own row"
  on public.reviewers for select
  using (auth.uid() = id);

create policy "Active reviewers read coaching records"
  on public.coaching_records for select
  using (
    exists (
      select 1 from public.reviewers r
      where r.id = auth.uid() and r.active
    )
  );

-- Votes are readable by every active reviewer: seeing that someone else
-- disagreed is the point, not a leak.
create policy "Active reviewers read votes"
  on public.record_votes for select
  using (
    exists (
      select 1 from public.reviewers r
      where r.id = auth.uid() and r.active
    )
  );

create policy "Reviewers write their own votes"
  on public.record_votes for insert
  with check (
    reviewer_id = auth.uid()
    and exists (
      select 1 from public.reviewers r
      where r.id = auth.uid() and r.active
    )
  );

create policy "Reviewers change their own votes"
  on public.record_votes for update
  using (reviewer_id = auth.uid())
  with check (reviewer_id = auth.uid());

comment on column public.coaching_records.rejected is
  'Two or more reviewers agree the record is wrong (#77). Distinct from
   contested, which is disagreement. Rejected records never ground a cue.';
