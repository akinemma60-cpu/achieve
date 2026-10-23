// Ad-hoc validation harness: applies the ACHIEVE migrations to an in-process
// Postgres build so the SQL can be exercised without a remote project.
// Run with: deno run --allow-all tools/validate-migrations.ts
import { PGlite } from 'npm:@electric-sql/pglite@0.3.10'

const migrationDir = new URL('../supabase/migrations/', import.meta.url)

const files = [...Deno.readDirSync(migrationDir)]
  .filter((entry) => entry.isFile && entry.name.endsWith('.sql'))
  .map((entry) => entry.name)
  .sort()

const db = new PGlite()

// Every check below reports through `check`, so a failed assertion makes the
// script exit non-zero. A validation harness that always exits 0 is useless.
const failures: string[] = []
const check = (passed: boolean, message: string) => {
  console.log(passed ? `PASS  ${message}` : `FAIL  ${message}`)
  if (!passed) failures.push(message)
}

// The migrations reference auth.users, which is Supabase-managed. A minimal
// stand-in is enough to exercise the schema, triggers, policies and functions.
// The Supabase-managed roles the grants and policies reference are stubbed too.
await db.exec(`
  create schema if not exists auth;
  create table if not exists auth.users (
    id uuid primary key default gen_random_uuid(),
    email text,
    raw_user_meta_data jsonb default '{}'::jsonb
  );
  do $$
  begin
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then
      create role authenticated nologin noinherit;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'anon') then
      create role anon nologin noinherit;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then
      create role service_role nologin noinherit bypassrls;
    end if;
  end $$;
  create or replace function auth.uid() returns uuid
    language sql stable
    as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
`)

for (const name of files) {
  const sql = await Deno.readTextFile(new URL(name, migrationDir))
  try {
    await db.exec(sql)
    check(true, name)
  } catch (error) {
    check(false, name)
    console.log(`      ${error.message}`)
    await db.close()
    Deno.exit(1)
  }
}

// Exercise the coach message ordering behaviour end to end.
await db.exec(`
  insert into auth.users (id, email) values ('11111111-1111-4111-8111-111111111111', 'a@example.com');
`)

await db.exec(`
  insert into public.coach_messages (user_id, role, content)
  values ('11111111-1111-4111-8111-111111111111', 'user', 'Question one');
`)
await db.exec(`
  insert into public.coach_messages (user_id, role, content)
  values ('11111111-1111-4111-8111-111111111111', 'assistant', 'Answer one');
`)

const { rows } = await db.query(
  `select role, content, seq from public.coach_messages order by seq asc`
)
console.log('\ncoach_messages ordered by seq:')
for (const row of rows) console.log(`  ${row.seq}  ${row.role.padEnd(9)} ${row.content}`)

const seqs = rows.map((row) => Number(row.seq))
const strictlyIncreasing = seqs.every((value, index) => index === 0 || value > seqs[index - 1])
check(strictlyIncreasing, 'seq is strictly increasing')

// The original defect: a prompt and its reply could share a `created_at` value,
// and the ORDER BY had no tie-breaker, so the reply could render first. Force the
// tie and confirm the sequence still produces the intended order.
await db.exec(`
  update public.coach_messages set created_at = '2026-01-01T00:00:00Z';
`)
const tied = await db.query(`
  select role, seq from public.coach_messages order by seq asc
`)
const tiedOrder = tied.rows.map((row) => row.role)
const tieBroken = tiedOrder[0] === 'user' && tiedOrder[1] === 'assistant'
check(tieBroken, tieBroken
  ? 'a tied timestamp still orders the prompt before the reply'
  : `tied timestamps ordered as ${tiedOrder.join(', ')}`)

// And confirm the plain created_at ordering would have been ambiguous.
const ambiguous = await db.query(`
  select count(distinct created_at)::int as distinct_timestamps,
         count(*)::int as total
  from public.coach_messages
`)
console.log(`      (${ambiguous.rows[0].total} rows share ${ambiguous.rows[0].distinct_timestamps} timestamp(s))`)

