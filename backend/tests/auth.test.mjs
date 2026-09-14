// §1 — accounts, roles, and the boundary between "who are you" and "what may you do".

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { ARJUN, MANAGER, api, login, startApi, stopApi } from './helpers.mjs';

before(startApi);
after(stopApi);

describe('POST /auth/login', () => {
  test('a seeded manager and waiter can sign in', async () => {
    for (const who of [MANAGER, ARJUN]) {
      const res = await api('POST', '/auth/login', { body: who });
      assert.equal(res.status, 200, res.text);
      assert.ok(res.json.token, 'no token returned');
      assert.equal(res.json.user.email, who.email);
    }
  });

  test('email is matched case-insensitively, by citext', async () => {
    const res = await api('POST', '/auth/login', {
      body: { email: MANAGER.email.toUpperCase(), password: MANAGER.password },
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.user.email, MANAGER.email, 'the stored spelling should come back');
  });

  // The point of this one: a different status, a different message or a different body for the
  // two cases would turn login into an account enumerator.
  test('an unknown email and a wrong password are indistinguishable', async () => {
    const unknown = await api('POST', '/auth/login', {
      body: { email: 'nobody@demo.test', password: MANAGER.password },
    });
    const wrong = await api('POST', '/auth/login', {
      body: { email: MANAGER.email, password: 'not the password' },
    });

    assert.equal(unknown.status, 401);
    assert.equal(wrong.status, 401);
    assert.deepEqual(unknown.json, wrong.json, 'the two 401s must be identical');
  });

  test('the body may not name its own role', async () => {
    const res = await api('POST', '/auth/login', { body: { ...ARJUN, role: 'manager' } });
    assert.equal(res.status, 422, 'an unrecognised key must be refused, not stripped');
  });

  test('a payload that parses but is invalid is 422', async () => {
    const res = await api('POST', '/auth/login', { body: { email: 'not-an-email', password: '' } });
    assert.equal(res.status, 422);
    assert.ok(res.json.details.length >= 1, 'a 422 should say which fields failed');
  });

  // 400 means we could not read the bytes; 422 means we read them and the values are wrong.
  test('a body that is not JSON at all is 400, not 422', async () => {
    const res = await api('POST', '/auth/login', { raw: '{"email": ' });
    assert.equal(res.status, 400);
    assert.equal(res.json.code, 'MALFORMED_JSON');
  });
});

describe('requireAuth', () => {
  test('no token, the wrong scheme and a garbage token are all 401', async () => {
    const cases = [
      {},
      { headers: { authorization: 'Basic abc' } },
      { headers: { authorization: 'Bearer not.a.token' } },
    ];
    for (const options of cases) {
      const res = await api('GET', '/auth/me', options);
      assert.equal(res.status, 401, JSON.stringify(options));
    }
  });

  test('a token with an edited payload is rejected', async () => {
    const token = await login(ARJUN);
    const [header, payload, signature] = token.split('.');

    const claims = JSON.parse(Buffer.from(payload, 'base64url'));
    claims.role = 'manager';
    const forged = `${header}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${signature}`;

    const res = await api('GET', '/auth/me', { token: forged });
    assert.equal(res.status, 401, 'a re-written role must not be honoured');
  });

  test('GET /auth/me reports the token holder, read back from the database', async () => {
    const res = await api('GET', '/auth/me', { token: await login(ARJUN) });
    assert.equal(res.status, 200);
    assert.equal(res.json.user.email, ARJUN.email);
    assert.equal(res.json.user.role, 'waiter');
  });
});

describe('requireRole — 403 for a capability, never 404', () => {
  test('a waiter is refused the manager-only routes', async () => {
    const token = await login(ARJUN);
    const routes = [
      ['POST', '/users'],
      ['POST', '/menu-items'],
      ['POST', '/menu-items/bulk'],
      ['GET', '/orders/export'],
    ];

    for (const [method, path] of routes) {
      // No body on a GET — fetch refuses to send one, and the role check runs before any
      // payload is looked at anyway.
      const res = await api(method, path, method === 'GET' ? { token } : { token, body: {} });
      assert.equal(res.status, 403, `${method} ${path} returned ${res.status}`);
    }
  });

  test("a waiter listing users never receives a colleague's email", async () => {
    const asWaiter = await api('GET', '/users', { token: await login(ARJUN) });
    assert.equal(asWaiter.status, 200);
    assert.ok(
      !JSON.stringify(asWaiter.json).includes('@'),
      'the narrowing must happen in the SELECT, so no address is fetched at all'
    );

    const asManager = await api('GET', '/users', { token: await login(MANAGER) });
    assert.ok(asManager.json.users.every((u) => 'email' in u), 'a manager sees the full record');
  });
});
