# Actions and API surface

Built in two layers : **what each actor may do** first,
then the endpoints **derived from** that. Every endpoint in the second half cites the action it
implements, so if an action is wrong the endpoint that falls out of it is wrong in a traceable way.


---

## The authorization model


| Dimension | Values |
|-----------|--------|
| **Role** | `manager` \| `waiter` |
| **Relationship to an order** | primary waiter \| collaborator \| neither |

One predicate covers both reading and writing:

```
canAccessOrder(user, order) =
     user.role === 'manager'
  || order.primary_waiter_id === user.id
  || exists(order_collaborators WHERE order_id = order.id AND user_id = user.id)
```

**Visibility and actionability are identical.** A waiter cannot see an order they are not part of.

### Failure codes, and the rule behind them

| Code | Means | Example |
|------|-------|---------|
| `401` | No token, bad token, expired token | Any route but login/health |
| `403` | **Your role lacks this capability** | A waiter calling `POST /menu-items` |
| `404` | **This object is not yours** (or absent) | A waiter fetching another waiter's order |
| `409` | **State rule violated** | Cancelling an order already Preparing (§4) |
| `422` | Payload failed validation | Negative price, missing void reason |

The 403/404 split is the part worth being able to defend: **403 for capabilities, 404 for objects.**
A waiter already knows the menu-management routes exist, so 403 leaks nothing. Order IDs are
sequential and guessable, so 404 is what stops a waiter enumerating the restaurant's orders by
walking `/orders/1`, `/orders/2`, `/orders/3`. Returning 403 there would confirm which IDs exist.


---

## Actions by actor

### Anonymous

| Action | Notes |
|--------|-------|
| Sign in with email + password | §1. Returns JWT `{sub, role, name}`, ~12 h |

**No self-registration.** Accounts are manager-created plus a seeded first manager — an open
sign-up with a role picker would let anyone mint a manager and defeat §1 entirely.

### Any authenticated user (both roles)

| Action | Scope | 
|--------|-------|
| View own identity | self | 
| List users | waiter: `id`, `display_name`, `role` only · manager: full record | 
| Browse the menu | waiter: non-archived · manager: all | 
| View the dashboard | restaurant-wide, both roles | 
| List orders | **scoped by `canAccessOrder`** | 
| View one order + lines + running total | scoped | 
| View an order's timeline | scoped |
| View alerts and the count badge | **scoped by `canAccessOrder`** | 
| Create an order for a table | — |

### Waiter — on orders they are part of only

Everything here requires `canAccessOrder` to pass, else **404**.