// The unique constraint that toggleLesson relies on must exist.
const unique = await db.query(`
  select count(*)::int as count from pg_indexes
  where tablename = 'learning_progress' and indexdef ilike '%UNIQUE%'
`)
check(unique.rows[0].count > 0, unique.rows[0].count > 0
  ? 'learning_progress has a unique index'
  : 'learning_progress is missing its unique index')

// The insert path must assign a sequence without the caller supplying one.
await db.exec(`
  insert into public.coach_messages (user_id, role, content)
  values ('11111111-1111-4111-8111-111111111111', 'user', 'Question two');
`)
const assigned = await db.query(`
  select seq from public.coach_messages where content = 'Question two'
`)
check(assigned.rows[0]?.seq !== null, assigned.rows[0]?.seq !== null
  ? `a new message is assigned seq ${assigned.rows[0].seq} automatically`
  : 'a new message was not assigned a sequence')

// The coach Edge Function saves the assistant reply with the service-role
// client and then reads the row back to return the generated `seq`. PostgREST
// serves that as `insert ... returning`, and `RETURNING` needs the SELECT
// privilege as well as INSERT. A grant of only `insert` makes every coach
// reply fail with "permission denied for table coach_messages".
await db.exec(`
  insert into auth.users (id, email) values ('22222222-2222-4222-8222-222222222222', 'b@example.com');
`)
await db.exec(`set role service_role;`)
try {
  const returned = await db.query(`
    insert into public.coach_messages (user_id, role, content)
    values ('22222222-2222-4222-8222-222222222222', 'assistant', 'Server reply')
    returning role, content, seq
  `)
  check(returned.rows[0]?.seq !== null && returned.rows[0]?.seq !== undefined,
    `service_role can insert and read back a reply, seq = ${returned.rows[0]?.seq}`)
} catch (error) {
  check(false, `service_role cannot insert and read back a reply: ${error.message}`)
}
await db.exec(`reset role;`)

// The browser client writes its own prompt and must receive the sequence too.
await db.exec(`
  set role authenticated;
  set request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
`)
try {
  const returned = await db.query(`
    insert into public.coach_messages (user_id, role, content)
    values ('11111111-1111-4111-8111-111111111111', 'user', 'Browser prompt')
    returning role, content, seq
  `)
  check(returned.rows[0]?.seq !== null && returned.rows[0]?.seq !== undefined,
    `authenticated can insert and read back a prompt, seq = ${returned.rows[0]?.seq}`)
} catch (error) {
  check(false, `authenticated cannot insert and read back a prompt: ${error.message}`)
}
await db.exec(`reset role;`)

// Row level security must keep one user's coach messages hidden from another.
// The second user owns 'Server reply' and must still see that one row, while
// every row owned by the first user must stay hidden.
await db.exec(`
  set role authenticated;
  set request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
`)
const visible = await db.query(`
  select
    count(*)::int as total,
    count(*) filter (where user_id = '11111111-1111-4111-8111-111111111111')::int as leaked
  from public.coach_messages
`)
check(visible.rows[0].leaked === 0,
  `a signed-in user cannot read another user's coach messages (leaked ${visible.rows[0].leaked} of ${visible.rows[0].total})`)
check(visible.rows[0].total === 1,
  `a signed-in user still reads their own coach messages (saw ${visible.rows[0].total})`)
await db.exec(`reset role;`)

// A user whose sign-up metadata carries an over-long display name. The signup
// trigger copies the name straight out of the metadata, and the metadata is
// supplied by whoever calls the sign-up endpoint, so an over-long name must be
// trimmed there. Otherwise the new length constraint would break sign-up.
let signupError = ''
try {
  await db.exec(`
    insert into auth.users (id, email, raw_user_meta_data)
    values (
      '33333333-3333-4333-8333-333333333333',
      'c@example.com',
      jsonb_build_object('display_name', repeat('x', 200))
    );
  `)
} catch (error) {
  signupError = error.message
}
check(signupError === '',
  `sign-up with an over-long display name still succeeds (${signupError.split('\n')[0]})`)
