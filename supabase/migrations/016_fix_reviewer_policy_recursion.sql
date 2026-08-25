-- Fix infinite recursion in the reviewer policies (#77).
--
--   42P17: infinite recursion detected in policy for relation "reviewers"
--
-- Migration 015 added a policy ON `reviewers` whose USING clause SELECTs FROM
-- `reviewers`. Postgres evaluates that subquery under RLS as well, which
-- re-enters the same policy, and it bails out.
--
-- The blast radius was wider than the roster. 014's policies on
-- `coaching_records` and `record_votes` also subquery `reviewers`, and those
-- subqueries are subject to the recursive policy too — so EVERY reviewer-facing
-- read was failing, not just the one that introduced it.
--
-- It surfaced as "Not a reviewer" in the bench, because the client treated a
-- failed lookup and a genuine non-reviewer identically. A 500 wearing the
-- costume of a permissions answer.

-- ─────────────────────────────────────────────────────────────────────────────
-- The standard escape: a SECURITY DEFINER function runs as its owner and is
-- therefore NOT subject to RLS on the table it reads, so the check terminates.
--
-- `stable` lets the planner call it once per statement rather than per row.
-- `search_path` is pinned because a SECURITY DEFINER function without one is a
-- privilege-escalation vector — a caller could otherwise point `public` at
-- their own `reviewers` table.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.is_active_reviewer()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.reviewers
    where id = auth.uid() and active
  );
$$;

revoke all on function public.is_active_reviewer() from public;
grant execute on function public.is_active_reviewer() to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Rebuild every policy that referenced `reviewers` inline.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists "Active reviewers read the reviewer roster" on public.reviewers;
drop policy if exists "Reviewers read their own row" on public.reviewers;
drop policy if exists "Active reviewers read coaching records" on public.coaching_records;
drop policy if exists "Active reviewers read votes" on public.record_votes;
drop policy if exists "Reviewers write their own votes" on public.record_votes;
drop policy if exists "Reviewers change their own votes" on public.record_votes;

-- Own row stays readable by id alone: no subquery, so a reviewer can always
-- identify themselves even if the helper is ever misconfigured.
create policy "Reviewers read their own row"
  on public.reviewers for select
  using (auth.uid() = id);

-- Attribution: a note is much weaker evidence unattributed (#84). Scoped to
-- active reviewers — this is not a public directory.
create policy "Active reviewers read the reviewer roster"
  on public.reviewers for select
  using (public.is_active_reviewer());

create policy "Active reviewers read coaching records"
  on public.coaching_records for select
  using (public.is_active_reviewer());

create policy "Active reviewers read votes"
  on public.record_votes for select
  using (public.is_active_reviewer());

create policy "Reviewers write their own votes"
  on public.record_votes for insert
  with check (reviewer_id = auth.uid() and public.is_active_reviewer());

create policy "Reviewers change their own votes"
  on public.record_votes for update
  using (reviewer_id = auth.uid() and public.is_active_reviewer())
  with check (reviewer_id = auth.uid());
