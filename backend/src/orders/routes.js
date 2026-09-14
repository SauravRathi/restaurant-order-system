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
import { withTransaction } from '../db.js';
import { parseBody, parseId } from '../http/validate.js';
import { loadOrderDetail, loadTimeline, recordEvent, requireVisibleOrder } from './queries.js';

const createOrderSchema = z.strictObject({
  // The one thing the client supplies. TEXT, not a number, because §6 asks for a text search
  // over it and real floor plans have 'Patio 3' and 'Bar' as well as '12'.
  tableNumber: z.string().trim().min(1, 'Table number is required').max(40),
});

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

  return router;
}
