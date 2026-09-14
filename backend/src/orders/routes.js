// Order routes.
//
// Two rules run through every write in this file:
//
//   * Identity comes from the token. `primary_waiter_id`, `actor_id`, `voided_by`, `added_by`
//     are all req.user.id and are never read from the body. A client may name *other* people
//     as the object of an action; it may never name itself as the actor. That is what makes
//     the timeline's actor_id worth trusting (§9).
//
//   * Every write is two writes — the change, and the timeline entry recording it — inside one
//     transaction, so history can never be missing an event that happened.

import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware.js';
import { orderVisibilitySql, scopedParams } from '../auth/visibility.js';
import { query, withTransaction } from '../db.js';
import { conflict, notFound, unprocessable } from '../http/errors.js';
import { idSchema, parseBody, parseId, parseQuery } from '../http/validate.js';
import { toOrder } from './serialize.js';
import {
  ORDER_STATUSES,
  assertTransition,
  isOpen,
  isTerminal,
  stampColumnFor,
} from './lifecycle.js';
import {
  loadOrderDetail,
  loadTimeline,
  lockVisibleOrder,
  recordEvent,
  requireVisibleOrder,
} from './queries.js';

const createOrderSchema = z.strictObject({
  // The one thing the client supplies. TEXT, not a number, because §6 asks for a text search
  // over it and real floor plans have 'Patio 3' and 'Bar' as well as '12'.
  tableNumber: z.string().trim().min(1, 'Table number is required').max(40),
});

// 'placed' is excluded: it is where an order starts and nothing may move back to it.
const statusSchema = z.strictObject({
  status: z.enum(
    ORDER_STATUSES.filter((s) => s !== 'placed'),
    'Unknown status'
  ),
});

const addLineSchema = z.strictObject({
  menuItemId: idSchema,
  quantity: z
    .number('Quantity must be a number')
    .int('Quantity must be a whole number')
    .min(1, 'Quantity must be at least 1')
    .max(99, 'Quantity must be 99 or fewer'),
  instructions: z.string().trim().max(500).nullish().transform((v) => v || null),
});

// A reason is required by the database too (order_lines_void_shape), but validating it here is
// what lets a waiter read a sentence instead of a constraint name.
const voidLineSchema = z.strictObject({
  reason: z.string().trim().min(1, 'A reason is required to void a line').max(500),
});

// Naming *another* person as the object of an action is allowed; naming yourself as the actor
// is not. `userId` is who is being added — `added_by` still comes from the token.
const addCollaboratorSchema = z.strictObject({ userId: idSchema });

const addNoteSchema = z.strictObject({
  note: z.string().trim().min(1, 'A note cannot be empty').max(1000),
});

// ---------------------------------------------------------------------------
// GET /orders — §5 and §6 are one endpoint, because "orders I am on" is a filter over the
// same list as "orders matching this search", not a different screen.
// ---------------------------------------------------------------------------

// An absent parameter and an empty one mean the same thing: no filter. Query strings pick up
// `?q=&status=` from a form with untouched fields, and a 422 for that would be pedantic.
const blankToUndefined = (schema) =>
  z.preprocess((v) => (v === '' || v === undefined ? undefined : v), schema);

const pagingNumber = (fallback, min, max) =>
  blankToUndefined(z.coerce.number().int().min(min).max(max)).default(fallback);

// Sort keys are mapped to columns through this table and never interpolated from the request,
// so `?sort=` cannot name a column — or anything else.
const SORT_COLUMNS = {
  placedAt: 'o.placed_at',
  status: 'o.status',
  tableNumber: 'o.table_number',
};

