# Project context

Read this first. It replaces re-explaining the project at the start of a session.

## What this is

Assignment 09 — a restaurant order system replacing paper tickets on a corkboard. Full brief in
[`README.md`](README.md); it is the recruiter's document, not mine, and its ten numbered goals are
the scope. References written as **§1**–**§10** anywhere in `docs/` point at those goals.

What is actually assessed: **judgement**, evidenced by the record of decisions and trade-offs. A
working app is the floor. Code structure and readability count for a small share. Git history is
scored explicitly — a single "initial commit" containing a finished app scores zero on it.

Budget ~12 h total. Ten goals are the cutoff; stretch ideas do not substitute for a goal. Eight
goals done well beats ten done badly.

AI use is encouraged and not penalised, but everything must be explainable. `docs/ai-prompts.md`
must record the prompts actually used, including ones that produced bad output.

## Current state

| Session | What | Status |
|---------|------|--------|
| 1 | Design — entities, tables, SQL vs NoSQL → Postgres | Done (~3 h) |
| 2 | Actions → API surface, the five required docs | Done (~4 h) |
| 3 | Database: migrations, seed, verification | Done — live on Supabase, `db:verify` 22/22, committed as twelve commits on `session-3` and merged into `main` |
| 4 | Backend — Express API on `pg` | Done — 26 routes, CORS, `npm test` 66/66 |
| 5 | Frontend | Not started |
| 6 | Deploy + submit | Not started |

**What exists on disk:** `docs/` (six files), `README.md`, `SUBMISSION.md`, `.claude/settings.json`,
and `backend/` — migrations, seed, `scripts/`, `src/` (22 files), `tests/` (five suites plus
helpers). `backend/.env` is filled in and working. **No frontend yet.**

**The database is live.** Schema applied, demo data seeded, `db:verify` green.


## Stack

Mark every technology one of two ways, and never state an unmade choice as settled:

- **Decided** — PostgreSQL, Node + Express 5, React + Vite + React Router, hand-written SQL via
  `pg`, numbered SQL migrations. Three tiers: browser → API → database, one direction of traffic, no
  background workers. Supabase for the database, Render for the API. For auth: `bcryptjs` for
  password hashing, `jsonwebtoken` (HS256) for tokens, `zod` for payload validation.
- **Candidate** — the frontend host (Vercel is the placeholder), the server-state library, the
  charting library.

Why those three auth libraries, so they are explainable: `bcryptjs` is pure JavaScript, so there is
no native module to compile on Render's free tier, and bcrypt hashes are portable — the `$2a$`
strings pgcrypto wrote in the seed verify fine in Node. `jsonwebtoken` because `JWT_SECRET` and
`JWT_EXPIRES_IN` were already the assumed shape and `jose` carries more API surface than this needs.
`zod` because the `422` vs `409` split requires every route to reject a malformed payload *before*
any business logic runs.

Those three are the only runtime dependencies added beyond `express` and `pg`. CORS and CSV writing
are hand-written, and the tests use Node's built-in `node:test`, so nothing else was installed.

Database is Supabase Postgres in `ap-south-1`. Two connection strings, not interchangeable:
transaction pooler (6543) as `DATABASE_URL` for the API, session pooler (5432) as `DIRECT_URL` for
migrations. The direct `db.<ref>.supabase.co` string is IPv6-only and unusable from Render's free
tier. Copy pooler strings from the dashboard rather than typing them — this project's host prefix is
`aws-0-`, not `aws-1-`.

## Deployment — settled, not yet executed

Render for the API, **Singapore region**. Not Oregon: the database is in Mumbai, and Oregon adds
roughly 220 ms per query each way where Singapore adds about 60 ms. A dashboard request running four
queries feels that difference.

Render can only deploy from a git repo it can clone or a container image it can pull — there is no
upload path — so the deploy test is blocked on the repo being pushed, and nothing else.

| Setting | Value |
|---------|-------|
| Root Directory | `backend` |
| Build Command | `npm install` |
| Start Command | `npm start` |
| Health Check Path | `/health` |

Environment variables to set in Render's dashboard: `DATABASE_URL` (the 6543 pooler string),
`PGSSL_REJECT_UNAUTHORIZED=false`, `PGPOOL_MAX=5`, `RESTAURANT_TZ=Asia/Kolkata`,
`SLOW_ORDER_MINUTES=20`, `ALERT_REPEAT_MINUTES=10`, `JWT_SECRET`, `NODE_ENV=production`, and
`CORS_ORIGINS` set to the deployed frontend's origin. `DIRECT_URL` is deliberately **not** set there
— nothing on Render runs migrations, and `connectionString()` falls back to `DATABASE_URL`. One less
secret on the host.


The database password is currently only in `backend/.env`. Rotate it in the Supabase dashboard when
setting the Render variables, so the live credential was never anywhere else.


## Where things live

