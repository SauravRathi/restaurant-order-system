// §8. One endpoint, restaurant-wide, for both roles.
//
// This is the one read in the API that is NOT scoped by the visibility predicate, and that is
// deliberate: a waiter seeing the restaurant's takings and how the floor is doing is the point
// of a dashboard. Scoping it would give each waiter a private dashboard of their own orders,
// which is a different feature nobody asked for. Nothing here identifies an order a waiter
// could not otherwise see — the by-waiter table is names and counts.

import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { alertPredicateSql, alertThresholds } from '../alerts/predicate.js';
import { query } from '../db.js';

// "Today" is a date in the restaurant's timezone. The API host runs in UTC, where a 23:30 IST
// dinner has already become tomorrow (Decision 11), so every date in this file is converted
// before it is compared.
const TODAY = `(now() AT TIME ZONE $1)::date`;

// The non-voided value of one order. A LATERAL join rather than a correlated subquery repeated
// in three places, so the definition of "what an order is worth" appears once per query.
const ORDER_VALUE = `
  LEFT JOIN LATERAL (
    SELECT COALESCE(sum(l.quantity * l.unit_price) FILTER (WHERE l.voided_at IS NULL), 0) AS total
      FROM order_lines l WHERE l.order_id = o.id
  ) v ON true`;

export function dashboardRoutes() {
  const router = Router();

  router.get('/', requireAuth, async (req, res) => {
    const tz = process.env.RESTAURANT_TZ || 'Asia/Kolkata';
    const { slowOrderMinutes, repeatMinutes } = alertThresholds();

    // Four queries, issued together. Each pool.query acquires a connection, runs, and releases
    // it independently of the others, so this queues under a busy pool rather than deadlocking
    // — and on an idle one it costs a single round trip of latency instead of four.
    const [headlines, byStatus, byWaiter, servedPerDay] = await Promise.all([
      query(
        `SELECT
           (SELECT count(*)::int FROM orders
             WHERE (placed_at AT TIME ZONE $1)::date = ${TODAY})              AS orders_placed_today,
           (SELECT count(*)::int FROM orders
             WHERE status = 'served'
               AND (served_at AT TIME ZONE $1)::date = ${TODAY})              AS orders_served_today,
           (SELECT COALESCE(sum(l.quantity * l.unit_price), 0)::numeric(10,2)
              FROM orders o JOIN order_lines l ON l.order_id = o.id
             WHERE o.status = 'served' AND l.voided_at IS NULL
               AND (o.served_at AT TIME ZONE $1)::date = ${TODAY})            AS revenue_today,
           (SELECT count(*)::int FROM orders
             WHERE archived_at IS NULL
               AND status IN ('placed','accepted','preparing','ready'))       AS active_orders,
           (SELECT count(*)::int FROM orders o
             WHERE ${alertPredicateSql({ slowParam: '$2', repeatParam: '$3' })}) AS alerting_orders`,
        [tz, slowOrderMinutes, repeatMinutes]
      ),

      // enum_range gives all six statuses whether or not any order is in them, so a status
      // with no orders comes back as a zero instead of vanishing from the chart. Ordering by
      // array_position keeps them in lifecycle order rather than alphabetical.
      query(
        `SELECT s.status,
                count(o.id)::int AS orders,
                COALESCE(sum(v.total), 0)::numeric(10,2) AS total
           FROM unnest(enum_range(NULL::order_status)) AS s(status)
           LEFT JOIN orders o ON o.status = s.status AND o.archived_at IS NULL
           ${ORDER_VALUE}
          GROUP BY s.status
          ORDER BY array_position(enum_range(NULL::order_status), s.status)`
      ),

      // Every waiter appears, including one who has taken nothing today — an empty row is the
      // informative part of a by-waiter chart. A manager appears only if they actually took an
      // order today, which the seed's manager does not.
      query(
        `SELECT u.id, u.display_name, u.role,
                count(o.id)::int AS orders_today,
                count(o.id) FILTER (WHERE o.status = 'served')::int AS served_today,
                COALESCE(sum(v.total) FILTER (WHERE o.status = 'served'), 0)::numeric(10,2) AS revenue_today
           FROM users u
           LEFT JOIN orders o
             ON o.primary_waiter_id = u.id
            AND (o.placed_at AT TIME ZONE $1)::date = ${TODAY}
           ${ORDER_VALUE}
          WHERE u.role = 'waiter' OR o.id IS NOT NULL
          GROUP BY u.id, u.display_name, u.role
          ORDER BY orders_today DESC, u.display_name`,
        [tz]
      ),

      // Zero-filled from a generated series, so a quiet day is a gap in the line rather than a
      // missing point that the chart would silently close up.
      query(
        `WITH days AS (
           SELECT generate_series(${TODAY} - 13, ${TODAY}, '1 day')::date AS d
         )
         SELECT to_char(days.d, 'YYYY-MM-DD') AS date,
                count(o.id)::int AS served,
                COALESCE(sum(v.total), 0)::numeric(10,2) AS revenue
           FROM days
           LEFT JOIN orders o
             ON o.status = 'served'
            AND (o.served_at AT TIME ZONE $1)::date = days.d
           ${ORDER_VALUE}
          GROUP BY days.d
          ORDER BY days.d`,
        [tz]
      ),
    ]);

    const h = headlines.rows[0];
    res.json({
      timezone: tz,
      headlines: {
        ordersPlacedToday: h.orders_placed_today,
        ordersServedToday: h.orders_served_today,
        revenueToday: h.revenue_today,
        activeOrders: h.active_orders,
        alertingOrders: h.alerting_orders,
      },
      byStatus: byStatus.rows.map((r) => ({
        status: r.status,
        orders: r.orders,
        total: r.total,
      })),
      byWaiter: byWaiter.rows.map((r) => ({
        waiter: { id: r.id, displayName: r.display_name, role: r.role },
        ordersToday: r.orders_today,
        servedToday: r.served_today,
        revenueToday: r.revenue_today,
      })),
      servedPerDay: servedPerDay.rows.map((r) => ({
        date: r.date,
        served: r.served,
        revenue: r.revenue,
      })),
    });
  });

  return router;
}