const signupProfile = await db.query(`
  select char_length(display_name) as name_length from public.profiles
  where id = '33333333-3333-4333-8333-333333333333'
`)
check(signupProfile.rows[0]?.name_length === 80,
  `sign-up trims an over-long display name to ${signupProfile.rows[0]?.name_length} characters`)

// A second user for the length-constraint tests. Its profile row is removed so
// a failing insert cannot be blamed on a duplicate key, and the auth row stays
// so the foreign key is satisfied and the length check is the only thing left
// that can reject the row.
await db.exec(`
  insert into auth.users (id, email)
  values ('44444444-4444-4444-8444-444444444444', 'd@example.com');
  delete from public.profiles where id = '44444444-4444-4444-8444-444444444444';
`)

// The profile integrity migration must bound the fields the settings form
// bounds, because a request sent straight to the REST API skips the form.
try {
  await db.exec(`
    insert into public.profiles (id, display_name, focus)
    values ('44444444-4444-4444-8444-444444444444', repeat('n', 81), '');
  `)
  check(false, 'an over-long display name is rejected by the database')
} catch (error) {
  check(
    error.message.includes('profiles_display_name_length_check'),
    `an over-long display name is rejected by the database (${error.message.split('\n')[0]})`
  )
}

try {
  await db.exec(`
    insert into public.profiles (id, display_name, focus)
    values ('44444444-4444-4444-8444-444444444444', 'Valid', repeat('f', 201));
  `)
  check(false, 'an over-long focus note is rejected by the database')
} catch (error) {
  check(
    error.message.includes('profiles_focus_length_check'),
    `an over-long focus note is rejected by the database (${error.message.split('\n')[0]})`
  )
}

// A CHECK constraint is satisfied by NULL, because the comparison evaluates to
// NULL rather than false. The `not null` column definition is what actually
// rejects a missing value, so it needs its own check.
try {
  await db.exec(`
    insert into public.profiles (id, display_name, focus)
    values ('44444444-4444-4444-8444-444444444444', null, 'A focus');
  `)
  check(false, 'a missing display name is rejected by the database')
} catch (error) {
  check(
    error.message.includes('not-null') || error.message.includes('null value'),
    `a missing display name is rejected by the database (${error.message.split('\n')[0]})`
  )
}

try {
  await db.exec(`
    insert into public.profiles (id, display_name, focus)
    values ('44444444-4444-4444-8444-444444444444', 'Valid', null);
  `)
  check(false, 'a missing focus note is rejected by the database')
} catch (error) {
  check(
    error.message.includes('not-null') || error.message.includes('null value'),
    `a missing focus note is rejected by the database (${error.message.split('\n')[0]})`
  )
}

// The settings form saves with an upsert, so `authenticated` needs insert and
// update on the table, and the app reads the profile back with select.
const grants = await db.query(`
  select
    has_table_privilege('authenticated', 'public.profiles', 'select') as can_select,
    has_table_privilege('authenticated', 'public.profiles', 'insert') as can_insert,
    has_table_privilege('authenticated', 'public.profiles', 'update') as can_update
`)
check(grants.rows[0]?.can_select === true &&
  grants.rows[0]?.can_insert === true &&
  grants.rows[0]?.can_update === true,
  'authenticated can select, insert and update profiles')

// `updated_at` must move when a row is edited, otherwise a later change cannot
// be told apart from the original write.
await db.exec(`select pg_sleep(0.05);`)
const beforeUpdate = await db.query(`
  select updated_at from public.profiles where id = '33333333-3333-4333-8333-333333333333'
`)
await db.exec(`
  update public.profiles set focus = 'A new focus'
  where id = '33333333-3333-4333-8333-333333333333';
`)
const afterUpdate = await db.query(`
  select updated_at from public.profiles where id = '33333333-3333-4333-8333-333333333333'
`)
check(
  new Date(afterUpdate.rows[0].updated_at).getTime() > new Date(beforeUpdate.rows[0].updated_at).getTime(),
  'updating a profile moves its updated_at timestamp'
)