| File | Holds |
|------|-------|
| [`docs/architecture.md`](docs/architecture.md) | Three pieces, hosting, the Decided/Candidate convention, HLD Mermaid diagram, the create-order request path end to end |
| [`docs/schema.md`](docs/schema.md) | Six tables, three enums, relationships, database-vs-application constraints, denormalisation, 100× analysis |
| [`docs/api.md`](docs/api.md) | Authorization model, every action by actor, transition matrix, alert predicate, derived endpoints. **Auxiliary — not one of the five required docs** |
| [`docs/decisions.md`](docs/decisions.md) | Six decisions, chronological, most consequential first within a sitting |
| [`docs/plan.md`](docs/plan.md) | Session table, build order and why, cut list, and a **Notes** section logging each session |
| [`docs/ai-prompts.md`](docs/ai-prompts.md) | Prompts in order: aim / asked / result / kept-changed |
| [`backend/README.md`](backend/README.md) | Supabase setup, the `db:*` commands, demo credentials, what the seed demonstrates and why |

The five files the brief requires are architecture, schema, plan, decisions, ai-prompts. `api.md` is
extra.

Inside `backend/`:

| File | Holds |
|------|-------|
| `src/db.js` | The pool. The only place that knows how to reach Postgres. Pins `NUMERIC`/`INT8` to strings so money never becomes a float, and exports `withTransaction` |
| `src/app.js` | The Express app — CORS first, then the body parser, then the routers, then the 404 throw, then `errorHandler` last |
| `src/server.js` | Entry point: loads `.env` if present, binds `0.0.0.0:$PORT`, closes the pool on `SIGTERM` |
| `src/http/errors.js` | `ApiError` and `errorHandler` — the only place a status code is chosen |
| `src/http/validate.js` | `parseBody`, `parseQuery`, `parseId`, `idSchema` |
| `src/http/cors.js` | Hand-rolled CORS: allowlist from `CORS_ORIGINS`, preflight answered before routing |
| `src/auth/` | `password.js`, `tokens.js`, `middleware.js` (`requireAuth`, `requireRole`), `routes.js`, and `visibility.js` — the order visibility predicate, written once |
| `src/users/` | `routes.js`, `serialize.js` (`userColumns` narrows the SELECT by role) |
| `src/menu/` | `routes.js` (including the §7 bulk update), `serialize.js` |
| `src/orders/` | `routes.js`, `queries.js` (reads + `recordEvent`), `serialize.js`, `lifecycle.js` (the transition matrix), `csv.js` |
| `src/alerts/` | `predicate.js` (the §10 rule as a SQL fragment), `routes.js` |
| `src/dashboard/routes.js` | §8, four queries issued together |
| `tests/` | `helpers.mjs` plus `auth`, `orders`, `menu`, `alerts-dashboard`, `cors-export` suites — 66 tests |
| `migrations/001_init.sql` | Six tables, three enums, indexes, the append-only and `updated_at` triggers |
| `migrations/002_lockdown.sql` | Supabase-only: RLS on, `anon`/`authenticated` revoked including default privileges. A no-op on plain Postgres |
| `seed/001_demo.sql` | The demo restaurant. Disables the append-only triggers only to `TRUNCATE`, inside the transaction that re-enables them |
| `scripts/*.mjs` | `migrate`, `seed`, `verify`, `reset`, and `_env.mjs` which they share |

## Design rules already settled — do not re-litigate

**Visibility equals actionability.** One predicate covers reading and writing: manager, primary
waiter, or collaborator. A waiter cannot *see* an order they are not part of, and alerts are scoped
the same way. Managers see everything. **This is final.**

**Failure codes.** `403` for capabilities the role lacks (leaks nothing — they know the route
exists). `404` for objects that are not theirs (order IDs are sequential; `403` would confirm which
exist). `409` for state-rule violations, `422` for invalid payloads, `401` unauthenticated.

**The client sends intent; the server supplies context.** Identity comes from the token, never from
the request body. A client may name *other* people as the object of an action (adding a collaborator)
but may never name itself as the actor. This is what makes the timeline's `actor_id` trustworthy —
the append-only trigger stops history being *edited*, token-derived actors stop it being *forged*.
§9 needs both.

**Every write is two writes** — the change plus its timeline entry — in one transaction. Either both
land or neither does.

**Dashboard** is restaurant-wide for both roles. **CSV export** is manager-only.

**Archiving** only from terminal states (Served, Cancelled). A deliberate narrowing of §2; belongs in
`SUBMISSION.md` as a stated reading.

**Menu items and orders are archived, never deleted.** Old order lines still reference them.

**Line price and name are snapshotted** onto the line at add time.


## The API as built

The paths in [`docs/api.md`](docs/api.md) were always meaningful placeholders. **The code is the
source of truth**; that file gets reconciled to it later. These are the real routes.

Sign in with `POST /auth/login`, then send `Authorization: Bearer <token>` on everything else.
Tokens are HS256, carry `{sub, role, name}`, last 12 h, and cannot be revoked — signing out is a
client-side discard. A JWT is signed, not secret: its payload is readable by anyone holding it.

