// §1 and §7 — the menu, and the bulk update whose whole point is partial success.

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { ARJUN, MANAGER, api, login, newMenuItem, startApi, stopApi } from './helpers.mjs';

let manager, arjun;

before(async () => {
  await startApi();
  [manager, arjun] = await Promise.all([MANAGER, ARJUN].map(login));
});
after(stopApi);

describe('browsing', () => {
  test('both roles can read the menu; only a manager can see archived items', async () => {
    const item = await newMenuItem(manager, 'Hidden Dish', 10);
    await api('POST', `/menu-items/${item.id}/archive`, { token: manager });

    const has = (res) => res.json.menuItems.some((m) => m.id === item.id);

    assert.equal(has(await api('GET', '/menu-items', { token: manager })), false,
      'archived items are out by default');
    assert.equal(has(await api('GET', '/menu-items?includeArchived=true', { token: manager })), true);

    // "ignored for waiters" — ignored, not refused, so a shared frontend need not know the rule.
    const waiterAsking = await api('GET', '/menu-items?includeArchived=true', { token: arjun });
    assert.equal(waiterAsking.status, 200);
    assert.equal(has(waiterAsking), false);
  });

  test('price is a string, never a float', async () => {
    const res = await api('GET', '/menu-items', { token: arjun });
    assert.ok(res.json.menuItems.every((m) => typeof m.price === 'string'));
  });

  test('an unknown query parameter is refused rather than ignored', async () => {
    assert.equal((await api('GET', '/menu-items?category=Mains', { token: manager })).status, 422);
    assert.equal((await api('GET', '/menu-items?includeArchived=maybe', { token: manager })).status, 422);
  });
});

describe('creating and updating', () => {
  test('the scale of a price is validated rather than left to the database to round', async () => {
    const bad = await api('POST', '/menu-items', {
      token: manager, body: { name: `Scale ${Date.now()}`, category: 'TEST', price: 320.999 },
    });
    assert.equal(bad.status, 422, 'Postgres would have stored 321.00 and said nothing');

    const negative = await api('POST', '/menu-items', {
      token: manager, body: { name: `Negative ${Date.now()}`, category: 'TEST', price: -5 },
    });
    assert.equal(negative.status, 422);
  });

  test('a JSON number and a decimal string both arrive as exact money', async () => {
    const asNumber = await newMenuItem(manager, 'Number Priced', 249.5);
    assert.equal(asNumber.price, '249.50');

    const asString = await api('POST', '/menu-items', {
      token: manager, body: { name: `String Priced ${Date.now()}`, category: 'TEST', price: '199.99' },
    });
    assert.equal(asString.json.menuItem.price, '199.99');
  });

  test('two live items cannot share a name, case-insensitively', async () => {
    const item = await newMenuItem(manager, 'Unique Dish', 10);

    const clash = await api('POST', '/menu-items', {
      token: manager, body: { name: item.name.toUpperCase(), category: 'TEST', price: 10 },
    });
    assert.equal(clash.status, 409);
    assert.equal(clash.json.code, 'NAME_TAKEN');
  });

  // The partial unique index is what makes this possible: it only covers live rows.
  test('an archived name can be reused, and then blocks the restore', async () => {
    const original = await newMenuItem(manager, 'Reusable Dish', 10);
    await api('POST', `/menu-items/${original.id}/archive`, { token: manager });

    const reused = await api('POST', '/menu-items', {
      token: manager, body: { name: original.name, category: 'TEST', price: 20 },
    });
    assert.equal(reused.status, 201, 'the name was free once the original was archived');

    const blocked = await api('POST', `/menu-items/${original.id}/restore`, { token: manager });
    assert.equal(blocked.status, 409);
    assert.equal(blocked.json.code, 'NAME_TAKEN');

    await api('PATCH', `/menu-items/${reused.json.menuItem.id}`, {
      token: manager, body: { name: `${original.name} (new)` },
    });
    assert.equal((await api('POST', `/menu-items/${original.id}/restore`, { token: manager })).status, 200);
  });

  test('an empty PATCH is refused, and a missing item is 404', async () => {
    const item = await newMenuItem(manager, 'Patchable Dish', 10);
    assert.equal((await api('PATCH', `/menu-items/${item.id}`, { token: manager, body: {} })).status, 422);
    assert.equal((await api('PATCH', '/menu-items/999999999', { token: manager, body: { price: 1 } })).status, 404);
    assert.equal((await api('PATCH', '/menu-items/abc', { token: manager, body: { price: 1 } })).status, 404);
  });

  test('archive and restore report which of the two reasons refused them', async () => {
    const item = await newMenuItem(manager, 'Archivable Dish', 10);

    const notArchived = await api('POST', `/menu-items/${item.id}/restore`, { token: manager });
    assert.equal(notArchived.status, 409);
    assert.equal(notArchived.json.code, 'NOT_ARCHIVED');

    assert.equal((await api('POST', `/menu-items/${item.id}/archive`, { token: manager })).status, 200);

    const twice = await api('POST', `/menu-items/${item.id}/archive`, { token: manager });
    assert.equal(twice.status, 409);
    assert.equal(twice.json.code, 'ALREADY_ARCHIVED');

    assert.equal((await api('POST', '/menu-items/999999999/archive', { token: manager })).status, 404);
  });
});

