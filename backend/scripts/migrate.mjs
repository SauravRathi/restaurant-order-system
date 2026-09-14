// Applies every unapplied file in backend/migrations, in filename order.
//
// Small on purpose: numbered SQL files and a table recording which have run. 
// Each file runs in its own transaction, so a
// failure leaves the database on the last good migration rather than half-way through one.
//
//   node scripts/migrate.mjs           apply pending
//   node scripts/migrate.mjs --status  list without applying

import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { newDirectClient } from './_env.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', 'migrations');
const statusOnly = process.argv.includes('--status');

// Any constant works; it just has to be the same number in every process that migrates.
const LOCK_KEY = 8_150_923;

const client = newDirectClient();
await client.connect();

try {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  // Stops two deploys racing the same migration. Session-scoped, which is why this script
  // uses DIRECT_URL (session mode) rather than the transaction pooler — see src/db.js.
  await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);

  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
  const { rows } = await client.query('SELECT filename FROM schema_migrations');
  const applied = new Set(rows.map((r) => r.filename));

  const pending = files.filter((f) => !applied.has(f));

  if (statusOnly) {
    for (const f of files) console.log(`${applied.has(f) ? '  applied' : '  PENDING'}  ${f}`);
    if (!files.length) console.log('  (no migration files found)');
  } else if (!pending.length) {
    console.log(`Up to date — ${applied.size} migration(s) already applied.`);
  } else {
    for (const filename of pending) {
      const sql = await readFile(join(migrationsDir, filename), 'utf8');
      process.stdout.write(`Applying ${filename} ... `);

      // The migration files manage their own BEGIN/COMMIT so they can also be pasted into the
      // Supabase SQL editor. Wrapping them again here would nest transactions; instead each
      // file is a single multi-statement query, which pg sends as one implicit transaction
      // when the file does not open one itself.
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
        console.log('ok');
      } catch (err) {
        console.log('FAILED');
        console.error(`\n${filename}: ${err.message}`);
        if (err.hint) console.error(`hint: ${err.hint}`);
        if (err.position) console.error(`position: ${err.position}`);
        process.exitCode = 1;
        break;
      }
    }
  }
} finally {
  await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
  await client.end();
}
