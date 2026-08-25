-- Serve the review queue without re-opening coaching_records (#77).
--
-- Migration 009 revoked every table grant on `coaching_records` from anon and
-- authenticated, deliberately: access should require the service role "by
-- construction rather than by the continued absence of a policy". It even
-- warned that adding a policy later would make the table client-readable.
--
-- 014 then added exactly such a policy for reviewers. It never worked — RLS
-- filters rows only AFTER the role passes the table privilege check, and there
-- is no grant, so every reviewer read failed with 42501. The policy has been
-- inert since the day it was written, and the revoke is what kept the table
-- shut.
--
-- Re-granting SELECT to `authenticated` would fix the bench and undo 009: the
-- table's safety would once again rest on a policy being correct. Given that a
-- policy bug is precisely what broke this feature an hour ago, that is the
-- wrong direction.
--
-- So reviewers read through a SECURITY DEFINER function instead. The table
-- stays ungranted; the function is the only client-reachable door, and it
-- carries its own check.
create or replace function public.review_queue()
returns table (
  id uuid,
  "position" text,
  prescription text,
  why text,
  detail text,
  counter text,
  gi text,
  level text,
  opponent text,
  certified boolean,
  contested boolean,
  rejected boolean
)
language sql
security definer
stable
set search_path = public
as $$
  select
    r.id, r.position, r.prescription, r.why, r.detail, r.counter,
    r.gi, r.level, r.opponent, r.certified, r.contested, r.rejected
  from public.coaching_records r
  -- Not a filter on rows: a non-reviewer gets an empty set, never a leak.
  where public.is_active_reviewer();
$$;

revoke all on function public.review_queue() from public;
grant execute on function public.review_queue() to authenticated;

-- Remove the inert policy. Leaving it would suggest the table is reachable by
-- reviewers directly, which is exactly the misreading that cost an afternoon.
drop policy if exists "Active reviewers read coaching records" on public.coaching_records;

comment on function public.review_queue() is
  'Reviewer-facing read of coaching_records (#77). The table itself stays
   ungranted per migration 009; this function is the only client-reachable
   path and returns nothing unless the caller is an active reviewer.';