describe('§7 bulk update — partial success is the requirement', () => {
  test('a sweep reports every item, succeeded or rejected, with a reason', async () => {
    const live = await newMenuItem(manager, 'Bulk Live', 100);
    const other = await newMenuItem(manager, 'Bulk Other', 100);
    const gone = await newMenuItem(manager, 'Bulk Archived', 300);
    await api('POST', `/menu-items/${gone.id}/archive`, { token: manager });

    const res = await api('POST', '/menu-items/bulk', {
      token: manager,
      body: { ids: [live.id, gone.id, '999999999', other.id], price: '149.50' },
    });

    assert.equal(res.status, 200, 'the bulk operation itself succeeded');
    assert.deepEqual(res.json.summary, { requested: 4, updated: 2, rejected: 2 });

    const byId = Object.fromEntries(res.json.results.map((r) => [r.id, r]));
    assert.equal(byId[live.id].status, 'updated');
    assert.equal(byId[live.id].menuItem.price, '149.50');
    assert.equal(byId[gone.id].code, 'ARCHIVED');
    assert.equal(byId['999999999'].code, 'NOT_FOUND');
    assert.ok(byId[gone.id].reason.length > 0, 'a rejection must say why');

    // The order the ids were sent in is the order they come back in.
    assert.deepEqual(res.json.results.map((r) => r.id), [live.id, gone.id, '999999999', other.id]);

    // And the rejected one really was left alone.
    const untouched = await api('GET', `/menu-items?includeArchived=true`, { token: manager });
    assert.equal(untouched.json.menuItems.find((m) => m.id === gone.id).price, '300.00');
  });

  test('every item rejected is still a 200 with the report in the body', async () => {
    const res = await api('POST', '/menu-items/bulk', {
      token: manager, body: { ids: ['999999998', '999999999'], isAvailable: true },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json.summary, { requested: 2, updated: 0, rejected: 2 });
  });

  test('shape errors fail the whole request instead, and touch nothing', async () => {
    const item = await newMenuItem(manager, 'Bulk Guard', 100);

    const cases = [
      { ids: [item.id], price: 1, isAvailable: true },   // both
      { ids: [item.id] },                                 // neither
      { ids: [], price: 1 },                              // nothing selected
      { ids: [item.id, 'abc'], price: 1 },                // a malformed id
      { ids: [item.id], price: 1, category: 'Mains' },    // an unknown key
    ];
    for (const body of cases) {
      const res = await api('POST', '/menu-items/bulk', { token: manager, body });
      assert.equal(res.status, 422, JSON.stringify(body));
    }

    const after = await api('GET', '/menu-items?includeArchived=true', { token: manager });
    assert.equal(after.json.menuItems.find((m) => m.id === item.id).price, '100.00');
  });

  test('duplicate ids are reported once', async () => {
    const item = await newMenuItem(manager, 'Bulk Dupe', 100);
    const res = await api('POST', '/menu-items/bulk', {
      token: manager, body: { ids: [item.id, item.id], isAvailable: false },
    });
    assert.equal(res.json.summary.requested, 1);
    assert.equal(res.json.results.length, 1);
  });
});
