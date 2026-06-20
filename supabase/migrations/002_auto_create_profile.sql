-- ============================================================================
-- Auto-create a profile row for every auth user.
--
-- `sessions.user_id` references `profiles`, so a profile must exist before any
-- session is saved. Creating it client-side is fragile (e.g. when email
-- confirmation is on, there's no session at sign-up to satisfy RLS). This
-- trigger guarantees a profile exists for every user, and the backfill creates
-- one for any users that already signed up without it.
-- ============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, active_sport, skill_level)
  values (new.id, 'bjj', 'White Belt')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill profiles for existing users that don't have one yet.
insert into public.profiles (id, active_sport, skill_level)
select u.id, 'bjj', 'White Belt'
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;