const listOrdersSchema = z.strictObject({
  q: blankToUndefined(z.string().trim().max(60)).optional(),

  // Repeatable: `?status=placed&status=ready`. Express hands over a string for one and an
  // array for several, so both are accepted and normalised to an array.
  status: blankToUndefined(
    z.union([z.enum(ORDER_STATUSES), z.array(z.enum(ORDER_STATUSES)).min(1)], 'Unknown status')
  )
    .optional()
    .transform((v) => (v === undefined ? undefined : [].concat(v))),

  waiterId: blankToUndefined(idSchema).optional(),
  dateFrom: blankToUndefined(z.iso.date('Use YYYY-MM-DD')).optional(),
  dateTo: blankToUndefined(z.iso.date('Use YYYY-MM-DD')).optional(),

  // For a waiter these two are the same set — everything they can see, they are on — so this
  // only narrows anything for a manager. It stays available to both so the frontend does not
  // need a different request per role.
  scope: blankToUndefined(z.enum(['mine', 'all'], 'scope must be mine or all')).default('all'),

  sort: blankToUndefined(
    z.enum(Object.keys(SORT_COLUMNS), 'sort must be placedAt, status or tableNumber')
  ).default('placedAt'),
  order: blankToUndefined(z.enum(['asc', 'desc'], 'order must be asc or desc')).default('desc'),

  page: pagingNumber(1, 1, 100_000),
  pageSize: pagingNumber(20, 1, 100),

  includeArchived: z.preprocess(
    (v) => (v === undefined || v === '' ? 'false' : v),
    z.stringbool()
  ),
});

// % and _ are wildcards to ILIKE, so a waiter searching for the literal table "T_1" would
// otherwise match "T21" as well. Escaped here and declared with ESCAPE below.
const escapeLike = (value) => value.replace(/[\\%_]/g, '\\$&');

const involvesUser = (column) =>
  `(o.primary_waiter_id = ${column}
    OR EXISTS (SELECT 1 FROM order_collaborators f
                WHERE f.order_id = o.id AND f.user_id = ${column}))`;

/** How many orders match, ignoring paging. Only used when the requested page came back empty. */
async function countMatching(whereSql, params) {
  const { rows } = await query(
    `SELECT count(*)::int AS n
       FROM orders o
       JOIN users w ON w.id = o.primary_waiter_id
      WHERE ${whereSql}`,
    params
  );
  return rows[0].n;
}

