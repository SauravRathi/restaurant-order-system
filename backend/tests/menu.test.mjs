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
    assert.deepEqual(res.json.summary, { requested: 4, updated: 2, partial: 0, rejected: 2 });

    const byId = Object.fromEntries(res.json.results.map((r) => [r.id, r]));
    assert.equal(byId[live.id].status, 'updated');
    assert.equal(byId[live.id].menuItem.price, '149.50');
    assert.equal(byId[live.id].changes.price.status, 'updated');

    // The reason lives with the field, so a consumer reads `changes` and looks nowhere else.
    assert.equal(byId[gone.id].changes.price.code, 'ARCHIVED');
    assert.equal(byId['999999999'].changes.price.code, 'NOT_FOUND');
    assert.ok(byId[gone.id].changes.price.reason.length > 0, 'a rejection must say why');

    // Only the fields that were asked for appear.
    assert.deepEqual(Object.keys(byId[live.id].changes), ['price']);

    // The order the ids were sent in is the order they come back in.
    assert.deepEqual(res.json.results.map((r) => r.id), [live.id, gone.id, '999999999', other.id]);

    // And the rejected one really was left alone.
    const untouched = await api('GET', `/menu-items?includeArchived=true`, { token: manager });
    assert.equal(untouched.json.menuItems.find((m) => m.id === gone.id).price, '300.00');
  });

  // The reason the endpoint accepts both fields at once: they are independent changes, and one
  // failing must not take the other down with it.
  test('price and availability travel together and succeed independently', async () => {
    const item = await newMenuItem(manager, 'Bulk Both', 100);

    const ok = await api('POST', '/menu-items/bulk', {
      token: manager, body: { ids: [item.id], price: '77.00', isAvailable: false },
    });
    assert.equal(ok.json.summary.updated, 1);
    assert.equal(ok.json.results[0].status, 'updated');
    assert.equal(ok.json.results[0].menuItem.price, '77.00');
    assert.equal(ok.json.results[0].menuItem.isAvailable, false);
  });

  test('an invalid price does not block the availability change travelling with it', async () => {
    const item = await newMenuItem(manager, 'Bulk Partial', 100);

    const res = await api('POST', '/menu-items/bulk', {
      token: manager, body: { ids: [item.id], price: '-50.00', isAvailable: false },
    });

    assert.equal(res.status, 200);
    assert.deepEqual(res.json.summary, { requested: 1, updated: 0, partial: 1, rejected: 0 });

    const result = res.json.results[0];
    assert.equal(result.status, 'partial', 'half-succeeded, and the report can say so');
    assert.equal(result.changes.price.code, 'NEGATIVE_PRICE');
    assert.equal(result.changes.isAvailable.status, 'updated');

    // The half that was legal actually landed; the half that was not, did not.
    assert.equal(result.menuItem.isAvailable, false);
    assert.equal(result.menuItem.price, '100.00');
  });

  test('every item rejected is still a 200 with the report in the body', async () => {
    const res = await api('POST', '/menu-items/bulk', {
      token: manager, body: { ids: ['999999998', '999999999'], isAvailable: true },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json.summary, { requested: 2, updated: 0, partial: 0, rejected: 2 });
  });

  // The case §7 names by name. A negative price used to be a 422 that refused the whole
  // request — which is the batch failure the goal rules out, for the goal's own example.
  test('a negative price is reported per item, not refused as a batch', async () => {
    const live = await newMenuItem(manager, 'Bulk Negative Live', 100);
    const gone = await newMenuItem(manager, 'Bulk Negative Archived', 300);
    await api('POST', `/menu-items/${gone.id}/archive`, { token: manager });

    const res = await api('POST', '/menu-items/bulk', {
      token: manager,
      body: { ids: [live.id, gone.id, '999999999'], price: '-50.00' },
    });

    assert.equal(res.status, 200, 'the batch must not fail');
    assert.deepEqual(res.json.summary, { requested: 3, updated: 0, partial: 0, rejected: 3 });

    const byId = Object.fromEntries(res.json.results.map((r) => [r.id, r]));

    // The item that would otherwise have been updated is refused for the value.
    assert.equal(byId[live.id].changes.price.code, 'NEGATIVE_PRICE');
    assert.match(byId[live.id].changes.price.reason, /negative/i);

    // And items refused for their own reasons keep those reasons rather than being told about
    // the price — every id gets the truest answer available for it.
    assert.equal(byId[gone.id].changes.price.code, 'ARCHIVED');
    assert.equal(byId['999999999'].changes.price.code, 'NOT_FOUND');

    // Nothing moved.
    const after = await api('GET', '/menu-items?includeArchived=true', { token: manager });
    const priceOf = (id) => after.json.menuItems.find((m) => m.id === id).price;
    assert.equal(priceOf(live.id), '100.00');
    assert.equal(priceOf(gone.id), '300.00');
  });

  test('a price with too many decimals is reported per item too', async () => {
    const item = await newMenuItem(manager, 'Bulk Scale', 100);

    const res = await api('POST', '/menu-items/bulk', {
      token: manager, body: { ids: [item.id], price: '320.999' },
    });

    assert.equal(res.status, 200);
    assert.equal(res.json.results[0].changes.price.code, 'INVALID_PRICE');

    const after = await api('GET', '/menu-items', { token: manager });
    assert.equal(after.json.menuItems.find((m) => m.id === item.id).price, '100.00',
      'Postgres would have stored 321.00 and said nothing');
  });

  // The other half of the same rule: leniency is for the bulk report only. A manager naming one
  // exact item still gets one clear 422.
  test('the single-item routes still refuse a bad price outright', async () => {
    const item = await newMenuItem(manager, 'Bulk Single Guard', 100);

    for (const price of [-50, 320.999]) {
      const res = await api('PATCH', `/menu-items/${item.id}`, { token: manager, body: { price } });
      assert.equal(res.status, 422, `PATCH should refuse ${price}`);
    }
  });

  test('shape errors fail the whole request instead, and touch nothing', async () => {
    const item = await newMenuItem(manager, 'Bulk Guard', 100);

    const cases = [
      { ids: [item.id] },                                 // no field to change
      { ids: [item.id], archived: 'yes' },                // archived is a boolean
      { ids: [], price: 1 },                              // nothing selected
      { ids: [item.id, 'abc'], price: 1 },                // a malformed id
      { ids: [item.id], price: 1, category: 'Mains' },    // an unknown key
      // A type error, as opposed to a bad value: `true` is not a price under any reading, so
      // there is nothing per-field to report about it. This is the line the bulk route draws.
      { ids: [item.id], price: true },
    ];
    for (const body of cases) {
      const res = await api('POST', '/menu-items/bulk', { token: manager, body });
      assert.equal(res.status, 422, JSON.stringify(body));
    }

    const after = await api('GET', '/menu-items?includeArchived=true', { token: manager });
    assert.equal(after.json.menuItems.find((m) => m.id === item.id).price, '100.00');
  });

  test('archiving and restoring work as a bulk field', async () => {
    const a = await newMenuItem(manager, 'Bulk Arch A', 100);
    const b = await newMenuItem(manager, 'Bulk Arch B', 100);

    const archive = await api('POST', '/menu-items/bulk', {
      token: manager, body: { ids: [a.id, b.id], archived: true },
    });
    assert.equal(archive.status, 200);
    assert.deepEqual(archive.json.summary, { requested: 2, updated: 2, partial: 0, rejected: 0 });
    assert.ok(archive.json.results[0].menuItem.archivedAt, 'archivedAt is stamped');

    const restore = await api('POST', '/menu-items/bulk', {
      token: manager, body: { ids: [a.id, b.id], archived: false },
    });
    assert.equal(restore.json.summary.updated, 2);
    assert.equal(restore.json.results[0].menuItem.archivedAt, null);
  });

  test('asking for the state an item is already in is rejected, not silently restamped', async () => {
    const live = await newMenuItem(manager, 'Bulk Arch Live', 100);
    const gone = await newMenuItem(manager, 'Bulk Arch Gone', 100);
    await api('POST', `/menu-items/${gone.id}/archive`, { token: manager });

    const archiving = await api('POST', '/menu-items/bulk', {
      token: manager, body: { ids: [live.id, gone.id], archived: true },
    });
    const byId = Object.fromEntries(archiving.json.results.map((r) => [r.id, r]));
    assert.equal(byId[live.id].changes.archived.status, 'updated');
    assert.equal(byId[gone.id].changes.archived.code, 'ALREADY_ARCHIVED');

    const restoring = await api('POST', '/menu-items/bulk', {
      token: manager, body: { ids: [gone.id], archived: false },
    });
    assert.equal(restoring.json.results[0].changes.archived.status, 'updated');

    const again = await api('POST', '/menu-items/bulk', {
      token: manager, body: { ids: [gone.id], archived: false },
    });
    assert.equal(again.json.results[0].changes.archived.code, 'NOT_ARCHIVED');
  });

  // Price normally cannot touch an archived item. It can when the same sweep is restoring it,
  // because by the time the statement lands the item is live again.
  test('a restore in the same sweep unblocks the other fields', async () => {
    const item = await newMenuItem(manager, 'Bulk Arch Reprice', 100);
    await api('POST', `/menu-items/${item.id}/archive`, { token: manager });

    const blocked = await api('POST', '/menu-items/bulk', {
      token: manager, body: { ids: [item.id], price: '77.00' },
    });
    assert.equal(blocked.json.results[0].changes.price.code, 'ARCHIVED');

    const together = await api('POST', '/menu-items/bulk', {
      token: manager, body: { ids: [item.id], price: '77.00', archived: false },
    });
    assert.equal(together.json.results[0].status, 'updated');
    assert.equal(together.json.results[0].menuItem.price, '77.00');
    assert.equal(together.json.results[0].menuItem.archivedAt, null);
  });

  // The partial unique index only covers live rows, so a name freed by archiving can be taken —
  // and then the restore collides. In one batched statement that would abort every row with it.
  test('a name collision on restore is reported per item, not as a batch failure', async () => {
    const original = await newMenuItem(manager, 'Bulk Clash', 100);
    const alsoFine = await newMenuItem(manager, 'Bulk Clash Neighbour', 100);
    await api('POST', `/menu-items/${original.id}/archive`, { token: manager });
    await api('POST', `/menu-items/${alsoFine.id}/archive`, { token: manager });

    // Something live takes the archived item's name while it is away.
    const squatter = await api('POST', '/menu-items', {
      token: manager, body: { name: original.name, category: 'TEST', price: 10 },
    });
    assert.equal(squatter.status, 201);

    const res = await api('POST', '/menu-items/bulk', {
      token: manager, body: { ids: [original.id, alsoFine.id], archived: false },
    });

    assert.equal(res.status, 200, 'one collision must not fail the batch');
    assert.deepEqual(res.json.summary, { requested: 2, updated: 1, partial: 0, rejected: 1 });

    const byId = Object.fromEntries(res.json.results.map((r) => [r.id, r]));
    assert.equal(byId[original.id].changes.archived.code, 'NAME_TAKEN');
    assert.equal(byId[alsoFine.id].changes.archived.status, 'updated',
      'the item beside the collision still came back');
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
