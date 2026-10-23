create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  focus text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 160),
  category text not null default 'Personal' check (char_length(category) <= 60),
  description text not null default '' check (char_length(description) <= 2000),
  motivation text not null default '' check (char_length(motivation) <= 2000),
  target_date date,
  status text not null default 'active' check (status in ('active', 'paused', 'completed')),
  progress smallint not null default 0 check (progress between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists goals_user_status_idx on public.goals (user_id, status);

create table if not exists public.roadmaps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  goal_id uuid references public.goals (id) on delete set null,
  title text not null check (char_length(title) between 1 and 160),
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists roadmaps_user_created_idx on public.roadmaps (user_id, created_at desc);

create table if not exists public.ai_roadmap_rate_limits (
  user_id uuid primary key references auth.users (id) on delete cascade,
  bucket_start timestamptz not null,
  request_count smallint not null check (request_count between 1 and 5)
);

alter table public.profiles enable row level security;
alter table public.goals enable row level security;
alter table public.roadmaps enable row level security;
alter table public.ai_roadmap_rate_limits enable row level security;

create policy "Users can read their profile"
  on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy "Users can create their profile"
  on public.profiles for insert to authenticated with check ((select auth.uid()) = id);
create policy "Users can update their profile"
  on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create policy "Users can read their goals"
  on public.goals for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can create their goals"
  on public.goals for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can update their goals"
  on public.goals for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users can delete their goals"
  on public.goals for delete to authenticated using ((select auth.uid()) = user_id);

create policy "Users can read their roadmaps"
  on public.roadmaps for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can save their roadmaps"
  on public.roadmaps for insert to authenticated with check (
    (select auth.uid()) = user_id
    and (
      goal_id is null
      or exists (
        select 1 from public.goals g
        where g.id = goal_id and g.user_id = (select auth.uid())
      )
    )
  );
create policy "Users can update their roadmaps"
  on public.roadmaps for update to authenticated using ((select auth.uid()) = user_id) with check (
    (select auth.uid()) = user_id
    and (
      goal_id is null
      or exists (
        select 1 from public.goals g
        where g.id = goal_id and g.user_id = (select auth.uid())
      )
    )
  );
create policy "Users can delete their roadmaps"
  on public.roadmaps for delete to authenticated using ((select auth.uid()) = user_id);

create policy "Users can read their AI rate limit"
  on public.ai_roadmap_rate_limits for select to authenticated using ((select auth.uid()) = user_id);

create or replace function public.consume_roadmap_rate_limit()
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

  insert into public.ai_roadmap_rate_limits (user_id, bucket_start, request_count)
  values (current_user_id, current_bucket, 1)
  on conflict (user_id) do update
    set bucket_start = excluded.bucket_start,
        request_count = case
          when public.ai_roadmap_rate_limits.bucket_start = excluded.bucket_start
            then public.ai_roadmap_rate_limits.request_count + 1
          else 1
        end
    where public.ai_roadmap_rate_limits.bucket_start <> excluded.bucket_start
       or public.ai_roadmap_rate_limits.request_count < 5;

  return found;
end;
$$;

revoke all on function public.consume_roadmap_rate_limit() from public, anon;
grant execute on function public.consume_roadmap_rate_limit() to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', ''));
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

grant select, insert, update, delete on public.goals to authenticated;
grant select, insert, update, delete on public.roadmaps to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select on public.ai_roadmap_rate_limits to authenticated;
