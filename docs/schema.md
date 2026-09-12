# Schema

PostgreSQL 14+. Six tables, three enums, CHECK constraints, and an append-only trigger on the
timeline. 

## Tables and columns

### `users`

| Column | Type | Notes |
|--------|------|--------|
| `id` | `BIGSERIAL` PK | Surrogate key so email can change without cascading FKs |
| `email` | `CITEXT` UNIQUE NOT NULL | Login identity (brief §1); case-insensitive |
| `password_hash` | `TEXT` NOT NULL | Never store a raw password. Hashing algorithm is a candidate choice — see [`architecture.md`](architecture.md#how-the-pieces-talk) |
| `display_name` | `TEXT` NOT NULL | Shown in "orders by waiter" and filters |
| `role` | `user_role` ENUM NOT NULL | `manager` \| `waiter` |
| `phone` | `TEXT` | Optional contact; nothing in the brief requires it |
| `created_at` | `TIMESTAMPTZ` NOT NULL | Default `now()` |

### `menu_items`

| Column | Type | Notes |
|--------|------|--------|
| `id` | `BIGSERIAL` PK | |
| `name` | `TEXT` NOT NULL | |
| `category` | `TEXT` NOT NULL | |
| `price` | `NUMERIC(10,2)` NOT NULL | `CHECK (price >= 0)` |
| `is_available` | `BOOLEAN` NOT NULL | Manager flips this when the kitchen runs out |
| `archived_at` | `TIMESTAMPTZ` | NULL = live; never hard-delete (old lines still point here) |
| `created_at` / `updated_at` | `TIMESTAMPTZ` NOT NULL | `updated_at` maintained by trigger |

Partial unique index on `lower(name)` where `archived_at IS NULL` — two live "Butter Naan" rows are
illegal; recreating an archived name is fine.

Deliberately **not** modelled: stock `quantity`, discounts (not in the ten goals).

### `orders`

| Column | Type | Notes |
|--------|------|--------|
| `id` | `BIGSERIAL` PK | |
| `table_number` | `TEXT` NOT NULL | Text search (§6); values like `T12`, `Patio 3`, `Bar` |
| `primary_waiter_id` | `BIGINT` NOT NULL → `users` | Creator becomes primary waiter |
| `status` | `order_status` ENUM NOT NULL | `placed` → `accepted` → `preparing` → `ready` → `served`, plus `cancelled` |
| `placed_at` | `TIMESTAMPTZ` NOT NULL | Clock for list date filter, dashboard, alerts |
| `ready_at` / `served_at` / `cancelled_at` | `TIMESTAMPTZ` | Set on the matching transition |
| `archived_at` | `TIMESTAMPTZ` | NULL = in the active queue |
| `alert_acked_at` / `alert_acked_by` | `TIMESTAMPTZ` + `BIGINT` FK | Slow-order acknowledgement (§10) |
| `updated_at` | `TIMESTAMPTZ` NOT NULL | Trigger-maintained |


### `order_collaborators` (junction)

| Column | Type | Notes |
|--------|------|--------|
| `order_id` | `BIGINT` PK, FK → `orders` | |
| `user_id` | `BIGINT` PK, FK → `users` | |
| `added_by` | `BIGINT` FK → `users` | Who added whom (for the timeline) |
| `added_at` | `TIMESTAMPTZ` NOT NULL | |

Composite primary key `(order_id, user_id)` makes adding the same collaborator twice impossible in
the database rather than a check in code. Second index on `user_id` so "every order where I am
primary or collaborator" stays cheap.

### `order_lines`

| Column | Type | Notes |
|--------|------|--------|
| `id` | `BIGSERIAL` PK | |
| `order_id` | `BIGINT` NOT NULL FK → `orders` | |
| `menu_item_id` | `BIGINT` NOT NULL FK → `menu_items` | Still points at archived items |
| `item_name` | `TEXT` NOT NULL | **Snapshot** at add time |
| `unit_price` | `NUMERIC(10,2)` NOT NULL | **Snapshot** at add time (§3) |
| `quantity` | `INTEGER` NOT NULL | `CHECK (quantity > 0)` |
| `instructions` | `TEXT` | Nullable special instructions |
| `voided_at` / `voided_by` / `void_reason` | `TIMESTAMPTZ` + FK + `TEXT` | Void marks the line; does not delete it |
| `created_at` | `TIMESTAMPTZ` NOT NULL | |

CHECK: the three void columns are all-NULL or all-set, and a void requires a non-blank reason.
Running total = `SUM(quantity * unit_price)` where `voided_at IS NULL` — no stored `total` column.

### `order_timeline` (append-only)

| Column | Type | Notes |
|--------|------|--------|
| `id` | `BIGSERIAL` PK | Tie-breaker when two events share a millisecond |
| `order_id` | `BIGINT` NOT NULL FK → `orders` | An order's timeline is simply all rows for that id |
| `actor_id` | `BIGINT` NOT NULL FK → `users` | Who did it |
| `action` | `timeline_action` ENUM NOT NULL | `created`, `status_changed`, `line_added`, `line_voided`, `collaborator_added`, `note_added`, `archived`, `restored`, `alert_acknowledged` |
| `from_status` / `to_status` | `order_status` | Required shape for `status_changed` |
| `line_id` | `BIGINT` FK → `order_lines` | For `line_added` / `line_voided` |
| `note` | `TEXT` | Free text / void reason body |
| `details` | `JSONB` | e.g. item name + qty, collaborator id |
| `created_at` | `TIMESTAMPTZ` NOT NULL | Chronological order with `id` |

A `BEFORE UPDATE OR DELETE` trigger raises on any rewrite. There is no edit/delete route in the API
either.

## Relationships

**One-to-many**

- `users` → `orders` as primary waiter (`primary_waiter_id`)
- `orders` → `order_lines`
- `orders` → `order_timeline`
- `menu_items` → `order_lines`
- `users` → `order_timeline` as actor
- `users` → `order_lines` as the voider (`voided_by`)

**Many-to-many**

- Waiters ↔ orders through `order_collaborators`. 

`order_lines` is *not* a many-to-many between orders and menu items even though it sits between
them: it carries its own identity, quantity, instructions and void state, and the same menu item can
legitimately appear twice on one order with different instructions.

## Database vs application constraints

The line I drew: **the database owns facts that are true regardless of who is asking** (a price
cannot be negative, a status cannot be a seventh value, history cannot be rewritten). **The
application owns rules that need context** — the current row, the JWT subject, or a human-readable
explanation.

| Rule | Database | Application | 
|------|----------|-------------|
| Email unique; role ∈ {manager, waiter} | UNIQUE, ENUM | Friendly error on unique violation | 
| Status ∈ six states | ENUM | — | 
| Legal transitions (Placed→Accepted…) | no | Transitions map + `SELECT … FOR UPDATE` | 
| Void requires a reason | CHECK | Validate first for the message | 
| Price ≥ 0, quantity > 0 | CHECK | Per-item validation in bulk update | 
| Timeline append-only | Trigger | No edit routes | 
| Who may act on an order | no | Authz: manager \| primary \| collaborator |
| Lines only before Served/Cancelled | no | Service check | 
| Timeline written with every change | Same transaction | Service layer always inserts | 

The one place I put a rule in *both*: void-needs-a-reason. The application validates first so the
waiter gets "A reason is required to void a line" rather than a constraint name, and the CHECK stays
as the backstop for any code path I forget.

## Deliberate denormalisation

1. **`unit_price` and `item_name` on `order_lines`** — required by §3; a later menu price/name change
   must not rewrite old totals or CSV rows.
2. **`placed_at` / `ready_at` / `served_at` / `cancelled_at` on `orders`** — derivable from the
   timeline, copied so dashboard, date filters, and alerts do not join the timeline on every load.
   Cost: every status change must set the matching stamp in the same transaction.
3. **Item name / qty (and similar) in `timeline.details`** — history still reads after the menu
   changes, without joining four tables.


## What would break first at 100× data

100× a single busy restaurant is roughly 20–30k orders a day and low single-digit millions a year —
enough to hurt in this order:

1. **Offset pagination** (§6) — page 400 of a large list re-scans tens of thousands of rows; switch
   to keyset on `(placed_at, id)`.
2. **`order_timeline` growth** — roughly 6–10× faster than orders; partition by month or archive
   cold history.
3. **Dashboard aggregates** (§8) scanning all of today's lines on every load — a materialised daily
   rollup refreshed every minute.

What would **not** break first: the collaborator join, the alerts predicate, and the append-only
trigger — those are index-bound and O(matches).
