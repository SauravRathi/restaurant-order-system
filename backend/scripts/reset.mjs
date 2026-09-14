// Drops every object this project owns, so `db:migrate` can rebuild from nothing.
//
// Development only. Requires --force, and refuses outright if NODE_ENV=production. The
// timeline's append-only trigger is turned off for the drop itself — see the note in
// seed/001_demo.sql for why that is possible here and impossible from the API.

import { loadEnv, newDirectClient } from './_env.mjs';
import { connectionString } from '../src/db.js';

loadEnv();

if (!process.argv.includes('--force')) {
  let host = 'the configured database';
  try {
    host = new URL(connectionString({ direct: true }).replace(/^postgres(ql)?:/, 'http:')).host;
  } catch {
    /* no config yet; the generic wording is fine */
  }
  console.error(`This DROPs every table, enum, function and trigger on ${host}.`);
  console.error('Re-run with --force if that is what you want.');
  process.exit(1);
}
if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to reset with NODE_ENV=production.');
  process.exit(1);
}

const client = newDirectClient();
await client.connect();

try {
  await client.query(`
    BEGIN;

    DO $$ BEGIN
      IF to_regclass('public.order_timeline') IS NOT NULL THEN
        ALTER TABLE order_timeline DISABLE TRIGGER order_timeline_immutable;
        ALTER TABLE order_timeline DISABLE TRIGGER order_timeline_immutable_truncate;
      END IF;
    END $$;

    DROP TABLE IF EXISTS order_timeline, order_lines, order_collaborators,
                         orders, menu_items, users, schema_migrations CASCADE;

    DROP FUNCTION IF EXISTS order_timeline_forbid_change() CASCADE;
    DROP FUNCTION IF EXISTS touch_updated_at() CASCADE;

    -- Named without its signature, because the enum in that signature may already be gone.
    DO $$
    DECLARE p oid;
    BEGIN
      FOR p IN SELECT oid FROM pg_proc WHERE proname = 'seed_place_order'
      LOOP
        EXECUTE format('DROP FUNCTION %s', p::regprocedure);
      END LOOP;
    END $$;

    DROP TYPE IF EXISTS timeline_action;
    DROP TYPE IF EXISTS order_status;
    DROP TYPE IF EXISTS user_role;

    COMMIT;
  `);
  console.log('Dropped. Run `npm run db:migrate` to rebuild.');
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