Every failure has the same shape: `{ "error": "<sentence>", "code": "<SCREAMING_SNAKE>", "details":
[…] }`, where `details` appears only on a 422 and lists `{ field, message }` for every problem at
once. Codes: `401` unauthenticated, `403` your role lacks the capability, `404` the object is not
yours or absent, `409` a state rule, `422` the payload parsed but is wrong, `400` the body was not
JSON.

| Method | Path | Who | Returns |
|--------|------|-----|---------|
| `POST` | `/auth/login` | anonymous | `{ token, user }` |
| `GET` | `/auth/me` | any | `{ user }` — re-read from the database |
| `GET` | `/users?role=` | any | `{ users }` — waiters get `id`, `displayName`, `role` only |
| `POST` | `/users` | manager | `201 { user }` |
| `GET` | `/menu-items?includeArchived=` | any | `{ menuItems }` — the flag is ignored for waiters |
| `POST` | `/menu-items` | manager | `201 { menuItem }` |
| `PATCH` | `/menu-items/:id` | manager | `{ menuItem }` — at least one field required |
| `POST` | `/menu-items/:id/archive` · `/restore` | manager | `{ menuItem }` |
| `POST` | `/menu-items/bulk` | manager | `{ summary, results }` — always 200, §7 |
| `GET` | `/orders` | scoped | `{ orders, page }` |
| `POST` | `/orders` | any | `201 { order }` — `{ tableNumber }` only |
| `GET` | `/orders/:id` | scoped | `{ order }` with `lines`, `collaborators`, `total` |
| `GET` | `/orders/:id/timeline` | scoped | `{ timeline }` |
| `POST` | `/orders/:id/status` | scoped | `{ order }` — `{ status }`, `placed` not accepted |
| `POST` | `/orders/:id/lines` | scoped | `201 { order }` — `{ menuItemId, quantity, instructions? }` |
| `POST` | `/orders/:id/lines/:lineId/void` | scoped | `{ order }` — `{ reason }`, non-blank |
| `POST` | `/orders/:id/collaborators` | scoped | `201 { order }` — `{ userId }`, must be a waiter |
| `POST` | `/orders/:id/notes` | scoped | `201 { timeline }` — `{ note }` |
| `POST` | `/orders/:id/archive` · `/restore` | scoped | `{ order }` |
| `POST` | `/orders/:id/alert/ack` | scoped | `{ order }` — 409 if not alerting |
| `GET` | `/orders/export` | manager | `text/csv`, BOM, `Content-Disposition` exposed |
| `GET` | `/alerts` | scoped | `{ thresholds, alerts }` — oldest first |
| `GET` | `/alerts/count` | scoped | `{ count }` — poll this, not `/alerts` |
| `GET` | `/dashboard` | any | `{ timezone, headlines, byStatus, byWaiter, servedPerDay }` |
| `GET` | `/health` · `/health/db` | anonymous | liveness · readiness |

"scoped" means manager, primary waiter, or collaborator — and anything else is **404**, never 403.

`GET /orders` accepts `q`, `status` (repeatable), `waiterId`, `dateFrom`, `dateTo`,
`scope=mine|all`, `sort=placedAt|status|tableNumber`, `order=asc|desc`, `page`, `pageSize` (max
100), `includeArchived`. It answers `{ page: { page, pageSize, total, totalPages } }` alongside the
rows, and the total stays correct past the last page. An unknown parameter is a 422.


## Commands

```bash
cd backend && npm start          # API on :4000
cd backend && npm run dev        # same, with --watch
cd backend && npm test           # 66 API tests against the live database, ~35 s
```

`npm test` starts the app in-process on an ephemeral port and runs against the real Supabase
database, because what it is testing is what the API and the database produce together. It leaves
its fixtures behind — see the append-only note above — so `npm run db:seed` resets the demo when the
accumulation gets untidy. `--test-concurrency=1` keeps five suites from opening five pools at once.

`db:verify` asserts what the **database** enforces; `npm test` asserts what the **API** enforces.
Both exit non-zero on failure.

Database: `db:migrate`, `db:seed`, `db:verify`, `db:status`, `db:reset -- --force`, `db:rebuild`
(reset → migrate → seed → verify). `db:verify` asserts the database still enforces what `schema.md`
claims it enforces — **22 checks**, and it exits non-zero on failure, which is what makes
`db:rebuild`'s `&&` chain meaningful.

`seed` and `reset` both refuse to run under `NODE_ENV=production`; `reset` refuses even with
`--force`, because seeding production is recoverable and dropping its schema is not.

Adding a migration means adding `003_*.sql`. Migrations are never edited once applied.

## How each piece gets built

One piece at a time, checked against the live database before the next one starts. Exercise the rule
the piece exists for, not just that it answers at all: a waiter who is not on an order gets nothing
back, a line keeps its price when the menu changes behind it, an acknowledged alert returns once its
window elapses.

Never record a piece as working without having run it. `npm test` and `db:verify` both exit non-zero
on failure, so "it passed" means an exit code, not a reading of the source.
