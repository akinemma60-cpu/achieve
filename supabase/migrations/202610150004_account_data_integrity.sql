insert into public.profiles (id, display_name)
select
  u.id,
  coalesce(u.raw_user_meta_data ->> 'display_name', '')
from auth.users u
on conflict (id) do nothing;

do $migration$
begin
  if exists (
    select 1
    from public.xp_transactions xp
    where not exists (
      select 1
      from public.daily_missions m
      where m.id = xp.mission_id
    )
  ) then
    raise exception 'Cannot add the mission foreign key: orphan XP transactions exist.';
  end if;
end;
$migration$;

alter table public.xp_transactions
  add constraint xp_transactions_mission_id_fkey
  foreign key (mission_id)
  references public.daily_missions (id)
  on delete cascade;

grant select, insert on public.roadmaps to service_role;
