// Reading orders, and writing the timeline. Every SELECT that returns an order goes through
// the visibility predicate here rather than at the route, so a new endpoint cannot forget it.

import { orderVisibilitySql, scopedParams } from '../auth/visibility.js';
import { query } from '../db.js';
import { notFound } from '../http/errors.js';
import { toCollaborator, toLine, toOrder, toTimelineEntry } from './serialize.js';

// The running total is computed by Postgres on every read and stored nowhere (Decision 7).
// A stored column would be one more thing to forget updating when a line is voided, and the
// FILTER here is the whole rule: voided lines still exist, they just stop counting.
const TOTAL_SQL = `
  (SELECT COALESCE(sum(l.quantity * l.unit_price) FILTER (WHERE l.voided_at IS NULL), 0)::numeric(10,2)
     FROM order_lines l WHERE l.order_id = o.id)`;

const ORDER_SELECT = `
  SELECT o.id, o.table_number, o.status, o.placed_at, o.ready_at, o.served_at,
         o.cancelled_at, o.archived_at, o.alert_acked_at, o.primary_waiter_id, o.updated_at,
         w.display_name AS primary_waiter_name,
         ${TOTAL_SQL} AS total
    FROM orders o
    JOIN users w ON w.id = o.primary_waiter_id`;

/**
 * One order, or null. The visibility predicate is ANDed into the WHERE clause, so an order
 * that exists but is not yours returns no row — which the caller turns into 404, never 403.
 * Order ids are sequential, and 403 would confirm which ones exist.
 *
 * Pass `client` to read inside an open transaction; otherwise this borrows from the pool.
 */
export async function findVisibleOrder(user, orderId, client) {
  const run = client ? (text, params) => client.query(text, params) : query;
  const { rows } = await run(`${ORDER_SELECT} WHERE o.id = $3 AND ${orderVisibilitySql()}`,
    scopedParams(user, orderId));
  return rows[0] ?? null;
}

export async function requireVisibleOrder(user, orderId, client) {
  const order = await findVisibleOrder(user, orderId, client);
  if (!order) throw notFound('Order not found', { code: 'NOT_FOUND' });
  return order;
}

/**
 * The mutating counterpart of requireVisibleOrder: same 404, but it also takes a row lock.
 *
 * `FOR UPDATE` is what makes the read-check-write in every mutating route safe. Without it,
 * two waiters advancing the same order at the same moment would both read `accepted`, both
 * find the move legal, and both write — producing two `status_changed` entries for one real
 * change. With it, the second transaction waits and then re-reads the status the first one
 * committed, so its transition is judged against what actually happened.
 *
 * It selects only the columns a state rule needs. The response is built afterwards by
 * loadOrderDetail, once the transaction has committed.
 */
export async function lockVisibleOrder(client, user, orderId) {
  const { rows } = await client.query(
    `SELECT o.id, o.status, o.archived_at, o.primary_waiter_id, o.alert_acked_at
       FROM orders o
      WHERE o.id = $3 AND ${orderVisibilitySql()}
        FOR UPDATE OF o`,
    scopedParams(user, orderId)
  );
  if (!rows[0]) throw notFound('Order not found', { code: 'NOT_FOUND' });
  return rows[0];
}

const LINES_SQL = `
  SELECT l.id, l.menu_item_id, l.item_name, l.unit_price, l.quantity,
         (l.quantity * l.unit_price)::numeric(10,2) AS line_total,
         l.instructions, l.voided_at, l.voided_by, l.void_reason, l.created_at,
         vb.display_name AS voided_by_name
    FROM order_lines l
    LEFT JOIN users vb ON vb.id = l.voided_by
   WHERE l.order_id = $1
   ORDER BY l.created_at, l.id`;

const COLLABORATORS_SQL = `
  SELECT u.id, u.display_name, u.role, c.added_at, c.added_by,
         ab.display_name AS added_by_name
    FROM order_collaborators c
    JOIN users u  ON u.id  = c.user_id
    JOIN users ab ON ab.id = c.added_by
   WHERE c.order_id = $1
   ORDER BY c.added_at, u.display_name`;

/**
 * The full order view: the order, its lines, its collaborators, and the running total.
 *
 * Two round trips, not three. The order has to come back first because it carries the
 * visibility answer — there is no point fetching lines for an order the caller may not see —
 * but lines and collaborators are independent of each other, so they go together.
 *
 * Deliberately not one query with json_agg: nesting rows inside JSON would hand the aggregation
 * to Postgres's JSON writer, which renders NUMERIC and BIGINT as JSON numbers. Every money
 * value and every id would need an explicit ::text to survive, and one forgotten cast is a
 * silently floated price. Separate queries let the type parsers in src/db.js do that job.
 */
export async function loadOrderDetail(user, orderId) {
  const order = await requireVisibleOrder(user, orderId);

  const [lines, collaborators] = await Promise.all([
    query(LINES_SQL, [orderId]),
    query(COLLABORATORS_SQL, [orderId]),
  ]);

  return {
    ...toOrder(order),
    lines: lines.rows.map(toLine),
    collaborators: collaborators.rows.map(toCollaborator),
  };
}

export async function loadTimeline(orderId) {
  const { rows } = await query(
    `SELECT t.id, t.action, t.from_status, t.to_status, t.line_id, t.note, t.details,
            t.created_at, t.actor_id, a.display_name AS actor_name, a.role AS actor_role
       FROM order_timeline t
       JOIN users a ON a.id = t.actor_id
      WHERE t.order_id = $1
      ORDER BY t.created_at, t.id`,
    [orderId]
  );
  return rows.map(toTimelineEntry);
}

/**
 * Append one timeline entry. Always called on a transaction client, never on the pool: every
 * write is two writes — the change and the record of it — and either both land or neither does.
 *
 * There is no update or delete counterpart, here or anywhere else. The database refuses those
 * outright (migration 001's append-only trigger); this is simply the only half that exists.
 */
export function recordEvent(client, event) {
  return client.query(
    `INSERT INTO order_timeline
       (order_id, actor_id, action, from_status, to_status, line_id, note, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8::jsonb, '{}'::jsonb))`,
    [
      event.orderId,
      event.actorId,
      event.action,
      event.fromStatus ?? null,
      event.toStatus ?? null,
      event.lineId ?? null,
      event.note ?? null,
      event.details ? JSON.stringify(event.details) : null,
    ]
  );
}