export function orderRoutes() {
  const router = Router();

  // §2. Whoever sends this becomes the primary waiter, which is the moment ownership is
  // created — every later permission question about this order traces back to here.
  router.post('/', requireAuth, async (req, res) => {
    const { tableNumber } = parseBody(createOrderSchema, req.body);

    const orderId = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO orders (table_number, primary_waiter_id)
              VALUES ($1, $2)
           RETURNING id, status`,
        [tableNumber, req.user.id]
      );
      const created = rows[0];

      await recordEvent(client, {
        orderId: created.id,
        actorId: req.user.id,
        action: 'created',
        toStatus: created.status,
        details: { tableNumber },
      });

      return created.id;
    });

    // Read back after the commit, so the response is the order as the database now holds it
    // rather than as this request hoped to leave it.
    res.status(201).json({ order: await loadOrderDetail(req.user, orderId) });
  });

  // §5 + §6. Every filter is optional and they compose; the visibility predicate is ANDed in
  // underneath all of them, so a waiter's search can only ever range over their own orders.
  router.get('/', requireAuth, async (req, res) => {
    const f = parseQuery(listOrdersSchema, req.query);

    // $1 and $2 are the visibility parameters, by the contract in auth/visibility.js. Every
    // filter below appends its own value and uses the index it got back, so the numbering
    // cannot drift out of step with the array.
    const params = scopedParams(req.user);
    const bind = (value) => `$${params.push(value)}`;

    const where = [orderVisibilitySql()];

    if (!f.includeArchived) where.push('o.archived_at IS NULL');
    if (f.q) where.push(`o.table_number ILIKE '%' || ${bind(escapeLike(f.q))} || '%' ESCAPE '\\'`);
    if (f.status) where.push(`o.status = ANY(${bind(f.status)}::order_status[])`);
    if (f.waiterId) where.push(involvesUser(bind(f.waiterId)));
    if (f.scope === 'mine') where.push(involvesUser(bind(req.user.id)));

    // Dates are compared in the restaurant's timezone, not the server's. The API host runs in
    // UTC, and a 23:30 IST dinner must not land on tomorrow's date (Decision 11).
    if (f.dateFrom || f.dateTo) {
      const tz = bind(process.env.RESTAURANT_TZ || 'Asia/Kolkata');
      if (f.dateFrom) where.push(`(o.placed_at AT TIME ZONE ${tz})::date >= ${bind(f.dateFrom)}::date`);
      if (f.dateTo) where.push(`(o.placed_at AT TIME ZONE ${tz})::date <= ${bind(f.dateTo)}::date`);
    }

    // o.id breaks ties so a page boundary cannot show the same order twice or skip one when
    // two orders share a placed_at — which the seed's bulk-inserted history does.
    const direction = f.order === 'asc' ? 'ASC' : 'DESC';
    const orderBy = `${SORT_COLUMNS[f.sort]} ${direction}, o.id ${direction}`;

    // Kept before LIMIT/OFFSET are bound, so the count fallback below can re-use exactly these
    // filters and these parameters.
    const whereSql = where.join('\n          AND ');
    const filterParams = [...params];

    const limit = bind(f.pageSize);
    const offset = bind((f.page - 1) * f.pageSize);

    // count(*) OVER () is evaluated before LIMIT, so the total for the pager comes back on the
    // same round trip as the page itself instead of needing a second query with a duplicated
    // — and eventually divergent — WHERE clause.
    const { rows } = await query(
      `SELECT o.id, o.table_number, o.status, o.placed_at, o.ready_at, o.served_at,
              o.cancelled_at, o.archived_at, o.alert_acked_at, o.primary_waiter_id, o.updated_at,
              w.display_name AS primary_waiter_name,
              (SELECT COALESCE(sum(l.quantity * l.unit_price) FILTER (WHERE l.voided_at IS NULL), 0)::numeric(10,2)
                 FROM order_lines l WHERE l.order_id = o.id) AS total,
              (SELECT count(*)::int FROM order_lines l
                WHERE l.order_id = o.id AND l.voided_at IS NULL) AS line_count,
              (SELECT count(*)::int FROM order_collaborators c WHERE c.order_id = o.id) AS collaborator_count,
              count(*) OVER ()::int AS total_count
         FROM orders o
         JOIN users w ON w.id = o.primary_waiter_id
        WHERE ${whereSql}
        ORDER BY ${orderBy}
        LIMIT ${limit} OFFSET ${offset}`,
      params
    );

    // count(*) OVER () rides along on the rows, so an empty page brings back no count with it
    // — and "page 9999 of a 75-order list" would otherwise report a total of 0 and tell the
    // pager there is nothing to go back to. Only that case pays for a second query.
    const total = rows[0]?.total_count ?? (await countMatching(whereSql, filterParams));

    res.json({
      orders: rows.map(toOrder),
      page: {
        page: f.page,
        pageSize: f.pageSize,
        total,
        totalPages: Math.ceil(total / f.pageSize),
      },
    });
  });

  // Scoped: an order that is not yours is 404, indistinguishable from one that never existed.
  router.get('/:id', requireAuth, async (req, res) => {
    const id = parseId(req.params.id, 'Order');
    res.json({ order: await loadOrderDetail(req.user, id) });
  });

  // §9. Read-only, and there is no route anywhere that edits or deletes an entry.
  router.get('/:id/timeline', requireAuth, async (req, res) => {
    const id = parseId(req.params.id, 'Order');
    await requireVisibleOrder(req.user, id);

    res.json({ timeline: await loadTimeline(id) });
  });

  // §4. Advancing and cancelling are one route because they are one rule — the matrix in
  // lifecycle.js decides both, and cancelling is simply the move that stops being legal at
  // `preparing`.
  router.post('/:id/status', requireAuth, async (req, res) => {
    const id = parseId(req.params.id, 'Order');
    const { status } = parseBody(statusSchema, req.body);

    await withTransaction(async (client) => {
      const order = await lockVisibleOrder(client, req.user, id);
      assertTransition(order.status, status);

      // The timestamp column is chosen by the target status, so `ready_at` and `served_at`
      // cannot drift out of step with the status they describe.
      const stamp = stampColumnFor(status);
      await client.query(
        `UPDATE orders SET status = $2${stamp ? `, ${stamp} = now()` : ''} WHERE id = $1`,
        [id, status]
      );

      await recordEvent(client, {
        orderId: id,
        actorId: req.user.id,
        action: 'status_changed',
        fromStatus: order.status,
        toStatus: status,
      });
    });

    res.json({ order: await loadOrderDetail(req.user, id) });
  });

  // §3. The line's name and price are copied from the menu item now and never read from it
  // again, so repricing the menu tomorrow cannot rewrite tonight's bill.
  router.post('/:id/lines', requireAuth, async (req, res) => {
    const id = parseId(req.params.id, 'Order');
    const { menuItemId, quantity, instructions } = parseBody(addLineSchema, req.body);

    await withTransaction(async (client) => {
      const order = await lockVisibleOrder(client, req.user, id);
      if (!isOpen(order.status)) {
        throw conflict('This order is closed; no more items can be added to it.', {
          code: 'ORDER_CLOSED',
        });
      }

      const { rows } = await client.query(
        `SELECT id, name, price, is_available, archived_at FROM menu_items WHERE id = $1`,
        [menuItemId]
      );
      const item = rows[0];

      // An id that names nothing is a bad payload — 422. An item that exists but cannot be
      // ordered right now is a state rule — 409. The object in the path is the order, and the
      // order was found, so neither of these is a 404.
      if (!item) {
        throw unprocessable('Invalid payload', {
          code: 'VALIDATION_FAILED',
          details: [{ field: 'menuItemId', message: 'No menu item with that id' }],
        });
      }
      if (item.archived_at !== null) {
        throw conflict(`${item.name} is no longer on the menu.`, { code: 'ITEM_ARCHIVED' });
      }
      if (!item.is_available) {
        throw conflict(`${item.name} is unavailable right now.`, { code: 'ITEM_UNAVAILABLE' });
      }

      const { rows: inserted } = await client.query(
        `INSERT INTO order_lines (order_id, menu_item_id, item_name, unit_price, quantity, instructions)
              VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id`,
        [id, item.id, item.name, item.price, quantity, instructions]
      );

      await recordEvent(client, {
        orderId: id,
        actorId: req.user.id,
        action: 'line_added',
        lineId: inserted[0].id,
        details: { item: item.name, quantity, unitPrice: item.price },
      });
    });

    res.status(201).json({ order: await loadOrderDetail(req.user, id) });
  });

  // §4. Voiding marks the line; it never deletes it. The line stays on the bill, struck
  // through, with who removed it and why — which is the difference between a correction and
  // an erasure.
  router.post('/:id/lines/:lineId/void', requireAuth, async (req, res) => {
    const id = parseId(req.params.id, 'Order');
    const lineId = parseId(req.params.lineId, 'Order line');
    const { reason } = parseBody(voidLineSchema, req.body);

    await withTransaction(async (client) => {
      const order = await lockVisibleOrder(client, req.user, id);
      if (!isOpen(order.status)) {
        throw conflict('This order is closed; its lines can no longer be changed.', {
          code: 'ORDER_CLOSED',
        });
      }

      // Scoped to this order, so a line id belonging to somebody else's order is a 404 here
      // for the same reason the order itself would be.
      const { rows } = await client.query(
        `SELECT id, item_name, voided_at FROM order_lines
          WHERE id = $1 AND order_id = $2 FOR UPDATE`,
        [lineId, id]
      );
      const line = rows[0];
      if (!line) throw notFound('Order line not found', { code: 'NOT_FOUND' });
      if (line.voided_at !== null) {
        throw conflict('That line has already been voided.', { code: 'ALREADY_VOIDED' });
      }

      await client.query(
        `UPDATE order_lines SET voided_at = now(), voided_by = $2, void_reason = $3
          WHERE id = $1`,
        [lineId, req.user.id, reason]
      );

      await recordEvent(client, {
        orderId: id,
        actorId: req.user.id,
        action: 'line_voided',
        lineId,
        note: reason,
        details: { item: line.item_name },
      });
    });

    res.json({ order: await loadOrderDetail(req.user, id) });
  });

  // §5. Adding a collaborator widens who can see and act on this order — visibility and
  // actionability are the same predicate — so this route is also the only way an order reaches
  // a waiter who did not create it.
  router.post('/:id/collaborators', requireAuth, async (req, res) => {
    const id = parseId(req.params.id, 'Order');
    const { userId } = parseBody(addCollaboratorSchema, req.body);

    await withTransaction(async (client) => {
      const order = await lockVisibleOrder(client, req.user, id);
      if (order.archived_at !== null) {
        throw conflict('This order is archived; restore it before changing it.', {
          code: 'ORDER_ARCHIVED',
        });
      }

      const { rows } = await client.query(
        `SELECT id, display_name, role FROM users WHERE id = $1`,
        [userId]
      );
      const target = rows[0];

      // Both of these are 422 rather than 409: they are statements about the payload's own
      // value, decided without reference to this order's state.
      if (!target || target.role !== 'waiter') {
        throw unprocessable('Invalid payload', {
          code: 'VALIDATION_FAILED',
          details: [
            {
              field: 'userId',
              message: target ? 'Only a waiter can be added as a collaborator' : 'No user with that id',
            },
          ],
        });
      }
      if (target.id === order.primary_waiter_id) {
        throw conflict(`${target.display_name} is already the primary waiter on this order.`, {
          code: 'ALREADY_PRIMARY',
        });
      }

      // ON CONFLICT DO NOTHING rather than asking first: the composite primary key already
      // makes a duplicate impossible, so letting it decide keeps the check and the write in
      // one statement with no gap between them.
      const { rows: inserted } = await client.query(
        `INSERT INTO order_collaborators (order_id, user_id, added_by)
              VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING
           RETURNING user_id`,
        [id, target.id, req.user.id]
      );
      if (!inserted[0]) {
        throw conflict(`${target.display_name} is already a collaborator on this order.`, {
          code: 'ALREADY_COLLABORATOR',
        });
      }

      await recordEvent(client, {
        orderId: id,
        actorId: req.user.id,
        action: 'collaborator_added',
        note: `Added ${target.display_name}`,
        details: { userId: target.id, displayName: target.display_name },
      });
    });

    res.status(201).json({ order: await loadOrderDetail(req.user, id) });
  });

  // The one action whose change *is* its record — there is no order column for a note, so the
  // timeline entry is the whole write. Allowed in any state, including archived: a note is a
  // remark about what happened, and something worth saying can occur after the fact.
  router.post('/:id/notes', requireAuth, async (req, res) => {
    const id = parseId(req.params.id, 'Order');
    const { note } = parseBody(addNoteSchema, req.body);

    await withTransaction(async (client) => {
      await requireVisibleOrder(req.user, id, client);
      await recordEvent(client, {
        orderId: id,
        actorId: req.user.id,
        action: 'note_added',
        note,
      });
    });

    res.status(201).json({ timeline: await loadTimeline(id) });
  });

  // §2, narrowed by Decision 6: archiving is for orders that are finished, not for clearing
  // the board. An order still in service has to reach Served or Cancelled first.
  router.post('/:id/archive', requireAuth, async (req, res) => {
    const id = parseId(req.params.id, 'Order');

    await withTransaction(async (client) => {
      const order = await lockVisibleOrder(client, req.user, id);
      if (order.archived_at !== null) {
        throw conflict('This order is already archived.', { code: 'ALREADY_ARCHIVED' });
      }
      if (!isTerminal(order.status)) {
        throw conflict(
          'Only a Served or Cancelled order can be archived; this one is still in service.',
          { code: 'ORDER_STILL_ACTIVE' }
        );
      }

      await client.query(`UPDATE orders SET archived_at = now() WHERE id = $1`, [id]);
      await recordEvent(client, { orderId: id, actorId: req.user.id, action: 'archived' });
    });

    res.json({ order: await loadOrderDetail(req.user, id) });
  });

  router.post('/:id/restore', requireAuth, async (req, res) => {
    const id = parseId(req.params.id, 'Order');

    await withTransaction(async (client) => {
      const order = await lockVisibleOrder(client, req.user, id);
      if (order.archived_at === null) {
        throw conflict('This order is not archived.', { code: 'NOT_ARCHIVED' });
      }

      await client.query(`UPDATE orders SET archived_at = NULL WHERE id = $1`, [id]);
      await recordEvent(client, { orderId: id, actorId: req.user.id, action: 'restored' });
    });

    res.json({ order: await loadOrderDetail(req.user, id) });
  });

  return router;
}
