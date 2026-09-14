// The Express application: routes and middleware, but no port binding.
//
// Kept separate from server.js so the app can be imported and exercised without opening a
// socket.

import express from 'express';
import { alertRoutes } from './alerts/routes.js';
import { authRoutes } from './auth/routes.js';
import { dashboardRoutes } from './dashboard/routes.js';
import { query } from './db.js';
import { cors } from './http/cors.js';
import { errorHandler, notFound } from './http/errors.js';
import { menuRoutes } from './menu/routes.js';
import { orderRoutes } from './orders/routes.js';
import { userRoutes } from './users/routes.js';

export function createApp() {
  const app = express();

  app.disable('x-powered-by'); // no free advertising of the stack

  // First, and before the body parser: a preflight has no body to parse and should be answered
  // and finished with, not carried through the rest of the stack.
  app.use(cors());

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

  app.use('/auth', authRoutes());
  app.use('/users', userRoutes());
  app.use('/menu-items', menuRoutes());
  app.use('/orders', orderRoutes());
  app.use('/alerts', alertRoutes());
  app.use('/dashboard', dashboardRoutes());

  // Nothing matched. Thrown rather than sent, so unknown routes and every other failure leave
  // through the same door and come back in the same shape.
  app.use((req) => {
    throw notFound(`No route for ${req.method} ${req.path}`, { code: 'ROUTE_NOT_FOUND' });
  });

  // Last, and after every route: Express runs middleware in registration order, so an error
  // handler registered before a route never sees that route's errors.
  app.use(errorHandler);

  return app;
}
