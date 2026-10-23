create table if not exists public.user_progress (
  user_id uuid primary key references auth.users (id) on delete cascade,
  xp integer not null default 0 check (xp >= 0),
  current_streak integer not null default 0 check (current_streak >= 0),
  last_active_date date,
  updated_at timestamptz not null default now()
);

create table if not exists public.daily_missions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  goal_id uuid references public.goals (id) on delete set null,
  title text not null check (char_length(title) between 1 and 180),
  description text not null default '' check (char_length(description) <= 1000),
  mission_date date not null default (now() at time zone 'utc')::date,
  xp_reward smallint not null default 20 check (xp_reward = 20),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, mission_date, title)
);

create index if not exists daily_missions_user_date_idx
  on public.daily_missions (user_id, mission_date desc);

create table if not exists public.xp_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  mission_id uuid not null unique,
  amount smallint not null check (amount = 20),
  created_at timestamptz not null default now()
);

create table if not exists public.coach_rate_limits (
  user_id uuid primary key references auth.users (id) on delete cascade,
  bucket_start timestamptz not null,
  request_count smallint not null check (request_count between 1 and 20)
);

create table if not exists public.coach_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) between 1 and 6000),
  created_at timestamptz not null default now()
);

create index if not exists coach_messages_user_created_idx
  on public.coach_messages (user_id, created_at desc);

create table if not exists public.learning_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  path_id text not null check (char_length(path_id) between 1 and 80),
  lesson_id text not null check (char_length(lesson_id) between 1 and 100),
  completed_at timestamptz not null default now(),
  unique (user_id, path_id, lesson_id)
);

alter table public.user_progress enable row level security;
alter table public.daily_missions enable row level security;
alter table public.xp_transactions enable row level security;
alter table public.coach_rate_limits enable row level security;
alter table public.coach_messages enable row level security;
alter table public.learning_progress enable row level security;

create policy "Users can read their progression"
  on public.user_progress for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can read their missions"
  on public.daily_missions for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can read their XP history"
  on public.xp_transactions for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can read their coach rate limit"
  on public.coach_rate_limits for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can read their coach messages"
  on public.coach_messages for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can save their coach messages"
  on public.coach_messages for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can delete their coach messages"
  on public.coach_messages for delete to authenticated using ((select auth.uid()) = user_id);
create policy "Users can read their learning progress"
  on public.learning_progress for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can record their lesson completion"
  on public.learning_progress for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can remove their lesson completion"
  on public.learning_progress for delete to authenticated using ((select auth.uid()) = user_id);

grant select on public.user_progress to authenticated;
grant select on public.daily_missions to authenticated;
grant select on public.xp_transactions to authenticated;
grant select on public.coach_rate_limits to authenticated;
grant select, insert, delete on public.coach_messages to authenticated;
grant select, insert, delete on public.learning_progress to authenticated;

create or replace function public.initialize_user_progress()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.user_progress (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke all on function public.initialize_user_progress() from public, anon, authenticated;
drop trigger if exists on_auth_user_progress_created on auth.users;
create trigger on_auth_user_progress_created
  after insert on auth.users
  for each row execute procedure public.initialize_user_progress();

insert into public.user_progress (user_id)
select id from auth.users
on conflict (user_id) do nothing;

create or replace function public.create_daily_mission(
  p_goal_id uuid,
  p_title text,
  p_description text default ''
)
returns public.daily_missions
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  created_mission public.daily_missions;
  today_utc date := (now() at time zone 'utc')::date;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;
  if p_title is null or char_length(btrim(p_title)) not between 1 and 180
    or p_description is null or char_length(p_description) > 1000 then
    raise exception 'Mission details are invalid';
  end if;
  if not exists (
    select 1 from public.goals g
    where g.id = p_goal_id and g.user_id = current_user_id and g.status = 'active'
  ) then
    raise exception 'Choose one of your active goals';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(current_user_id::text || today_utc::text, 0));
  if (
    select count(*) from public.daily_missions m
    where m.user_id = current_user_id and m.mission_date = today_utc
  ) >= 5 then
    raise exception 'You can create up to five missions each day';
  end if;

  insert into public.daily_missions (user_id, goal_id, title, description, mission_date)
  values (current_user_id, p_goal_id, btrim(p_title), btrim(p_description), today_utc)
  returning * into created_mission;

  return created_mission;
exception
  when unique_violation then
    raise exception 'A mission with this title already exists today';
end;
$$;

revoke all on function public.create_daily_mission(uuid, text, text) from public, anon;
grant execute on function public.create_daily_mission(uuid, text, text) to authenticated;

create or replace function public.complete_daily_mission(p_mission_id uuid)
returns public.user_progress
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  target_mission public.daily_missions;
  current_progress public.user_progress;
  today_utc date := (now() at time zone 'utc')::date;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  select * into target_mission
  from public.daily_missions
  where id = p_mission_id and user_id = current_user_id
  for update;

  if not found then
    raise exception 'Mission not found';
  end if;
  if target_mission.mission_date <> today_utc then
    raise exception 'Only missions scheduled for today can be completed';
  end if;

  insert into public.user_progress (user_id)
  values (current_user_id)
  on conflict (user_id) do nothing;

  insert into public.xp_transactions (user_id, mission_id, amount)
  values (current_user_id, target_mission.id, target_mission.xp_reward)
  on conflict (mission_id) do nothing;

  if found then
    update public.daily_missions
      set completed_at = coalesce(completed_at, now())
      where id = target_mission.id;

    update public.user_progress p
    set xp = p.xp + target_mission.xp_reward,
        current_streak = case
          when p.last_active_date = today_utc then p.current_streak
          when p.last_active_date = today_utc - 1 then p.current_streak + 1
          else 1
        end,
        last_active_date = today_utc,
        updated_at = now()
    where p.user_id = current_user_id;
  end if;

  select * into current_progress
  from public.user_progress
  where user_id = current_user_id;
  return current_progress;
end;
$$;

revoke all on function public.complete_daily_mission(uuid) from public, anon;
grant execute on function public.complete_daily_mission(uuid) to authenticated;

create or replace function public.consume_coach_rate_limit()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_bucket timestamptz := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  insert into public.coach_rate_limits (user_id, bucket_start, request_count)
  values (current_user_id, current_bucket, 1)
  on conflict (user_id) do update
    set bucket_start = excluded.bucket_start,
        request_count = case
          when public.coach_rate_limits.bucket_start = excluded.bucket_start
            then public.coach_rate_limits.request_count + 1
          else 1
        end
    where public.coach_rate_limits.bucket_start <> excluded.bucket_start
       or public.coach_rate_limits.request_count < 20;

  return found;
end;
$$;

revoke all on function public.consume_coach_rate_limit() from public, anon;
grant execute on function public.consume_coach_rate_limit() to authenticated;

alter table public.profiles
  add column if not exists timezone text not null default 'UTC';
