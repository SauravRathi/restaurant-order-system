// §10. Alerts are scoped by exactly the same predicate as orders: you are told about the
// orders you could act on, and no others. A waiter is not warned about a table they cannot
// see, and a manager is warned about all of them.

import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { orderVisibilitySql, scopedParams } from '../auth/visibility.js';
import { query } from '../db.js';
import { toOrder } from '../orders/serialize.js';
import { alertPredicateSql, alertThresholds } from './predicate.js';

// $1/$2 are the visibility parameters; the thresholds take the next two slots.
const ALERTING = `${orderVisibilitySql()} AND ${alertPredicateSql({ slowParam: '$3', repeatParam: '$4' })}`;

export function alertRoutes() {
  const router = Router();

  router.get('/', requireAuth, async (req, res) => {
    const { slowOrderMinutes, repeatMinutes } = alertThresholds();

    // Oldest first: the list is a queue of what to deal with, and the order that has been
    // waiting longest is the one to deal with first.
    const { rows } = await query(
      `SELECT o.id, o.table_number, o.status, o.placed_at, o.ready_at, o.served_at,
              o.cancelled_at, o.archived_at, o.alert_acked_at, o.primary_waiter_id, o.updated_at,
              w.display_name AS primary_waiter_name,
              ab.id AS acked_by_id, ab.display_name AS acked_by_name,
              floor(EXTRACT(EPOCH FROM (now() - o.placed_at)) / 60)::int AS minutes_open,
              (SELECT COALESCE(sum(l.quantity * l.unit_price) FILTER (WHERE l.voided_at IS NULL), 0)::numeric(10,2)
                 FROM order_lines l WHERE l.order_id = o.id) AS total
         FROM orders o
         JOIN users w ON w.id = o.primary_waiter_id
         LEFT JOIN users ab ON ab.id = o.alert_acked_by
        WHERE ${ALERTING}
        ORDER BY o.placed_at ASC, o.id ASC`,
      scopedParams(req.user, slowOrderMinutes, repeatMinutes)
    );

    res.json({
      // The thresholds travel with the answer so the UI can say "open 48 minutes, limit is 20"
      // without a second copy of the configuration baked into the frontend.
      thresholds: { slowOrderMinutes, repeatMinutes },
      alerts: rows.map((row) => ({
        ...toOrder(row),
        minutesOpen: row.minutes_open,
        // Present and in the past means the acknowledgement has expired and this alert has
        // come back — a different thing for a UI to show than one nobody has seen yet.
        previouslyAcknowledgedAt: row.alert_acked_at,
        previouslyAcknowledgedBy:
          row.acked_by_id === null
            ? null
            : { id: row.acked_by_id, displayName: row.acked_by_name },
      })),
    });
  });

  // Separate from GET /alerts because every open tab polls this every ~45 seconds and all it
  // needs to return is an integer. Sending the full alert list that often would be most of a
  // free tier's budget spent on a number in a nav badge.
  router.get('/count', requireAuth, async (req, res) => {
    const { slowOrderMinutes, repeatMinutes } = alertThresholds();

    const { rows } = await query(
      `SELECT count(*)::int AS count FROM orders o WHERE ${ALERTING}`,
      scopedParams(req.user, slowOrderMinutes, repeatMinutes)
    );

    res.json({ count: rows[0].count });
  });

  return router;
}
