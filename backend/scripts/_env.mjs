// Shared bootstrap for the db:* scripts.
//
// Node 20.12+ can read a .env file itself, so there is no dotenv dependency. On a real host
// (Render, Vercel) there is no .env file and the environment is already populated — hence the
// silent miss rather than an error.

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { poolConfig } from '../src/db.js';

const backendDir = join(dirname(fileURLToPath(import.meta.url)), '..');

export function loadEnv() {
  const envPath = join(backendDir, '.env');
  if (existsSync(envPath)) process.loadEnvFile(envPath);
  return envPath;
}

/**
 * A single connection over DIRECT_URL (Supabase session mode) — what migrations, seeding and
 * verification all want. Missing configuration is a setup mistake, not a crash: print the one
 * line that fixes it rather than a stack trace into node:internal.
 */
export function newDirectClient() {
  loadEnv();
  try {
    return new pg.Client(poolConfig({ direct: true }));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
