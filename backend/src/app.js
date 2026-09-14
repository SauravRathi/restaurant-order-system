// The Express application: routes and middleware, but no port binding.
//
// Kept separate from server.js so the app can be imported and exercised without opening a
// socket. Right now it carries only the two health routes; the real API is session 4.

import express from 'express';
import { query } from './db.js';

export function createApp() {
  const app = express();

  app.disable('x-powered-by'); // no free advertising of the stack
  app.use(express.json({ limit: '100kb' }));

  // Liveness. Touches nothing, so a 200 here means the process is up and reachable and
  // nothing more. This is the one Render polls.
  app.get('/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'restaurant-orders-api',
      env: process.env.NODE_ENV ?? 'development',
      uptimeSec: Math.round(process.uptime()),
    });
  });

  // Readiness. `SELECT 1` through the same pool the API will use, so this is the smallest
  // statement that proves this host can reach Supabase through the transaction pooler.
  // It reads no table and would pass against an empty database — it is a reachability
  // check, not a data check.
  app.get('/health/db', async (_req, res) => {
    const startedAt = process.hrtime.bigint();
    try {
      await query('SELECT 1');
      const latencyMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      res.json({ ok: true, latencyMs: Math.round(latencyMs) });
    } catch (err) {
      // Deliberately not err.message: pg puts the host, port and sometimes the role into it,
      // and this endpoint is public. The code ('ENOTFOUND', '28P01', ...) is enough to
      // diagnose from, and the full error goes to the server log where only we can read it.
      console.error('[health/db]', err.message);
      res.status(503).json({ ok: false, error: err.code ?? 'DB_UNREACHABLE' });
    }
  });

  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

  return app;
}
