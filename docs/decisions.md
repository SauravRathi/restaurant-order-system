# Decisions

Decisions where a real alternative existed and I picked one, in the order I made them.


---

## Decision 1 — Choosing the Database model

- **Chose:** PostgreSQL.
- **Rejected:** MongoDB — the default for MERN stack (the chosen tech stack for this project)
- **Why:**

  The schema is fixed. No expected field changes. The data is low volume.

  The entities are densely related. Counting the reference edges in
  [`schema.md` → Relationships](schema.md#relationships): order→waiter,
  line→order, line→menu item, line→voider, timeline→order, timeline→actor, timeline→line,
  collaborator→order, collaborator→user, collaborator→adder, order→alert acknowledger. Eleven
  reference edges across six entities. Almost every record's meaning depends on another record, and
  a relational engine captures that directly instead of leaving it to application discipline.

  Two main selling points of a NoSQL DB are its capability to handle variable schema and horizontal scaling.
  My data has a fixed schema and is generated at low volumes. So we don't gain either of the two benefits and we loose referential integrity in exchange. 

---

## Decision 2 — A join table for collaborators, not an array

- **Chose:** `order_collaborators` — a junction table on `(order_id, user_id)` carrying `added_by`
  and `added_at`.
- **Rejected:** An array of user IDs stored on the order row.
- **Why:** The relationship is genuinely many-to-many and gets queried from both directions — "who is
  working on this order" and "which orders am I on". A junction table indexes both cheaply: the
  composite primary key serves the first, a second index on `user_id` serves the second.

  Three things an array cannot do at all, which decided it:

  1. **No referential integrity.** Nothing guarantees an ID in the array corresponds to a real user.
     A foreign key does.
  2. **Nowhere to record who added whom.** The timeline needs `added_by` and `added_at`; an array of
     plain IDs has no room for them.
  3. **No protection against duplicates.** The composite primary key makes adding the same waiter
     twice impossible in the database, rather than a check I have to remember in code.

- **What I am *not* claiming:** that an array could not serve the reverse lookup. Postgres can
  GIN-index an array, so "which orders am I on" would perform acceptably. The three points above are
  the reasons; query speed is not one of them.

---

## Decision 3 — Snapshot the item's price and name onto the order line


- **Chose:** Copy `unit_price` and `item_name` onto `order_lines` at the moment the line is added.
- **Rejected:** Storing only `menu_item_id` and reading the current price and name from `menu_items`
  whenever a total or a receipt is needed.
- **Why:** A transaction record has to capture the terms **at the time of the transaction**. It is
  why invoices store line prices instead of pointing at a product catalogue. 

---

## Decision 4 — Compute the order total on read, don't store it


- **Chose:** Calculate `SUM(quantity × unit_price)` across non-voided lines whenever the total is
  needed.
- **Rejected:** A stored `total` column on `orders`, updated on every change.
- **Why:** Any operation touching a line (adding/voiding) becomes two operations, as we have to separately update the total for the order. Gives us a chance to make a mistake. For such low volumes of data, summing on read is cheaper than keeping a column honest.

---

## Decision 5 — What I denormalised, and what I did not


The full list, with reasoning for each, lives in
[`schema.md` → Deliberate denormalisation](schema.md#deliberate-denormalisation). 

---

## Decision 6 — Archiving is restricted to terminal states


- **Chose:** An order can only be archived once it is Served or Cancelled.
- **Rejected:** Allowing archive at any point in the lifecycle.
- **Why:** The requirement 2 says that orders can be archived and restored, but it does not specify at which stage they can be archived. I am restricting the archive to the terminal states, which is canceled or completed, so that a waiter cannot archive an order that is actively being prepared in the kitchen. 

---

## Decision 7 — One hosted database for development and deployment

- **Chose:** Develop directly against the Supabase database, and deploy against that same
  database.
- **Rejected:** A local PostgreSQL instance during development, switched to a hosted one at
  deployment.
- **Why:**

  Two databases means the thing I test is not the thing I ship.
  [`002_lockdown.sql`](../backend/migrations/002_lockdown.sql) turns on RLS and revokes the
  `anon` and `authenticated` roles; neither role exists on a plain PostgreSQL, where that file
  is written to be a no-op. Developing locally would leave it unrun until deployment, which is
  the last session and has no slack in it. The `extensions` schema and the `search_path`
  handling it forces are Supabase conventions too, and would go equally untested.

  The usual argument for a local database is that it can be destroyed freely. `db:rebuild`
  already does that in one command, and the seed is deterministic, so the hosted database is
  as disposable as a local one would have been.

  Installing PostgreSQL with `citext`, `pg_trgm` and `pgcrypto`, then keeping two environments
  in step, costs time out of a twelve-hour budget and earns nothing the brief asks for.

- **What it costs:** every query is a network round trip, so iterating on SQL is slower than it
  would be locally, and none of it works offline. Neither has mattered — the project sits in
  `ap-south-1`, and I have not needed to work without a connection.

- **When the other choice would be right:** a schema with nothing host-specific in it, or a team
  sharing one database and overwriting each other's seed data. Neither applies here.

---

## Decision 8 — Hand-written SQL: no ORM, no migration framework

- **Chose:** SQL written by hand and sent through `pg`, with the schema kept as numbered `.sql` files.
- **Rejected:** An ORM for the queries, and a migration framework for the schema.
- **Why:**

  The schema is one of the things being assessed, and SQL is the language it is written in. A
  framework puts its own vocabulary between [`schema.md`](schema.md) and what the database actually
  holds.

  An ORM saves real time on repetitive queries like fetch a row, insert a row, change a field. The
  queries here are not those: aggregates, an `OR` across two tables, a fourteen-day series with the
  empty days filled in. For those you end up writing the SQL anyway, inside the ORM, so the project
  carries two languages where one would do.

---

## Decision 9 — Build to the design as written, rather than redesigning while coding

- **Chose:** implement [`api.md`](api.md) as it stood, every action and failure code was settled and documented in session 2. Change it only where building something proved the design wrong.
- **Rejected:** Letting the AI decide or prompt me at each stage for design choices.
- **Why:**

  Sessions 1 and 2 went on design rather than code, and this is what that was for. Every question the
  AI would otherwise have stopped to ask, which failure code, who may act on this order, what
  happens on an illegal move, already had an answer. It wrote logic
  instead of asking me which direction to take the project, and being asked that in the middle of a
  route halts the work every time it happens.

  The coding went ahead uninterrupted and I reviewed
  and tested it afterwards in one pass, rather than supervising a decision at every endpoint.

  It is also what made the tests writable. A test asserting that two 401 responses are byte-identical
  is only possible because someone had already decided they must be.

---

## Decision 10 — Stateless tokens, no session table

- **Chose:** a signed token carrying the user id, role and display name, and no server-side record
  of who is signed in.
- **Rejected:** a `sessions` table written on login and deleted on logout.
- **Why:**

  The token carries what every request needs, so no request costs a session lookup, and signing out
  is the client discarding it.

  What that gives up is early revocation: a stolen token, or one belonging to someone who left at
  2pm, keeps working until it expires. A sessions table would let you delete the row and lock them
  out immediately. But it expires after a shift.

---

## Decision 11 — Row-filtering rules are SQL fragments, not JavaScript checks

- **Chose:** the rule for who may see an order, and the rule for what makes an order slow, are each
  written once as SQL and pasted into every query that needs them.
- **Rejected:** fetching the rows first and deciding in JavaScript.
- **Why:**

  JS has to load the order in order to decide you're not allowed to see it. It's already in memory, one careless log line from leaking.

  Doing it in the query instead means an order you are not on comes back as nothing at all. The
  order you may not see and the order that was never created look identical from outside, so
  nobody can go hunting for other people's tables by trying one id after another and watching
  which ones answer differently.


---

## Decision 12 — The bulk update takes any combination of fields

- **Chose:** `POST /menu-items/bulk` takes price, availability and archiving in any combination, and
  reports each field separately for every item.
- **Rejected:** session 4's rule of exactly one of price or availability, both together refused.
- **Why:**

  §7 asks for "one change to all of them — a new price or a change in availability". Changing the
  price of several food items in one click did not make clear sense: different products would end up
  at the same price. And giving each one its own price option would just be the same as making an
  individual change one at a time.

  I decided on a queue structure for that instead, which is very flexible. You can apply all three
  actions to the same item multiple times and it smartly keeps the last one. The different actions
  do not mess with each other — if you are archiving an item you can still change its price, still
  get the rejected verdict on it, and still change its availability.

  The other half is a §7 fix. The brief names a negative price as its example of a per-item
  rejection, but the price check ran before anything else, we were never able to test that rejection. 

---

- **Reversed from:** session 4, where exactly-one was built and tested. The old rule was
  right that a mixed result would be ambiguous, and wrong to fix it by refusing to allow
  the case.


## Decision 13 — Tables as their own entity, started and abandoned

- **Chose:** Leave the table as a plain text field on the order, the way it was originally designed.
- **Rejected:** A `tables` table with orders pointing at it — which I started building, and then
  backed out of.
- **Why:**

  I had missed tables as an entity in the design phase, and the gap became obvious once there
  was a screen in front of me: nothing stops two live orders on one table, and nothing can offer a
  waiter a list of real tables to choose from. So I began adding it, a table, a foreign key from
  `orders`, seed rows, and the routes to go with it.

  What stopped it was the blast radius. Every test creates orders against invented table names, so
  every test would have had to provision a table first. The seed changed. Order creation changed. It
  arrived with the frontend unfinished and the deployment still ahead, and risking nine goals that
  worked to close one the brief never asks for was the wrong trade at that point.

- **Reversed:** started and reverted inside the same session. None of it was committed, so there is
  no migration `003` in this repository — the record of it is this entry and
  [`plan.md` → What I cut](plan.md#what-i-cut-when-i-ran-short).

---

## Decision 14 — Render for both halves, in Singapore

- **Chose:** Render — a static site for the browser client and a web service for the API, both in
  the Singapore region.
- **Rejected:** a serverless-first host for the API, and a region further from the database.
- **Why:**

  The API is a long-running process that holds a connection pool. `src/db.js` opens one pool and
  keeps it, and `server.js` closes it on `SIGTERM`. A host that runs a function per request would
  open connections per invocation, which is the thing Supabase's transaction pooler and
  `PGPOOL_MAX=5` exist to avoid. Moving to one would have meant rewriting how the app reaches the
  database, for nothing the brief asks for.

  Putting both halves on one provider means one dashboard, one repository and one set of deploy
  logs, which matters with a twelve hour budget.

---
