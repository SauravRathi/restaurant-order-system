# Database — setup and operation

Session 3 of [`docs/plan.md`](../docs/plan.md): the schema in [`docs/schema.md`](../docs/schema.md),
applied to a real PostgreSQL, seeded, and checked.

```
backend/
  migrations/001_init.sql      tables, enums, indexes, append-only + updated_at triggers
  migrations/002_lockdown.sql  Supabase-specific: RLS on, anon/authenticated revoked
  seed/001_demo.sql            demo restaurant — 4 users, 19 menu items, ~67 orders
  scripts/migrate.mjs          applies pending migrations, records them in schema_migrations
  scripts/seed.mjs             truncates and re-seeds; prints the resulting numbers
  scripts/verify.mjs           tries to break every rule schema.md says the database enforces
  scripts/reset.mjs            drops everything (dev only, --force)
  src/db.js                    the connection pool
```

## One-time setup

**1. Create the Supabase project.** [supabase.com/dashboard](https://supabase.com/dashboard) → *New
project*. Pick the region closest to the API host (Render's free region, or `ap-south-1` if the
restaurant is the timezone this seed assumes). Save the database password it generates — the
dashboard will not show it again.

**2. Get both connection strings.** *Project Settings → Database → Connection string*, and copy
them rather than typing them; the pooler hostname contains a region that differs per project.

| Which | Port | Used for | Why |
|-------|------|----------|-----|
| Transaction pooler | 6543 | `DATABASE_URL` — the running API | A connection per transaction, which is what a mostly-idle free web service should hold |
| Session pooler | 5432 | `DIRECT_URL` — migrations, seed, verify | Migrations take a session-level advisory lock, which transaction mode cannot hold |
| Direct (`db.<ref>.supabase.co`) | 5432 | nothing, here | IPv6-only, and Render's free tier has no IPv6 |

**3. Fill in the environment.**

```bash
cd backend
cp .env.example .env      # PowerShell: copy .env.example .env
npm install
```

Then edit `backend/.env`. It is gitignored; the brief requires connection strings to live in
environment variables and never in the repository.

**4. Build the database.**

```bash
npm run db:migrate && npm run db:seed && npm run db:verify
```

Expected tail of that run:

```
Demo data (restaurant timezone Asia/Kolkata):
  users            4
  live_menu_items  18
  orders           67
  open_orders      5
  placed_today     9
  served_today     3
  revenue_today    3750.00
  order_lines      235
  timeline_events  564
```

and `verify` reporting `22 passed, 0 failed`.

If you would rather not run anything locally, the two migration files and the seed can be pasted
into the Supabase SQL editor in order — they are written to be idempotent and to manage their own
transactions for exactly that reason. You lose the `schema_migrations` bookkeeping, which
`migrate.mjs` would otherwise fill in.

## Day to day

| Command | What it does |
|---------|--------------|
| `npm run db:status` | Which migrations have been applied |
| `npm run db:migrate` | Apply pending ones; safe to re-run |
| `npm run db:seed` | Truncate and rebuild the demo data |
| `npm run db:verify` | Assert the database still enforces what the docs claim |
| `npm run db:reset -- --force` | Drop every object (dev only) |
| `npm run db:rebuild` | reset → migrate → seed → verify |

Adding a migration means adding `003_*.sql`; migrations are never edited once applied.

## Things worth knowing before they bite

**`verify.mjs` is not the test suite.** It is the evidence for one column of the table in
`schema.md`: every rule listed as living *in the database* gets attempted there from a privileged
connection and has to fail. A rule that only holds because the API is polite does not belong in
that column. It includes the two statements that matter most for §9 — `UPDATE` and `DELETE` on
`order_timeline` — plus `TRUNCATE`, which is a separate privilege and fires a different trigger, so
it needed its own guard. Without that second trigger the single statement that erases all of
history would have been the one the design missed.

**The seed turns those triggers off for a moment.** It has to, because it truncates. That is a
development-only escape hatch: it needs table ownership, it is re-enabled in the same transaction
so a failure rolls the disable back with it, and nothing the API can execute has that privilege.
It is also the reason the seed lives in `seed/` and not in `migrations/`.

**RLS is on and every table is revoked from `anon`/`authenticated` (`002_lockdown.sql`).**
Supabase would otherwise publish all six tables over PostgREST to a key that ships in browser
code, which would quietly contradict §1's "enforced on the server, not hidden in the interface".
The API connects as the table owner and bypasses RLS, so nothing changes for us. `FORCE ROW LEVEL
SECURITY` is deliberately *not* used — it would lock the owner out too.

**Extensions live in the `extensions` schema, not `public`** (Supabase convention). That means
`citext`'s `=` operator and `gin_trgm_ops` are resolved through `search_path`, which is set in
three places for three different failure modes: `SET LOCAL` inside the migration, `ALTER DATABASE`
for future connections, and `options: -c search_path=...` on the pool in `src/db.js` for the case
where the app connects as a role with its own default.

**Money and ids come back as strings.** `src/db.js` pins the `NUMERIC` and `INT8` parsers
explicitly. `NUMERIC(10,2)` exists so money never becomes a float; parsing it into one on the way
out would undo that in the one place nobody looks.

**Free tier.** The project pauses after about a week with no connections and the first request
after that is slow — worth a line in `SUBMISSION.md` alongside the Render cold start, so a slow
first load is not read as a broken deployment.

## Demo credentials

Seeded by `seed/001_demo.sql`, hashed with bcrypt via pgcrypto. These are throwaway values that
belong in `SUBMISSION.md`; real accounts are created by a manager through `POST /users`.

| Role | Email | Password |
|------|-------|----------|
| Manager | `manager@demo.test` | `Manager@123` |
| Waiter | `arjun@demo.test` | `Waiter@123` |
| Waiter | `meera@demo.test` | `Waiter@123` |
| Waiter | `ravi@demo.test` | `Waiter@123` |

## What the seed is set up to show

Each of these exists because a goal needed something to point at, not to pad the numbers:

- **§2** an archived order (`T15`) that is out of the active queue with its history intact.
- **§3** lines with special instructions, and price snapshots — doubling every menu price changes
  no existing order's total.
- **§4** orders resting in every status including `cancelled`, and a voided line on `Patio 1` with
  the reason *"Kitchen out of fish; guest switched to Butter Chicken"*.
- **§5** collaborators on three orders, so "every order where I am primary **or** a collaborator"
  returns something different from "my orders".
- **§6** ~67 orders over 14 days across 16 tables and three waiters, including `Bar` and `Patio 3`,
  so search, filters and pagination have real work to do.
- **§8** revenue and counts for today, and a served-per-day series with no empty days.
- **§9** ~564 timeline events written with the timestamps the events would have had.
- **§10** `T12` open 48 minutes and unacknowledged, so the alert fires; `T4` equally slow but
  acknowledged two minutes ago, so it stays suppressed until the repeat window elapses.

Deterministic: the same seed produces the same demo, so a screenshot keeps matching the live site.