// The settings form saves with an upsert, so a user must be able to write their
// own profile row and must not be able to write anyone else's.

// Read the other user's profile while still the table owner. The row is
// invisible to `authenticated`, so reading it afterwards would compare two
// undefined values and pass without proving anything.
const otherOwner = await db.query(`
  select display_name from public.profiles
  where id = '33333333-3333-4333-8333-333333333333'
`)

await db.exec(`
  set role authenticated;
  set request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
`)
try {
  await db.exec(`
    insert into public.profiles (id, display_name, focus)
    values ('11111111-1111-4111-8111-111111111111', 'Mine', 'My focus')
    on conflict (id) do update set display_name = excluded.display_name, focus = excluded.focus;
  `)
  const ownProfile = await db.query(`
    select display_name, focus from public.profiles
    where id = '11111111-1111-4111-8111-111111111111'
  `)
  check(ownProfile.rows[0]?.display_name === 'Mine',
    'a signed-in user can save their own profile')
} catch (error) {
  check(false, `a signed-in user cannot save their own profile: ${error.message}`)
}

// Writing another user's profile must be refused by the row level security
// policy. The update is expected to match zero rows: the policy hides the
// other user's row, so the statement succeeds but changes nothing.
let hijackRows = -1
try {
  const hijacked = await db.query(`
    update public.profiles set display_name = 'Hijacked'
    where id = '33333333-3333-4333-8333-333333333333'
    returning display_name
  `)
  hijackRows = hijacked.rows.length
} catch {
  // A raised error is also an acceptable refusal.
  hijackRows = 0
}
await db.exec(`reset role;`)
const stillOwner = await db.query(`
  select display_name from public.profiles
  where id = '33333333-3333-4333-8333-333333333333'
`)
check(hijackRows === 0 && stillOwner.rows[0]?.display_name === otherOwner.rows[0]?.display_name,
  `a signed-in user cannot write another user’s profile (${hijackRows} rows changed)`)

// A row that was written before the constraint existed has to be trimmed by the
// migration itself, or adding the constraint would fail on a real database.
await db.exec(`
  insert into auth.users (id, email)
  values ('55555555-5555-4555-8555-555555555555', 'e@example.com');
`)
await db.exec(`
  alter table public.profiles drop constraint profiles_display_name_length_check;
  alter table public.profiles drop constraint profiles_focus_length_check;
  update public.profiles
  set display_name = repeat('o', 120), focus = repeat('c', 400)
  where id = '55555555-5555-4555-8555-555555555555';
`)
const profileMigration = files.find((name) => name.includes('profile_integrity'))
if (!profileMigration) {
  check(false, 'the profile integrity migration is missing')
} else {
  const profileSql = await Deno.readTextFile(new URL(profileMigration, migrationDir))
  try {
    await db.exec(profileSql)
    check(true, `${profileMigration} is safe to re-run`)
  } catch (error) {
    check(false, `${profileMigration} cannot be re-run: ${error.message}`)
  }
  const trimmed = await db.query(`
    select
      char_length(display_name) as name_length,
      char_length(focus) as focus_length
    from public.profiles
    where id = '55555555-5555-4555-8555-555555555555'
  `)
  check(trimmed.rows[0]?.name_length === 80 && trimmed.rows[0]?.focus_length === 200,
    `the migration trims an existing over-long profile (name ${trimmed.rows[0]?.name_length}, focus ${trimmed.rows[0]?.focus_length})`)
}

// The migration must be safe to re-run, because `supabase db push` replays the
// migration history and a partially applied file should not break the push.
const orderingMigration = files.find((name) => name.includes('coach_message_ordering'))
if (!orderingMigration) {
  check(false, 'the coach message ordering migration is missing')
} else {
  const orderingSql = await Deno.readTextFile(new URL(orderingMigration, migrationDir))
  try {
    await db.exec(orderingSql)
    check(true, `${orderingMigration} is safe to re-run`)
  } catch (error) {
    check(false, `${orderingMigration} cannot be re-run: ${error.message}`)
  }
}

