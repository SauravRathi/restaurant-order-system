// Checks that the database actually enforces what docs/schema.md claims it enforces.
//
// This is not the application test suite. It is the evidence for the row in schema.md's
// "database vs application constraints" table that says "Database": every rule listed there
// as living in Postgres gets tried here from a privileged psql-equivalent connection, and has
// to fail. A rule that only holds because the API is polite does not belong in that column.
//
// Every write runs inside a transaction that is rolled back, so this is safe against the
// seeded demo database. Run it after `npm run db:seed`.

import { loadEnv, newDirectClient } from './_env.mjs';

loadEnv();

const tz = process.env.RESTAURANT_TZ || 'Asia/Kolkata';
const slowMins = Number(process.env.SLOW_ORDER_MINUTES ?? 20);
const repeatMins = Number(process.env.ALERT_REPEAT_MINUTES ?? 10);

const client = newDirectClient();
await client.connect();

let passed = 0;
const failures = [];

function record(label, ok, detail) {
  if (ok) {
    passed += 1;
    console.log(`  pass  ${label}`);
  } else {
    failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

/** The statement must be rejected by the database. */
async function mustReject(label, sql, params = []) {
  await client.query('BEGIN');
  try {
    await client.query(sql, params);
    record(label, false, 'the database allowed it');
  } catch {
    record(label, true);
  } finally {
    await client.query('ROLLBACK');
  }
}

/** The statement must succeed. */
async function mustAllow(label, sql, params = []) {
  await client.query('BEGIN');
  try {
    await client.query(sql, params);
    record(label, true);
  } catch (err) {
    record(label, false, err.message);
  } finally {
    await client.query('ROLLBACK');
  }
}

async function check(label, sql, params, predicate) {
  try {
    const { rows } = await client.query(sql, params);
    const verdict = predicate(rows);
    record(label, verdict === true, typeof verdict === 'string' ? verdict : undefined);
  } catch (err) {
    record(label, false, err.message);
  }
}

try {
  console.log('\nSchema objects');
  await check(
    'six tables, three enums, four triggers exist',
    `SELECT
       (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind = 'r'
           AND c.relname IN ('users','menu_items','orders','order_collaborators','order_lines','order_timeline')) AS tables,
       (SELECT count(*) FROM pg_type WHERE typname IN ('user_role','order_status','timeline_action')) AS enums,
       (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal
         AND tgname IN ('order_timeline_immutable','order_timeline_immutable_truncate','orders_touch','menu_items_touch')) AS triggers`,
    [],
    ([r]) =>
      (Number(r.tables) === 6 && Number(r.enums) === 3 && Number(r.triggers) === 4) ||
      `tables=${r.tables} enums=${r.enums} triggers=${r.triggers}`
  );

  console.log('\n§9 — history you cannot rewrite');
  await mustReject(
    'UPDATE on order_timeline is rejected',
    `UPDATE order_timeline SET note = 'rewritten' WHERE id = (SELECT min(id) FROM order_timeline)`
  );
  await mustReject(
    'DELETE on order_timeline is rejected',
    `DELETE FROM order_timeline WHERE id = (SELECT min(id) FROM order_timeline)`
  );
  await mustReject('TRUNCATE on order_timeline is rejected', 'TRUNCATE order_timeline');

  console.log('\n§4/§7 — value rules the database owns');
  await mustReject(
    'negative menu price is rejected',
    `INSERT INTO menu_items (name, category, price) VALUES ('Impossible Item', 'Mains', -1)`
  );
  await mustReject(
    'zero quantity on an order line is rejected',
    `INSERT INTO order_lines (order_id, menu_item_id, item_name, unit_price, quantity)
     SELECT (SELECT min(id) FROM orders), (SELECT min(id) FROM menu_items), 'x', 10, 0`
  );
  await mustReject(
    'voiding a line without a reason is rejected',
    `UPDATE order_lines
        SET voided_at = now(), voided_by = (SELECT min(id) FROM users), void_reason = '   '
      WHERE id = (SELECT min(id) FROM order_lines WHERE voided_at IS NULL)`
  );
  await mustReject(
    'a seventh order status cannot exist',
    `UPDATE orders SET status = 'refunded' WHERE id = (SELECT min(id) FROM orders)`
  );
  await mustReject(
    'a status_changed timeline row without from/to is rejected',
    `INSERT INTO order_timeline (order_id, actor_id, action)
     VALUES ((SELECT min(id) FROM orders), (SELECT min(id) FROM users), 'status_changed')`
  );
  await mustReject(
    'two live menu items cannot share a name',
    `INSERT INTO menu_items (name, category, price)
     SELECT lower(name), category, price FROM menu_items WHERE archived_at IS NULL LIMIT 1`
  );
  await mustAllow(
    'an archived name can be re-created',
    `INSERT INTO menu_items (name, category, price)
     SELECT name, category, price FROM menu_items WHERE archived_at IS NOT NULL LIMIT 1`
  );
  await mustReject(
    'the same collaborator cannot be added twice',
    `INSERT INTO order_collaborators (order_id, user_id, added_by)
     SELECT order_id, user_id, added_by FROM order_collaborators LIMIT 1`
  );
  await mustReject(
    'email is unique case-insensitively (citext)',
    `INSERT INTO users (email, password_hash, display_name, role)
     VALUES ('Manager@Demo.TEST', 'x', 'Impostor', 'manager')`
  );

  console.log('\nSeeded data answers the brief');
  await check(
    '§3 running total excludes voided lines',
    `SELECT o.id,
            COALESCE(sum(l.quantity * l.unit_price) FILTER (WHERE l.voided_at IS NULL), 0) AS total,
            count(*) FILTER (WHERE l.voided_at IS NOT NULL) AS voided
       FROM orders o JOIN order_lines l ON l.order_id = o.id
      GROUP BY o.id HAVING count(*) FILTER (WHERE l.voided_at IS NOT NULL) > 0`,
    [],
    (rows) => rows.length > 0 || 'no order with a voided line was seeded'
  );
  await check(
    '§5 a waiter sees orders where they are primary OR collaborator',
    `SELECT count(*) AS n FROM orders o
      WHERE o.archived_at IS NULL
        AND (o.primary_waiter_id = (SELECT id FROM users WHERE email = 'meera@demo.test')
             OR EXISTS (SELECT 1 FROM order_collaborators c
                         WHERE c.order_id = o.id
                           AND c.user_id = (SELECT id FROM users WHERE email = 'meera@demo.test')))`,
    [],
    ([r]) => Number(r.n) > 0 || 'Meera has no visible orders'
  );
  await check(
    `§10 alerts fire past ${slowMins}m and stay quiet for ${repeatMins}m after an ack`,
    `SELECT o.table_number, o.alert_acked_at IS NOT NULL AS acked
       FROM orders o
      WHERE o.archived_at IS NULL
        AND o.status IN ('placed','accepted','preparing')
        AND o.placed_at < now() - make_interval(mins => $1)
        AND (o.alert_acked_at IS NULL OR o.alert_acked_at < now() - make_interval(mins => $2))`,
    [slowMins, repeatMins],
    (rows) => {
      const tables = rows.map((r) => r.table_number);
      if (!tables.includes('T12')) return 'the slow unacknowledged order (T12) is missing';
      if (tables.includes('T4')) return 'the just-acknowledged order (T4) should be suppressed';
      return true;
    }
  );
  await check(
    '§8 today has revenue and a served count',
    `SELECT (SELECT count(*) FROM orders
              WHERE status = 'served'
                AND (served_at AT TIME ZONE $1)::date = (now() AT TIME ZONE $1)::date) AS served_today,
            (SELECT COALESCE(sum(l.quantity * l.unit_price), 0)
               FROM orders o JOIN order_lines l ON l.order_id = o.id
              WHERE o.status = 'served' AND l.voided_at IS NULL
                AND (o.served_at AT TIME ZONE $1)::date = (now() AT TIME ZONE $1)::date) AS revenue_today`,
    [tz],
    ([r]) =>
      (Number(r.served_today) > 0 && Number(r.revenue_today) > 0) ||
      `served_today=${r.served_today} revenue_today=${r.revenue_today}`
  );
  await check(
    '§8 fourteen days of served-per-day history, zero-filled',
    `WITH days AS (
       SELECT generate_series((now() AT TIME ZONE $1)::date - 13,
                              (now() AT TIME ZONE $1)::date, '1 day')::date AS d)
     SELECT count(*) AS days, count(*) FILTER (WHERE served > 0) AS days_with_orders FROM (
       SELECT d, count(o.id) AS served
         FROM days LEFT JOIN orders o
           ON (o.served_at AT TIME ZONE $1)::date = days.d AND o.status = 'served'
        GROUP BY d) t`,
    [tz],
    ([r]) =>
      (Number(r.days) === 14 && Number(r.days_with_orders) >= 13) ||
      `days=${r.days} with orders=${r.days_with_orders}`
  );

  console.log('\nSupabase exposure');
  await check(
    'RLS is on for every table',
    `SELECT count(*) AS unprotected FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity`,
    [],
    ([r]) => Number(r.unprotected) === 0 || `${r.unprotected} table(s) without RLS`
  );
  await check(
    'anon and authenticated have no table privileges',
    `SELECT count(*) AS grants FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated')`,
    [],
    ([r]) => Number(r.grants) === 0 || `${r.grants} grant(s) still in place`
  );
} finally {
  await client.end();
}

console.log(
  `\n${passed} passed, ${failures.length} failed` + (failures.length ? `:\n  - ${failures.join('\n  - ')}` : '')
);
process.exitCode = failures.length ? 1 : 0;
