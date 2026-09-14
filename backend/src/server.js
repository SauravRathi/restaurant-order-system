// Process entry point: load configuration, bind the port, shut down cleanly.

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { closePool } from './db.js';

// Same guarded load as scripts/_env.mjs, and for the same reason: there is a .env on a
// laptop and there is none on Render, where the variables are injected into the environment
// already. A missing file is normal, not an error.
const backendDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(backendDir, '.env');
if (existsSync(envPath)) process.loadEnvFile(envPath);

// Render assigns the port and expects the process to bind 0.0.0.0; a server listening only
// on localhost looks dead to its router.
const port = Number(process.env.PORT ?? 4000);

const server = createApp().listen(port, '0.0.0.0', () => {
  console.log(`[api] listening on :${port} (${process.env.NODE_ENV ?? 'development'})`);
});

// Render sends SIGTERM on every redeploy. Closing the pool returns the Supavisor connections
// instead of leaving them to time out, which matters on a shared free tier.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    console.log(`[api] ${signal} received, shutting down`);
    server.close(async () => {
      await closePool();
      process.exit(0);
    });
    // Don't hang forever on a stuck connection. unref() so this timer alone cannot keep
    // the process alive once everything else has finished.
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
