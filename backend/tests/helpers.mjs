// Shared bootstrap for the API tests.
//
// The app is started in-process on an ephemeral port rather than shelling out to `npm start`:
// the tests then need no port to be free, no sleep waiting for a server to come up, and no
// stray process left behind when one of them throws.
//
// These run against the real database, because what is being tested is the behaviour the
// database and the API produce together — visibility, transitions, snapshots, append-only
// history. A mocked pg would only assert that the mocks were written to agree with the code.
//
// Consequence worth knowing: tests that create orders cannot clean up after themselves. The
// append-only trigger on order_timeline refuses DELETE, which is exactly the §9 property the
// brief asks for, so each run leaves its fixtures behind. Assertions are therefore written
// against relative facts — "the total rose by quantity x price", "this waiter gets 404" —
// rather than absolute counts, so the suite stays green as the table grows. `npm run db:seed`
// resets to the demo fixture whenever the accumulation gets untidy.

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.js';
import { closePool, query } from '../src/db.js';

const backendDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(backendDir, '.env');
if (existsSync(envPath)) process.loadEnvFile(envPath);

export { query };

export const MANAGER = { email: 'manager@demo.test', password: 'Manager@123' };
export const ARJUN = { email: 'arjun@demo.test', password: 'Waiter@123' };
export const MEERA = { email: 'meera@demo.test', password: 'Waiter@123' };
export const RAVI = { email: 'ravi@demo.test', password: 'Waiter@123' };

let server;
let base;

export async function startApi() {
  server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  return base;
}

export async function stopApi() {
  if (server) await new Promise((resolve) => server.close(resolve));
  await closePool();
}

/**
 * One request. Returns the status, the parsed body, and the response headers.
 *
 * `body` is serialised as JSON; `raw` is sent through untouched, which is the only way to
 * exercise the "this is not JSON" path that express.json rejects before any route sees it.
 */
export async function api(method, path, { token, body, raw, headers = {} } = {}) {
  const sent = { ...headers };
  if (body !== undefined || raw !== undefined) {
    sent['content-type'] = sent['content-type'] ?? 'application/json';
  }
  if (token) sent.authorization = `Bearer ${token}`;

  const res = await fetch(base + path, {
    method,
    headers: sent,
    body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
  });

  // Read the bytes, not res.text(): the WHATWG UTF-8 decoder strips a leading byte order mark,
  // so res.text() cannot see the BOM the CSV export deliberately sends. Decoding from the
  // buffer ourselves keeps `text` faithful and leaves `bytes` available for header assertions.
  const bytes = Buffer.from(await res.arrayBuffer());
  const text = bytes.toString('utf8');

  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* CSV and 204s are not JSON */
  }
  return { status: res.status, json, text, bytes, headers: res.headers };
}

export async function login({ email, password }) {
  const res = await api('POST', '/auth/login', { body: { email, password } });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.text}`);
  return res.json.token;
}

/** A fresh order, owned by whoever the token belongs to. */
export async function newOrder(token, tableNumber = 'TEST') {
  const res = await api('POST', '/orders', { token, body: { tableNumber } });
  if (res.status !== 201) throw new Error(`could not create an order: ${res.text}`);
  return res.json.order;
}

/** A live, available menu item to hang order lines off. */
export async function anyAvailableItem(token) {
  const res = await api('GET', '/menu-items', { token });
  const item = res.json.menuItems.find((m) => m.isAvailable && m.archivedAt === null);
  if (!item) throw new Error('the menu has no available item to test with');
  return item;
}

/** A menu item created for one test, so nothing seeded is mutated. */
export async function newMenuItem(token, name, price = 100) {
  const res = await api('POST', '/menu-items', {
    token,
    body: { name: `${name} ${Date.now()}${Math.random().toString(36).slice(2, 6)}`, category: 'TEST', price },
  });
  if (res.status !== 201) throw new Error(`could not create a menu item: ${res.text}`);
  return res.json.menuItem;
}