| Action | Order states allowed | Rejected when | Timeline event |
|--------|---------------------|---------------|----------------|
| Add a line (item, qty, instructions) | `placed`, `accepted`, `preparing`, `ready` | Order is `served` or `cancelled` → 409 | `line_added` |
| Void a line, with reason | `placed`, `accepted`, `preparing`, `ready` | Order closed → 409 · line already void → 409 · reason blank → 422 | `line_voided` |
| Advance status | per the [transition matrix](#transition-matrix) below | Illegal move → 409 with an explaining message | `status_changed` |
| Cancel the order | `placed`, `accepted` **only** | `preparing` or later → 409: *"Cannot cancel an order that is already Preparing; void individual lines instead."* | `status_changed` |
| Add a collaborator | any state, while not archived | Target is not a waiter → 422 · already a collaborator → 409 · is the primary waiter → 409 | `collaborator_added` |
| Add a note | any | — | `note_added` |
| Acknowledge a slow-order alert | order currently alerting | Not currently alerting → 409 | `alert_acknowledged` |
| Archive the order | `served`, `cancelled` — see [Decision 6](decisions.md#decision-6--archiving-is-restricted-to-terminal-states) | Still active → 409 | `archived` |
| Restore the order | archived only | Not archived → 409 | `restored` |


### Manager — everything above, on every order, plus

| Action | Notes |
|--------|-------|
| Create a user account | §1. Sets role at creation |
| Create a menu item | §1 — managers only, enforced server-side |
| Update a menu item (name, category, price, availability) | §1 |
| Archive / restore a menu item | Never hard-deleted; old order lines still reference it |
| **Bulk-update selected menu items** — a new price, an availability change, an archive or restore, in any combination | §7. Must report **per item** what succeeded and what was rejected and why. Partial success is the requirement, not a fallback. Widened from "one change": [Decision 12](decisions.md#decision-12--the-bulk-update-takes-any-combination-of-fields) |
| **Export today's orders as CSV** | §7. Every order placed today with lines, total and status |

A manager acting on an order they did not create is authorized but **not silent** — the timeline
records `actor_id`, so "manager overrode this" is visible forever (§9).

## Transition matrix

| From | May move to |
|------|-------------|
| `placed` | `accepted`, `cancelled` |
| `accepted` | `preparing`, `cancelled` |
| `preparing` | `ready` |
| `ready` | `served` |
| `served` | — terminal |
| `cancelled` | — terminal |

Forward only. No skipping, no reversing, and cancellation dies at `preparing` — that is the specific
rule §4 spells out. Every rejected move returns 409 with a sentence naming the current state and why
the target is refused.

## Alert predicate

An order is alerting when **all** hold:

```
status IN ('placed', 'accepted', 'preparing')   -- "without reaching Ready"
AND archived_at IS NULL
AND now() - placed_at > ALERT_THRESHOLD_MINUTES
AND (alert_acked_at IS NULL OR now() - alert_acked_at > ALERT_SNOOZE_MINUTES)
```

---

## Bulk update

`POST /menu-items/bulk` always answers `200`. The body is the report, because a status code
describing the worst individual outcome would force a client to read the body anyway.

Send `ids` plus at least one of `price`, `isAvailable`, `archived` — `archived: true` archives,
`false` restores. At most 200 ids; duplicates are dropped and the original order kept, so the report
reads back in the order the items were selected.

What fails the whole request is the shape: a malformed id, an empty list, no fields, or a `price`
that is not a number at all. Everything else is a per-item rejection.

```jsonc
{ "summary": { "requested": 2, "updated": 1, "partial": 1, "rejected": 0 },
  "results": [
    { "id": "12", "status": "updated",
      "changes": { "price": { "status": "updated" } },
      "menuItem": { … } },
    { "id": "13", "status": "partial",
      "changes": {
        "price":       { "status": "rejected", "code": "NEGATIVE_PRICE",
                         "reason": "Price cannot be negative" },
        "isAvailable": { "status": "updated" } },
      "menuItem": { … } } ]}
```

An item's `status` is `updated` when every field it carried succeeded, `rejected` when none did, and
`partial` in between. Rejection codes: `NOT_FOUND`, `ARCHIVED`, `ALREADY_ARCHIVED`, `NOT_ARCHIVED`,
`NEGATIVE_PRICE`, `INVALID_PRICE`, `NAME_TAKEN`, `CHANGED_CONCURRENTLY`.

The row's own state is judged before the value it was given, so an archived item sent a negative
price is rejected as `ARCHIVED` — the answer that tells the manager what to do about it.

---


## Derived endpoints
These are the paths the code serves.

### Auth and identity

| Method | Path | Who | Implements |
|--------|------|-----|-----------|
| `POST` | `/auth/login` | anonymous | Sign in |
| `GET` | `/auth/me` | authenticated | View own identity |
| `GET` | `/health` · `/health/db` | anonymous | Liveness · readiness |

### Users

| Method | Path | Who | Implements |
|--------|------|-----|-----------|
| `GET` | `/users?role=waiter` | authenticated | List users — fields narrowed for waiters |
| `POST` | `/users` | **manager** → else 403 | Create a user account |

### Menu

| Method | Path | Who | Implements |
|--------|------|-----|-----------|
| `GET` | `/menu-items?includeArchived=` | authenticated | Browse the menu — `includeArchived` ignored for waiters |
| `POST` | `/menu-items` | **manager** | Create a menu item |
| `PATCH` | `/menu-items/:id` | **manager** | Update a menu item |
| `POST` | `/menu-items/:id/archive` | **manager** | Archive |
| `POST` | `/menu-items/:id/restore` | **manager** | Restore |
| `POST` | `/menu-items/bulk` | **manager** | Bulk update (§7) |


### Orders

| Method | Path | Who | Implements |
|--------|------|-----|-----------|
| `GET` | `/orders` | scoped | List orders (§5 + §6) |
| `POST` | `/orders` | authenticated | Create an order |
| `GET` | `/orders/:id` | scoped → else 404 | View order, lines, running total, collaborators |
| `GET` | `/orders/:id/timeline` | scoped → else 404 | View timeline (§9) |
| `POST` | `/orders/:id/status` | scoped | Advance status / cancel |
| `POST` | `/orders/:id/lines` | scoped | Add a line |
| `POST` | `/orders/:id/lines/:lineId/void` | scoped | Void a line |
| `POST` | `/orders/:id/collaborators` | scoped | Add a collaborator |
| `POST` | `/orders/:id/notes` | scoped | Add a note |
| `POST` | `/orders/:id/archive` | scoped | Archive |
| `POST` | `/orders/:id/restore` | scoped | Restore |
| `GET` | `/orders/export` | **manager** | CSV of today's orders |

**§5 and §6 are one endpoint.** `GET /orders` accepts:

```
q=            text search over table_number (§6)
status=       filter, repeatable
waiterId=     filter
dateFrom= dateTo=
scope=mine|all    mine = primary or collaborator; for a waiter these are the same set
sort=placedAt|status|tableNumber   order=asc|desc
page= pageSize=
includeArchived=
```


### Alerts

| Method | Path | Who | Implements |
|--------|------|-----|-----------|
| `GET` | `/alerts` | scoped | View alerts (§10) |
| `GET` | `/alerts/count` | scoped | Nav badge — polled ~45 s |
| `POST` | `/orders/:id/alert/ack` | scoped | Acknowledge an alert |

`/alerts/count` is separate from `/alerts` because it is polled continuously by every open tab and
only needs to return an integer.

### Dashboard

| Method | Path | Who | Implements |
|--------|------|-----|-----------|
| `GET` | `/dashboard` | authenticated | Headlines, by-status, by-waiter, served-per-day ×14 (§8) |

Restaurant-wide for both roles. One endpoint, one round trip — the landing view should not fan out
into five requests.

---

## Coverage check against the ten goals

| Goal | Covered by |
|------|-----------|
| 1 Accounts and roles | `/auth/login`, `/users`, `requireRole` on every manager route |
| 2 Orders | `POST /orders`, `/archive`, `/restore` |
| 3 Order lines | `POST /orders/:id/lines`, total in `GET /orders/:id` |
| 4 Lifecycle | `POST /orders/:id/status` + transition matrix + line void |
| 5 Collaborators | `POST /orders/:id/collaborators`, `GET /orders?scope=mine` |
| 6 Finding orders | `GET /orders` query parameters |
| 7 Bulk + CSV | `POST /menu-items/bulk`, `GET /orders/export` |
| 8 Dashboard | `GET /dashboard` |
| 9 History | `GET /orders/:id/timeline` + no write routes + DB trigger |
| 10 Alerts | `GET /alerts`, `/alerts/count`, `POST /orders/:id/alert/ack` |


