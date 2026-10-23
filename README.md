# ACHIEVE

ACHIEVE is a React + Vite personal-growth app with Supabase Auth and account-scoped goals, roadmaps, daily missions, XP history, coaching, and learning progress.

## Run locally

```powershell
npm install
npm run dev
```

Keep the existing local `.env` containing `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. It is excluded by `.gitignore`. `.env.example` is only a placeholder template. Restart Vite after changing `.env`.

## Supabase setup

Signup and session handling use Supabase Auth. Set `http://localhost:5173` as the local site URL and allowed redirect in **Authentication → URL Configuration**.

The SQL migrations in `supabase/migrations/` have not been applied by this repository. Review them before applying to the project:

- `202610150001_initial_achieve.sql` creates profiles, goals, roadmaps, owner-scoped RLS, and roadmap rate limiting.
- `202610150002_product_features.sql` adds persisted daily missions, idempotent XP/streak rewards, private coaching history, learning completion, and the coach request limit.
- `202610150003_coach_message_security.sql` limits browser inserts to the signed-in user's own prompts; the coach function stores verified assistant replies server-side.
- `202610150004_account_data_integrity.sql` backfills profiles for existing Auth users and adds an XP-transaction foreign key to its mission. It stops with an explicit error if orphan XP rows need manual repair.
- `202610210001_learning_progress_integrity.sql` restricts lesson completion to the known built-in lessons.
- `202610210002_coach_message_ordering.sql` adds a monotonic `seq` column to `coach_messages` so a conversation always renders in the order the messages were written, even when a prompt and its reply share a `created_at` value. It backfills existing rows, grants sequence usage to the roles that write coach messages, and grants `select, insert` on `coach_messages` to `service_role` so the coach function can read back the sequence of the reply it stored.
- `202610210003_profile_integrity.sql` enforces the same display-name and focus limits the settings form applies, because a request sent straight to the REST API bypasses the form. It trims existing rows before adding the constraints, keeps `updated_at` honest with triggers on `profiles`, `goals` and `roadmaps`, and trims the display name the signup trigger copies out of the Auth metadata so an over-long name cannot break sign-up.

After review and explicit approval, use the Supabase CLI. The CLI needs a Supabase account access token first; create one under **Account → Access Tokens** in the Supabase dashboard and run `npx supabase login --token <token>`. `npx supabase link` also asks for the project's database password.

```powershell
npx supabase login --token YOUR_ACCESS_TOKEN
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
npx supabase functions deploy generate-roadmap
npx supabase functions deploy coach-chat
```

These commands deploy to the linked remote project; do not run them without approval. `supabase db push` applies only the migrations listed in `supabase/migrations/` in filename order and never drops or recreates existing data.

In **Edge Functions → Secrets**, set `OPENAI_API_KEY` and `APP_ORIGIN` (use your production app origin; `http://localhost:5173` for local development). `OPENAI_MODEL` is optional and defaults to `gpt-4o-mini`. Supabase provides the function-side URL, anon key, and service-role key in its hosted Edge runtime. Both AI functions require the service-role key: `generate-roadmap` saves its result for the caller's verified active goal, and `coach-chat` saves the caller's assistant reply. Neither function returns or logs the key. For local or self-hosted Edge Functions, configure the service-role key in the server-side function environment.

Never put AI provider keys or service-role/secret keys in `.env`, any `VITE_` variable, source control, browser code, or chat. The app does not use seeded personal progress.

## Implemented

- Protected Supabase signup, login, password recovery, restored sessions, and sign-out.
- Responsive, dark-first app navigation and distinct views for overview, goals, roadmaps, missions, AI coaching, learning, insights, and account settings.
- Supabase-backed goal creation, editing, status changes, deletion, and user-set progress.
- Roadmap generation through an authenticated Edge Function. The function loads the caller's saved active goal, validates the AI result, and saves it server-side using a request ID to avoid duplicate records when a response needs to be retried. Stage actions can be tracked or added to today's missions.
- Daily missions and a database RPC that grants each completion reward at most once. Streaks use consecutive UTC calendar dates; one mission grants 20 XP.
- AI coach through a separate authenticated Edge Function, with a 20-request daily limit and saved private conversation history. Browser clients can save only their own user messages; assistant replies are written by the verified Edge Function.
- Three built-in practical learning paths with account-persisted lesson completion. Lessons do not award XP.
- Insights and achievements derived from actual database records.

Deleting a goal unlinks its roadmaps and missions rather than deleting those saved records. The app confirms this behavior before deletion.

The app hides account data and offers a retry if a required query fails; it does not present failed queries as genuine empty progress. The migrations and functions still require local review, remote application/deployment approval, and server-side AI secret configuration. No remote database or production configuration is changed automatically.

The last read-only check of the configured Supabase project found Auth reachable, but PostgREST returned `PGRST205` for every ACHIEVE table and both Edge Function routes returned HTTP 404. The database schema and functions therefore could not be end-to-end verified; confirm the migrations are applied, the `public` schema is exposed, and the functions are deployed.

The checked-in test suite covers progress calculations, learning-path lookups, and coach message ordering. It does not verify live authentication, database access, RLS behavior, AI responses, or deployed functions. The Supabase Auth health endpoint responded using the configured publishable key, but that is not an end-to-end account or database test. Use a Deno-enabled environment to type-check both function files before deployment:

```powershell
deno check supabase/functions/coach-chat/index.ts
deno check supabase/functions/generate-roadmap/index.ts
```

## Validation

```powershell
npm run lint
npm test
npm run build
```

Deno is additionally used for the Edge Functions and the database migrations. Install it with `irm https://deno.land/install.ps1 | iex`, then:

```powershell
npm run typecheck:functions
npm run test:migrations
```

`npm run test:migrations` applies every file in `supabase/migrations/` to an in-process Postgres build, then asserts the coach message ordering, the learning progress unique constraint, the grants the Edge Functions rely on, and that row level security keeps one user's coach messages private. It touches no remote project.

It also covers the profile integrity rules: the display-name and focus length limits, the rejection of a missing value, the signup trim for an over-long Auth display name, the `updated_at` trigger, the grants the settings form upsert needs, that a signed-in user can save their own profile but cannot write another user's, and that re-running the profile integrity migration trims an over-long row and still applies cleanly.
