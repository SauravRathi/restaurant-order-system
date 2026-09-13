// Loads backend/seed/*.sql, then prints what the demo database now contains.
//
// The seed TRUNCATEs, so this refuses to run when NODE_ENV=production unless you pass
// --force. Nothing here is clever; the guard exists because "npm run db:seed" against the
// live URL on submission day is an entirely plausible mistake.

import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv, newDirectClient } from './_env.mjs';

loadEnv();

const force = process.argv.includes('--force');
if (process.env.NODE_ENV === 'production' && !force) {
  console.error('Refusing to seed with NODE_ENV=production (it truncates). Pass --force if you mean it.');
  process.exit(1);
}

const seedDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'seed');
const tz = process.env.RESTAURANT_TZ || 'Asia/Kolkata';

const client = newDirectClient();
await client.connect();

// The seed's RAISE NOTICE lines are worth seeing.
client.on('notice', (n) => console.log(`  ${n.message}`));

try {
  // The seed reads this to decide what "day" means; see Decision 11.
  await client.query('SELECT set_config($1, $2, false)', ['app.restaurant_tz', tz]);

  for (const filename of (await readdir(seedDir)).filter((f) => f.endsWith('.sql')).sort()) {
    process.stdout.write(`Seeding ${filename} ... `);
    await client.query(await readFile(join(seedDir, filename), 'utf8'));
    console.log('ok');
  }

  const { rows } = await client.query(
    `
    SELECT (SELECT count(*) FROM users)                                        AS users,
           (SELECT count(*) FROM menu_items WHERE archived_at IS NULL)         AS live_menu_items,
           (SELECT count(*) FROM orders)                                       AS orders,
           (SELECT count(*) FROM orders WHERE archived_at IS NULL
                                          AND status NOT IN ('served','cancelled')) AS open_orders,
           (SELECT count(*) FROM orders
             WHERE (placed_at AT TIME ZONE $1)::date = (now() AT TIME ZONE $1)::date) AS placed_today,
           (SELECT count(*) FROM orders
             WHERE status = 'served'
               AND (served_at AT TIME ZONE $1)::date = (now() AT TIME ZONE $1)::date) AS served_today,
           (SELECT COALESCE(sum(l.quantity * l.unit_price), 0)
              FROM orders o JOIN order_lines l ON l.order_id = o.id
             WHERE o.status = 'served'
               AND l.voided_at IS NULL
               AND (o.served_at AT TIME ZONE $1)::date = (now() AT TIME ZONE $1)::date) AS revenue_today,
           (SELECT count(*) FROM order_lines)                                  AS order_lines,
           (SELECT count(*) FROM order_timeline)                               AS timeline_events
    `,
    [tz]
  );

  console.log(`\nDemo data (restaurant timezone ${tz}):`);
  for (const [k, v] of Object.entries(rows[0])) {
    console.log(`  ${k.padEnd(16)} ${v}`);
  }
  console.log('\nDemo logins — manager@demo.test / Manager@123');
  console.log('              arjun@demo.test, meera@demo.test, ravi@demo.test / Waiter@123');
} catch (err) {
  console.log('FAILED');
  console.error(`\n${err.message}`);
  if (err.hint) console.error(`hint: ${err.hint}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
