// Throwaway. Not part of any session, not intended to be merged.
//
// Proves exactly three things about the API host: that it can run this Node version, that it can
// bind the port assigned to it, and that it can reach Supabase through the transaction pooler.
// It uses src/db.js unchanged, so the TLS and pooling configuration under test is the real one.
//
// No express, no new dependency. Start it with: node deploy-test-server.mjs

import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { query } from './src/db.js';

// There is a .env on a laptop and none on the host, where the variables are already set.
const backendDir = dirname(fileURLToPath(import.meta.url));
const envPath = join(backendDir, '.env');
if (existsSync(envPath)) process.loadEnvFile(envPath);

const port = Number(process.env.PORT ?? 4000);

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;

  // Liveness: touches nothing. A 200 means the process is up and reachable, and no more.
  if (path === '/health') {
    return send(res, 200, {
      ok: true,
      env: process.env.NODE_ENV ?? 'development',
      node: process.version,
      uptimeSec: Math.round(process.uptime()),
    });
  }

  // Readiness: the smallest statement that proves this host can reach the database.
  if (path === '/health/db') {
    const startedAt = process.hrtime.bigint();
    try {
      await query('SELECT 1');
      const latencyMs = Math.round(Number(process.hrtime.bigint() - startedAt) / 1e6);
      return send(res, 200, { ok: true, latencyMs });
    } catch (err) {
      // The code only. pg puts the host, port and sometimes the role into err.message, and
      // this endpoint is public; the full error belongs in the log.
      console.error('[health/db]', err.message);
      return send(res, 503, { ok: false, error: err.code ?? 'DB_UNREACHABLE' });
    }
  }

  send(res, 404, { error: 'Not found' });
});

// 0.0.0.0, not localhost: a process bound only to the loopback looks dead to the host's router.
server.listen(port, '0.0.0.0', () => {
  console.log(`[deploy-test] listening on :${port}`);
});
