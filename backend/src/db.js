// Connection pool. The only place in the app that knows how to reach Postgres.
//
// Supabase gives three connection strings and they are not interchangeable:
//
//   Direct      db.<ref>.supabase.co:5432          IPv6-only. Render's free tier has no IPv6,
//                                                  so this works from a laptop and not from
//                                                  the deployed API.
//   Session     ...pooler.supabase.com:5432        Supavisor, one Postgres connection per
//                                                  client connection. Supports prepared
//                                                  statements, LISTEN, session advisory locks.
//   Transaction ...pooler.supabase.com:6543        Supavisor, a connection borrowed per
//                                                  transaction. What you want for a web API on
//                                                  a free tier, because the API is mostly idle.
//
// So: DATABASE_URL is the transaction pooler (runtime), DIRECT_URL is session mode (migrations,
// which want a stable session for the advisory lock). See docs/architecture.md.


import pg from 'pg';

const { Pool, types } = pg;

// NUMERIC comes back from pg as a string by default, to avoid float rounding. Keep it that
// way — money is NUMERIC(10,2) precisely so it never becomes a float (docs/schema.md) — and
// let the service layer decide how to present it.
// (Left explicit rather than implicit so nobody "fixes" it with a parseFloat parser later.)
types.setTypeParser(types.builtins.NUMERIC, (v) => v);

// BIGINT (int8) likewise arrives as a string. Our ids fit in a JS number today, but silently
// parsing them would be a bug waiting for row 2^53.
types.setTypeParser(types.builtins.INT8, (v) => v);

export function connectionString({ direct = false } = {}) {
  const url = direct
    ? process.env.DIRECT_URL || process.env.DATABASE_URL
    : process.env.DATABASE_URL;

  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Copy backend/.env.example to backend/.env and fill it in.'
    );
  }
  return url;
}

export function poolConfig({ direct = false, max } = {}) {
  return {
    connectionString: connectionString({ direct }),

    // Supabase terminates TLS at the pooler with its own certificate chain. Verifying it
    // properly means shipping the Supabase CA bundle; for this project we require TLS but do
    // not verify the chain, which stops passive eavesdropping but not an active MITM between
    // Render and Supabase. Flip PGSSL_REJECT_UNAUTHORIZED=true once the CA is pinned.
    ssl: { rejectUnauthorized: process.env.PGSSL_REJECT_UNAUTHORIZED === 'true' },

    // citext's `=` operator and gin_trgm_ops live in the extensions schema (migration 001).
    // 001 also sets this at database level; this is the belt to that braces, and it is what
    // makes the app work if it ever connects as a role with its own search_path.
    options: '-c search_path=public,extensions',

    // Free tier: a small pool that is actually returned matters more than a big one. Render's
    // free instance is single-process, and Supavisor is shared.
    max: max ?? Number(process.env.PGPOOL_MAX ?? 5),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // The free database pauses after a week idle and the first connection after that is slow.
    statement_timeout: 15_000,
  };
}

// Created on first use, not at import. The migration and seed scripts import poolConfig() from
// here and connect with DIRECT_URL; building a DATABASE_URL pool as a side effect of importing
// this file would make them fail before they could print a useful message.
let _pool;

export function getPool() {
  if (!_pool) {
    _pool = new Pool(poolConfig());
    // An unhandled error on an idle client takes the process down otherwise.
    _pool.on('error', (err) => console.error('[db] idle client error:', err.message));
  }
  return _pool;
}

export const query = (text, params) => getPool().query(text, params);

export const closePool = async () => {
  if (_pool) await _pool.end();
  _pool = undefined;
};

/** Run `fn` inside a transaction, rolling back on any throw. */
export async function withTransaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
