# Decisions

Decisions where a real alternative existed and I picked one, in the order I made them. Where two
were made in the same sitting, the more consequential comes first.


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

  Two things an array cannot do at all, which decided it:

  1. **No referential integrity.** Nothing guarantees an ID in the array corresponds to a real user.
     A foreign key does.
  2. **Nowhere to record who added whom.** The timeline needs `added_by` and `added_at`; an array of
     plain IDs has no room for them.

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

  Two databases means the thing I test is not the thing I ship. I may come across compatibility issues at the last hour.

  Installing PostgreSQL, then keeping two environments
  in step, costs time out of a twelve-hour budget and earns nothing the brief asks for.

- **What it costs:** every query is a network round trip, so iterating on SQL is slower than it
  would be locally, and none of it works offline. Neither has mattered, and I have not needed to work without a connection.