// --- Mission creation limits and exactly-once XP validation ---
const missionUser = '66666666-6666-4666-8666-666666666666';
await db.exec(`set request.jwt.claim.sub = '${missionUser}'`);
await db.exec(`insert into auth.users (id, email) values ('${missionUser}', 'm@example.com')`);
await db.exec(`
  insert into public.goals (id, user_id, title, status)
  values ('77777777-7777-4777-8777-777777777777', '${missionUser}', 'Test goal', 'active')
`);

const { rows: goalRows } = await db.query(
  `select id from public.goals where user_id = '${missionUser}' and status = 'active' limit 1`
);
check(goalRows.length === 1, 'active goal exists for mission tests');

const createResult = await db.query(
  `select (public.create_daily_mission('77777777-7777-4777-8777-777777777777', 'Test mission', 'desc')).id as mission_id`
);
const missionId = createResult.rows[0]?.mission_id;
check(typeof missionId === 'string', 'create_daily_mission returns a mission id');

try {
  await db.query(
    `select public.create_daily_mission('77777777-7777-4777-8777-777777777777', 'Test mission', 'desc')`
  );
  check(false, 'duplicate mission title today is rejected');
} catch {
  check(true, 'duplicate mission title today is rejected');
}

const completeResult1 = await db.query(
  `select (public.complete_daily_mission('${missionId}')).xp as xp`
);
const progress1 = completeResult1.rows[0]?.xp;
check(progress1 === 20, 'first completion awards 20 XP');

const completeResult2 = await db.query(
  `select (public.complete_daily_mission('${missionId}')).xp as xp`
);
const progress2 = completeResult2.rows[0]?.xp;
check(progress2 === 20, 'repeat completion does not award XP again (exactly-once)');

const xpRows = await db.query(
  `select count(*) as n from public.xp_transactions where mission_id = '${missionId}'`
);
check(Number(xpRows.rows[0]?.n) === 1, 'exactly one XP transaction per mission');

const missionRow = await db.query(
  `select completed_at is not null as done from public.daily_missions where id = '${missionId}'`
);
check(missionRow.rows[0]?.done === true, 'mission is marked completed');

const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
await db.exec(`
  insert into public.daily_missions (user_id, goal_id, title, mission_date, xp_reward)
  values ('${missionUser}', '77777777-7777-4777-8777-777777777777', 'Yesterday mission', '${yesterday}', 20)
`);
const yesterdayMission = await db.query(
  `select id from public.daily_missions where title = 'Yesterday mission'`
);
try {
  await db.query(`select public.complete_daily_mission('${yesterdayMission.rows[0]?.id}')`);
  check(false, 'yesterday mission cannot be completed');
} catch {
  check(true, 'yesterday mission cannot be completed');
}

const limitUser = '88888888-8888-4888-8888-888888888888';
await db.exec(`set request.jwt.claim.sub = '${limitUser}'`);
await db.exec(`insert into auth.users (id, email) values ('${limitUser}', 'l@example.com')`);
await db.exec(`
  insert into public.goals (id, user_id, title, status)
  values ('99999999-9999-4999-8999-999999999999', '${limitUser}', 'Limit goal', 'active')
`);
for (let i = 1; i <= 5; i++) {
  await db.query(`select public.create_daily_mission('99999999-9999-4999-8999-999999999999', 'Limit mission ${i}', '')`);
}
try {
  await db.query(`select public.create_daily_mission('99999999-9999-4999-8999-999999999999', 'Limit mission 6', '')`);
  check(false, 'sixth daily mission is rejected (limit 5)');
} catch {
  check(true, 'sixth daily mission is rejected (limit 5)');
}

await db.close()

if (failures.length) {
  console.error(`\n${failures.length} migration validation check(s) failed.`)
  Deno.exit(1)
}
console.log('\nAll migration validation checks passed.')
