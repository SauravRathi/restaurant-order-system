// Cross-origin access, and the CSV export (§7).

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { ARJUN, MANAGER, api, login, startApi, stopApi } from './helpers.mjs';

const ALLOWED = 'http://localhost:5173';
const DENIED = 'https://evil.example';

let manager, arjun;

before(async () => {
  // Set explicitly so the suite tests the middleware rather than whatever .env happens to say.
  process.env.CORS_ORIGINS = ALLOWED;
  await startApi();
  [manager, arjun] = await Promise.all([MANAGER, ARJUN].map(login));
});
after(stopApi);

describe('CORS', () => {
  // If a preflight ever reached requireAuth it would 401, because a preflight carries no
  // Authorization header — and every write in the app would fail from a browser.
  test('a preflight is answered before authentication, with the full grant', async () => {
    const res = await api('OPTIONS', '/orders', {
      headers: {
        origin: ALLOWED,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization, content-type',
      },
    });

    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), ALLOWED);
    assert.match(res.headers.get('access-control-allow-methods'), /POST/);
    assert.match(res.headers.get('access-control-allow-headers').toLowerCase(), /authorization/);
    assert.ok(res.headers.get('access-control-max-age'));
  });

  test('a disallowed origin gets no grant, but Vary is still set', async () => {
    const res = await api('OPTIONS', '/orders', {
      headers: { origin: DENIED, 'access-control-request-method': 'POST' },
    });

    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), null);
    // Without Vary, a cache could hand one origin's grant to another.
    assert.match(res.headers.get('vary') ?? '', /Origin/i);
  });

  // The distinction that matters: CORS is not authorization. The route still runs; the browser
  // is what refuses to hand the response to the page.
  test('a request from a disallowed origin still executes, it just carries no grant', async () => {
    const res = await api('GET', '/dashboard', { token: manager, headers: { origin: DENIED } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), null);
  });

  test('a request with no Origin header is untouched', async () => {
    const res = await api('GET', '/dashboard', { token: manager });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), null);
  });
});

describe('§7 CSV export', () => {
  test('it is manager-only', async () => {
    assert.equal((await api('GET', '/orders/export', { token: arjun })).status, 403);
    assert.equal((await api('GET', '/orders/export')).status, 401);
  });

  test('it is served as a downloadable CSV whose filename the browser can read', async () => {
    const res = await api('GET', '/orders/export', {
      token: manager, headers: { origin: ALLOWED },
    });

    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/csv/);
    assert.match(res.headers.get('content-disposition'), /attachment; filename="orders-\d{4}-\d{2}-\d{2}\.csv"/);

    // Content-Disposition is not readable cross-origin unless the server exposes it.
    assert.match(res.headers.get('access-control-expose-headers') ?? '', /Content-Disposition/i);
  });

  test('the file has a header row and CRLF endings', async () => {
    const res = await api('GET', '/orders/export', { token: manager });
    const body = res.text.replace(/^﻿/, '');

    // Asserted on the raw bytes: fetch's text decoder silently removes a leading BOM, so a
    // string comparison here would claim the BOM is missing when it is on the wire.
    assert.deepEqual(
      [...res.bytes.subarray(0, 3)],
      [0xef, 0xbb, 0xbf],
      'a UTF-8 BOM, so Excel does not mangle the encoding'
    );
    assert.ok(body.includes('\r\n'));
    assert.equal(
      body.split('\r\n')[0],
      'order_id,table_number,status,placed_at,waiter,archived,item,quantity,unit_price,line_total,voided,void_reason,order_total'
    );
  });

  test('a field containing a comma or a quote is escaped, not left to split the row', async () => {
    const table = 'Patio "3", by the door';
    const created = await api('POST', '/orders', { token: manager, body: { tableNumber: table } });
    assert.equal(created.status, 201);

    const res = await api('GET', '/orders/export', { token: manager });
    const row = res.text.split('\r\n').find((l) => l.startsWith(`${created.json.order.id},`));

    assert.ok(row, 'the new order should be in today\'s export');
    assert.ok(row.includes('"Patio ""3"", by the door"'), `quoting failed: ${row}`);
  });

  test('an unknown query parameter is refused', async () => {
    assert.equal((await api('GET', '/orders/export?date=today', { token: manager })).status, 422);
  });
});
