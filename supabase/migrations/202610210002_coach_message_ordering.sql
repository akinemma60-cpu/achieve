-- Deterministic ordering for coach conversations.
--
-- `coach_messages.created_at` alone cannot order a conversation reliably: the user
-- prompt and the assistant reply are written by two separate requests, and the
-- ORDER BY had no tie-breaker, so Postgres was free to return an equal-timestamp
-- pair in either order. The assistant reply could therefore render before the
-- question it answered.
--
-- `id` cannot break the tie either: it defaults to gen_random_uuid(), which is
-- random rather than monotonic. This adds a monotonic sequence so the intended
-- insertion order is always recoverable.

create sequence if not exists public.coach_messages_seq_seq;

alter table public.coach_messages
  add column if not exists seq bigint;

-- Backfill existing rows so the column is safe to use straight away. Rows that
-- share a timestamp are ordered by id, which is a random UUID, so their relative
-- order is arbitrary for those rows only. New messages are ordered exactly.
with ordered as (
  select
    id,
    row_number() over (order by created_at, id) as position
  from public.coach_messages
)
update public.coach_messages m
set seq = ordered.position
from ordered
where m.id = ordered.id and m.seq is null;

alter table public.coach_messages
  alter column seq set default nextval('public.coach_messages_seq_seq'),
  alter column seq set not null;

-- Move the sequence past the highest existing value. `is_called = false` on an
-- empty table so the first inserted row receives 1 rather than skipping a value.
select setval(
  'public.coach_messages_seq_seq',
  greatest(coalesce(max(seq), 0), 1),
  coalesce(max(seq), 0) > 0
)
from public.coach_messages;

-- The default expression nextval() runs as the inserting role, so both roles
-- that write coach messages need usage on the sequence.
grant usage, select on sequence public.coach_messages_seq_seq to authenticated, service_role;

-- The coach Edge Function stores the assistant reply with the service-role
-- client and then reads the saved row back, because it needs the generated
-- `seq` value to return to the browser. PostgREST serves that as
-- `insert ... returning`, and `RETURNING` requires the SELECT privilege in
-- addition to INSERT.
--
-- The earlier grant in 202610150003_coach_message_security.sql covered only
-- `insert`, so the function would fail with "permission denied for table
-- coach_messages" and the user would never receive a reply. This mirrors the
-- `select, insert` grant that public.roadmaps already has for service_role.
grant select, insert on public.coach_messages to service_role;

create index if not exists coach_messages_user_seq_idx
  on public.coach_messages (user_id, seq desc);
