# Submission

## Links

- **GitHub repository:** https://github.com/SauravRathi/restaurant-order-system
- **Live application:** https://busy-with-orders.onrender.com
- **API:** https://busy-with-orders-api.onrender.com

## Notes for the reviewer

- Both services are on Render's free tier, which sleeps when idle. **The first request after a quiet
  period takes up to a minute** — the page loads immediately, because the browser client is static,
  but the first action that needs data will sit there while the API wakes. Everything after that is
  normal.

- Sign in as the manager to see everything. A waiter sees only the orders they created or were added
  to.

- The demo data is anchored to the moment it was seeded rather than to fixed dates, so the
  slow-order alerts in goal 10 are always live rather than expired. An order starts alerting once it
  has been open **20 minutes** without reaching Ready. Dismissing an alert silences that order for
  **10 minutes** and then it alerts again — dismissing is a snooze, table is still waiting.

## Demo credentials

| Role | Email | Password |
|------|-------|----------|
| Manager | `manager@demo.test` | `Manager@123` |
| Waiter | `arjun@demo.test` | `Waiter@123` |
| Waiter | `meera@demo.test` | `Waiter@123` |

The sign-in page has **Manager** and **Waiter** buttons that fill the form and sign you in, so none
of this needs typing. They use the first two rows; the third is there if you want a second waiter,
to see that neither can act on the other's orders.

## Stack

| Layer | What you used | Why |
|-------|---------------|-----|
| Frontend | React, Vite, React Router, TanStack Query, Recharts | TanStack Query because almost all of this app's state is server state — caching, refetch on focus and the alert polling are its job, not mine |
| Backend | Node, Express 5, `pg` with hand-written SQL, `zod`, `jsonwebtoken`, `bcryptjs` | The queries here are aggregates and joins rather than fetch-a-row, so an ORM would mean writing the SQL anyway, inside another language — [Decision 8](docs/decisions.md#decision-8--hand-written-sql-no-orm-no-migration-framework) |
| Database | PostgreSQL on Supabase, `ap-south-1` | Fixed schema, densely related entities, low volume — [Decision 1](docs/decisions.md#decision-1--choosing-the-database-model) |
| Hosting | Render — static site for the client, web service for the API, Singapore | Render's free tier runs both halves, the site and the API server. Both in same place for free. |

React, Express and Node are three quarters of MERN, which is the stack I have learned. Mongo is the
part I replaced, and that was the first real decision on the project:
[Decision 1](docs/decisions.md#decision-1--choosing-the-database-model).


## Goal checklist

| # | Goal | Status | Notes |
|---|------|--------|-------|
| 1 | Accounts and roles | Done | Enforced server-side. A waiter calling a manager route gets 403 whatever the UI shows |
| 2 | Orders | Done, with a stated reading | Archiving is restricted to Served and Cancelled orders, so a waiter cannot archive something the kitchen is still cooking. The brief does not say when archiving is allowed — [Decision 6](docs/decisions.md#decision-6--archiving-is-restricted-to-terminal-states) |
| 3 | Order lines | Done | Price and name are copied onto the line when it is added, so a later menu change cannot rewrite a served order's total |
| 4 | Order lifecycle with rules | Done | The transition matrix lives in one file and the API sends each order its own `allowedNextStatuses`, so the buttons come from the server rather than a second copy of the rules |
| 5 | Collaborators | Done | A join table for collaborators (many-many). It records who added whom, and the database refuses duplicates |
| 6 | Finding orders | Done | Text search, status, waiter, date range and paging, all as one SQL query. Visibility is a `WHERE` clause, never a filter applied after loading |
| 7 | Acting on many menu items at once | Done, widened | Price, availability and archiving in any combination, reported per field per item. The brief asks for one change at a time; the reasoning for widening it is [Decision 12](docs/decisions.md#decision-12--the-bulk-update-takes-any-combination-of-fields) |
| 8 | Dashboard | Done | Four queries issued together. Restaurant-wide for both roles, which is the one read not scoped by visibility |
| 9 | History you cannot rewrite | Done | A database trigger refuses UPDATE and DELETE on the timeline, and the actor comes from the token rather than the request body, so entries can be neither edited nor forged |
| 10 | Slow-order alerts | Done | The rule is one SQL fragment used by both endpoints, and `GET /alerts` returns the thresholds it judged against so the UI never holds a second copy. Both are environment variables (`SLOW_ORDER_MINUTES`, `ALERT_REPEAT_MINUTES`), not constants in the code |

## How much time did you actually spend?

About 16 hours across six sessions: 3 on design, 4 on the API surface and the five documents, 2 on
the database, 3 on the API, 2 on the browser client, 2 on deploying and submitting. The brief
suggests twelve.

The overrun is in the first two sessions, and almost all of it is in the writing rather than the
thinking. Turning the design into five documents took far longer I wanted.
That is the estimate I got worst.

The bet I made was that solid design up front would make the code come quickly afterwards, and that
part held. Sessions 3 to 5 ran close to plan, there was very little debugging, and almost nothing
had to be redesigned while it was being built.

## What would you do next, with another 12 hours?

**A kitchen screen, and a role to go with it.** This is software for a restaurant's staff, and it is
not really finished while the kitchen is not in it. The change is small: another value in the role
enum, a queue of the orders that have been accepted, and one action — moving an order from Preparing
to Ready. The lifecycle already has that step. What it does not have is anyone in the kitchen
allowed to take it, so today a waiter makes the move after being told the food is up, which is the
corkboard problem moved somewhere else.

**Time-of-day pricing for happy hours.** The scenario the brief opens with has a manager changing a
price while the waiters carry on unaware. Restaurants do not really move prices at random — they
move them for a happy hour and move them back. That is the version worth building, and it gives the
bulk update a reason to exist that a real manager would recognise: drop a selection at five, restore
it at seven. It sits on endpoints that are already there.

**Multiple locations.** The one I looked into furthest. It means multi-tenancy — one schema serving
several branches with their data kept apart, and every request carrying the branch it belongs to. It
is also the honest market for this: a single independent restaurant copes on paper, and the places
that would actually buy software like this are the ones with three branches to keep in step.

**The gaps I already know about**, rather than new ones: the table edge case, re-runnable tests for
the browser client, and a screen for creating an account. Each is listed with the reason it did not
get done in [`plan.md` → What I cut](docs/plan.md#what-i-cut-when-i-ran-short).

## What are you least happy with in this codebase, and why?

That the frontend is the least tested part of the system and it is the part a user actually touches.
Every defect in it, a dropped bulk selection, a select that would not open, an alert badge
disagreeing with the page beside it, was found by using the app, not by a check that would catch it
again. The backend has the opposite property, and the difference is not a judgement about where bugs
live. It is where I ran out of budget.

The other is what is not here at all. I expected to reach at least two of the three stretch goals mentioned above. I was wrong about how much room would be left.
