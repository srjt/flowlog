# Migrations & schema reconciliation

How to keep the production database in sync with `supabase/migrations/`, and how
to recover when it drifts. Written after a real incident (see
[Worked example](#worked-example-the-feedback_reason-drift)) where a column the
app wrote every feedback save (`feedback_reason`) had never been applied to prod,
so **every** feedback write silently failed.

> **TL;DR for day-to-day:** never change the production schema by pasting SQL
> into the dashboard. Add a new numbered file in `supabase/migrations/` and run
> `supabase db push`. That applies pending migrations **and** reloads the API
> cache. The dashboard SQL editor does neither for the migration history.

---

## The mental model: three things that can disagree

Drift happens because there are **three** separate records of "the schema", and
they can fall out of sync:

1. **The migration files** — `supabase/migrations/00N_*.sql` in this repo. The
   intended schema. The source of truth.
2. **The remote migration history** — the `supabase_migrations.schema_migrations`
   table in the prod database. A list of which migration **versions** the CLI
   believes have been applied. The CLI derives a version from the leading digits
   of the filename (`003_feedback_reason.sql` → version `003`).
3. **The actual database schema** — the real columns, tables, policies, and
   functions in Postgres.

`supabase db push` compares (1) against (2) and runs whatever's missing. But it
**never checks (3)**. So the history table can say "003 applied" while the column
from 003 doesn't exist — that's exactly the incident below. And applying SQL by
hand in the dashboard changes (3) without touching (2), producing the opposite
drift.

**Two failure signatures we've hit:**

- `db push` → `Remote migration versions not found in local migrations directory`
  — the history table (2) lists a version with no matching file (1).
- `db push` → `Remote database is up to date` **but a column is still missing** —
  the history table (2) claims applied, but the schema (3) never got it.
- App write fails with `PGRST204 … Could not find the '<col>' column … in the
  schema cache` — either the column is genuinely missing from (3), **or** it
  exists but PostgREST's API cache is stale (fixed by `notify pgrst`).

---

## Prerequisites

- Supabase CLI (`npx supabase --version`, ≥ 2.x).
- The project ref: **`ufxsnyymhwazgvyjkxdw`** (the subdomain of
  `EXPO_PUBLIC_SUPABASE_URL`, also visible in the dashboard URL). Non-secret.
- Dashboard access (SQL editor) for the schema checks.
- **Docker is NOT required** for reconciliation. `supabase migration list`,
  `supabase migration repair`, and `supabase db push` talk to the **remote** DB.
  (`supabase db pull` / `supabase db diff` need Docker for a local shadow DB —
  you don't need them here.)

Link the project once (prompts for the DB password — from the dashboard, Project
Settings → Database):

```bash
npx supabase link --project-ref ufxsnyymhwazgvyjkxdw
```

---

## Part 1 — Assess

### 1a. Compare files vs remote history

```bash
npx supabase migration list
```

Read the three columns (`Local | Remote | Time`):

- A row with **Local + Remote** → the CLI thinks that version is applied.
- **Local, no Remote** → a file that hasn't been marked applied on prod.
- **Remote, no Local** → a version recorded on prod with no file here (the
  "versions not found" error).

### 1b. Verify the ACTUAL schema (do not trust history alone)

`migration list` only reflects the history table (2), which lied in our incident.
Confirm the real columns in the **dashboard SQL editor**:

```sql
select
  (select count(*) from information_schema.columns where table_name='sessions'  and column_name='feedback_reason')     as feedback_reason,
  (select count(*) from information_schema.columns where table_name='sessions'  and column_name='feedback_note')       as feedback_note,
  (select count(*) from information_schema.columns where table_name='sessions'  and column_name='client_session_id')   as client_session_id,
  (select count(*) from information_schema.columns where table_name='profiles'  and column_name='onboarding_complete') as onboarding_complete,
  (select count(*) from information_schema.tables  where table_name='client_events')                                   as client_events_table;
```

Every value should be `1`. Any `0` is real drift to fix in Part 2.

For a fuller picture, list everything the migrations should have created:

```sql
-- all columns the app depends on
select table_name, column_name
from information_schema.columns
where table_schema = 'public'
  and table_name in ('sessions','profiles','user_trends','client_events')
order by table_name, ordinal_position;

-- RLS policies (001 + 005)
select tablename, policyname from pg_policies where schemaname in ('public','storage');
```

Cross-check against the `supabase/migrations/*.sql` files.

---

## Part 2 — Make the real schema correct

Fix **schema (3)** before touching history. Apply only what's missing. The
column adds below are **idempotent** (`if not exists`) — safe to run even where
the column already exists — so this block is safe to paste wholesale in the
dashboard SQL editor:

```sql
-- Columns every feedback / session write depends on (003, 004, 005, 006).
alter table public.sessions add column if not exists feedback_reason text;
alter table public.sessions add column if not exists feedback_note text;
alter table public.sessions add column if not exists client_session_id uuid;
alter table public.profiles add column if not exists onboarding_complete boolean not null default false;

-- Reload the PostgREST API cache so the new columns are usable immediately
-- (dashboard SQL does NOT do this automatically; db push does).
notify pgrst, 'reload schema';
```

> ⚠️ **Do NOT blindly re-run whole migration files during recovery.** Some
> statements are not idempotent or carry data effects:
> - `create policy …` errors if the policy already exists — guard with
>   `drop policy if exists "<name>" on <table>;` first, then re-create.
> - `004_onboarding_complete.sql` contains a one-time **backfill**
>   (`update public.profiles set onboarding_complete = true`). Re-running it
>   would mark *every* profile onboarded, including brand-new users mid-onboarding.
>   Only run the backfill on the very first application — never during recovery.
>
> For missing **tables / policies / triggers**, apply just that migration's DDL
> by hand, guarding the non-idempotent statements.

---

## Part 3 — Reconcile the history table

Now make **history (2)** agree with reality so `db push` behaves. Use
`supabase migration repair`, which edits `schema_migrations` **without running
any SQL**:

| Situation | Action |
| --- | --- |
| Migration's effects **are present**, history doesn't list it | `supabase migration repair --status applied <version>` |
| History lists a version with **no local file** | Restore the file, **or** `supabase migration repair --status reverted <version>` |
| History says **applied** but the effect is **missing** (the phantom) | `supabase migration repair --status reverted <version>`, then `supabase db push` re-runs the file for real |

Versions are the leading digits, space-separated for several at once:

```bash
# Example: declare the base migrations applied because their schema already exists
npx supabase migration repair --status applied 001 002 003 004 005 006
```

Pick `applied` vs `reverted` based on **Part 1b (actual schema)**, not on what
history currently claims.

---

## Part 4 — Verify it's genuinely in sync

```bash
npx supabase migration list   # every local file has a matching Remote entry, nothing extra
npx supabase db push          # should print: "Remote database is up to date."
```

Then re-run the **Part 1b** `information_schema` query — every value `1`. Both
must pass: `db push` "up to date" proves history agrees; the schema query proves
reality agrees. (The incident is precisely the case where the first passed and
the second didn't.)

---

## Part 5 — Reload the API cache (if you applied SQL by hand)

`supabase db push` reloads PostgREST automatically. If in Part 2 you added
columns via the dashboard, reload it explicitly so the API stops returning
`PGRST204`:

```sql
notify pgrst, 'reload schema';
```

(Alternatively: Dashboard → Project Settings → API → **Reload schema cache**, or
restart the project.)

---

## Ongoing workflow — how to not drift again

1. **Every schema change is a new migration file.** Never edit an existing
   migration (see `docs/DATABASE.md`); add `00N_description.sql`.
2. **Apply with `supabase db push`, never the dashboard SQL editor.** `db push`
   updates history **and** reloads the API cache. Manual SQL does neither and is
   how this drift started.
3. **End column/table migrations with a cache reload** as belt-and-suspenders:
   ```sql
   notify pgrst, 'reload schema';
   ```
4. **After any migration, run the Part 1b verify query** to confirm reality
   matches — cheap insurance against a silent phantom.
5. Consider a CI check that applies `supabase/migrations/` to a throwaway
   database and fails on error, so drift is caught before release.

---

## Worked example: the `feedback_reason` drift

Symptom: users tapped 👎 and typed a note; the app showed "Saved ✓" but nothing
persisted — `feedback_note` (and thumbs/reason) stayed NULL.

Diagnosis (via the app's `client_events` logging): the feedback `UPDATE` writes
`thumbs_up` + `feedback_reason` + `feedback_note` in one statement and failed
with:

```
PGRST204 — Could not find the 'feedback_reason' column of 'sessions' in the schema cache
```

Root cause: `003_feedback_reason.sql` had **never been applied** to prod (while
`005`/`006` had — `client_events` and `feedback_note` existed). Because the write
is one atomic UPDATE, the single missing column failed the whole thing, so
thumbs/reason/note had all been failing since 👎-reasons shipped. The truthful
"Saved/error" state added later is what finally surfaced it.

Fix:

```sql
alter table public.sessions add column if not exists feedback_reason text;
notify pgrst, 'reload schema';
```

Prevention: this runbook — reconcile history and schema, then apply future
migrations via `supabase db push` instead of by hand.
