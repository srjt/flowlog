-- ============================================================================
-- Track whether a user has finished first-run onboarding (sport + skill pick,
-- mic priming). New users start at FALSE and are routed through onboarding;
-- existing users are backfilled to TRUE so they're never sent back through it.
-- ============================================================================

alter table public.profiles
  add column if not exists onboarding_complete boolean not null default false;

-- Anyone who already has a profile has been using the app — mark them onboarded.
update public.profiles set onboarding_complete = true;

-- Keep the auto-create trigger explicit about the new column (defaults to false
-- so freshly signed-up users land in onboarding).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, active_sport, skill_level, onboarding_complete)
  values (new.id, 'bjj', 'White Belt', false)
  on conflict (id) do nothing;
  return new;
end;
$$;
