-- Profile field limits and reliable `updated_at` maintenance.
--
-- The browser already limits these fields with `maxLength`, but the browser is
-- not the only writer. A request sent directly to the REST API bypasses the
-- form entirely, so the same limits are enforced by the database as well.
-- The limits match the ones the settings form applies.

alter table public.profiles
  drop constraint if exists profiles_display_name_length_check;

-- Existing rows may already hold a longer display name, because the signup
-- trigger copied it straight from the sign-up form with no limit. They are
-- trimmed to the limit first so the constraint can be added safely.
update public.profiles
set display_name = left(display_name, 80)
where char_length(display_name) > 80;

alter table public.profiles
  add constraint profiles_display_name_length_check
  check (char_length(display_name) <= 80);

alter table public.profiles
  drop constraint if exists profiles_focus_length_check;

update public.profiles
set focus = left(focus, 200)
where char_length(focus) > 200;

alter table public.profiles
  add constraint profiles_focus_length_check
  check (char_length(focus) <= 200);

-- `updated_at` columns exist on profiles, goals and roadmaps, but no trigger
-- ever set them, so every row kept the timestamp from the moment it was
-- inserted and a later edit was indistinguishable from the original write.
-- This trigger keeps the column honest.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists goals_set_updated_at on public.goals;
create trigger goals_set_updated_at
  before update on public.goals
  for each row execute function public.set_updated_at();

drop trigger if exists roadmaps_set_updated_at on public.roadmaps;
create trigger roadmaps_set_updated_at
  before update on public.roadmaps
  for each row execute function public.set_updated_at();

-- The signup trigger copied `raw_user_meta_data.display_name` straight into the
-- profile. The sign-up form limits the name, but the metadata is supplied by
-- whoever calls the sign-up endpoint, so it was not actually bounded. With the
-- length constraint in place an over-long name would fail the insert and break
-- sign-up entirely, so the trigger now trims the value it copies.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    left(coalesce(new.raw_user_meta_data ->> 'display_name', ''), 80)
  );
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;
