// §2–§6 and §9 — visibility, the lifecycle, line snapshots, and history that cannot be forged.

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import {
  ARJUN, MANAGER, MEERA, RAVI,
  anyAvailableItem, api, login, newMenuItem, newOrder, query, startApi, stopApi,
} from './helpers.mjs';

let manager, arjun, meera, ravi;

before(async () => {
  await startApi();
  [manager, arjun, meera, ravi] = await Promise.all(
    [MANAGER, ARJUN, MEERA, RAVI].map(login)
  );
});
after(stopApi);

describe('visibility equals actionability', () => {
  test("a waiter gets 404 on another waiter's order, and so does a bad id", async () => {
    const order = await newOrder(arjun, 'VIS-1');

    for (const [what, res] of [
      ['a stranger reading it', await api('GET', `/orders/${order.id}`, { token: meera })],
      ['a stranger acting on it', await api('POST', `/orders/${order.id}/notes`, { token: meera, body: { note: 'x' } })],
      ['an id that does not exist', await api('GET', '/orders/999999999', { token: arjun })],
      ['an id that is not a number', await api('GET', '/orders/abc', { token: arjun })],
    ]) {
      assert.equal(res.status, 404, what);
    }

    // Identical bodies: an order that is not yours must be indistinguishable from one that
    // never existed, or sequential ids would let a waiter enumerate the restaurant.
    const notMine = await api('GET', `/orders/${order.id}`, { token: meera });
    const absent = await api('GET', '/orders/999999999', { token: meera });
    assert.deepEqual(notMine.json, absent.json);
  });

  test('a manager sees every order', async () => {
    const order = await newOrder(arjun, 'VIS-2');
    const res = await api('GET', `/orders/${order.id}`, { token: manager });
    assert.equal(res.status, 200);
  });

  test('§5 adding a collaborator grants both reading and acting', async () => {
    const order = await newOrder(arjun, 'VIS-3');
    assert.equal((await api('GET', `/orders/${order.id}`, { token: meera })).status, 404);

    const users = await api('GET', '/users?role=waiter', { token: arjun });
    const meeraId = users.json.users.find((u) => u.displayName === 'Meera Iyer').id;

    const added = await api('POST', `/orders/${order.id}/collaborators`, {
      token: arjun, body: { userId: meeraId },
    });
    assert.equal(added.status, 201, added.text);

    assert.equal((await api('GET', `/orders/${order.id}`, { token: meera })).status, 200);
    const acted = await api('POST', `/orders/${order.id}/status`, {
      token: meera, body: { status: 'accepted' },
    });
    assert.equal(acted.status, 200, 'a collaborator may act, not only look');

    assert.equal(
      (await api('GET', `/orders/${order.id}`, { token: ravi })).status, 404,
      'and nobody else gained access'
    );
  });

  test('a collaborator must be a waiter, and cannot be added twice', async () => {
    const order = await newOrder(arjun, 'VIS-4');
    const users = await api('GET', '/users', { token: manager });
    const managerId = users.json.users.find((u) => u.role === 'manager').id;
    const meeraId = users.json.users.find((u) => u.displayName === 'Meera Iyer').id;

    assert.equal(
      (await api('POST', `/orders/${order.id}/collaborators`, { token: arjun, body: { userId: managerId } })).status,
      422, 'a manager is not a collaborator'
    );
    assert.equal(
      (await api('POST', `/orders/${order.id}/collaborators`, { token: arjun, body: { userId: meeraId } })).status,
      201
    );
    assert.equal(
      (await api('POST', `/orders/${order.id}/collaborators`, { token: arjun, body: { userId: meeraId } })).status,
      409, 'the second attempt is a state conflict'
    );
  });
});

describe('§4 the lifecycle', () => {
  test('the matrix is forward-only and refuses skipping', async () => {
    const order = await newOrder(arjun, 'LIFE-1');
    assert.deepEqual(order.allowedNextStatuses, ['accepted', 'cancelled']);

    const skipped = await api('POST', `/orders/${order.id}/status`, {
      token: arjun, body: { status: 'served' },
    });
    assert.equal(skipped.status, 409);
    assert.equal(skipped.json.code, 'ILLEGAL_TRANSITION');

    for (const status of ['accepted', 'preparing', 'ready', 'served']) {
      const res = await api('POST', `/orders/${order.id}/status`, { token: arjun, body: { status } });
      assert.equal(res.status, 200, `${status}: ${res.text}`);
      assert.equal(res.json.order.status, status);
    }

    const terminal = await api('POST', `/orders/${order.id}/status`, {
      token: arjun, body: { status: 'cancelled' },
    });
    assert.equal(terminal.status, 409);
    assert.equal(terminal.json.code, 'ORDER_CLOSED');
  });

  // The specific rule §4 spells out, including the sentence it should say.
  test('cancellation dies at Preparing', async () => {
    const early = await newOrder(arjun, 'LIFE-2');
    assert.equal(
      (await api('POST', `/orders/${early.id}/status`, { token: arjun, body: { status: 'cancelled' } })).status,
      200, 'Placed may still be cancelled'
    );

    const late = await newOrder(arjun, 'LIFE-3');
    await api('POST', `/orders/${late.id}/status`, { token: arjun, body: { status: 'accepted' } });
    await api('POST', `/orders/${late.id}/status`, { token: arjun, body: { status: 'preparing' } });

    const res = await api('POST', `/orders/${late.id}/status`, {
      token: arjun, body: { status: 'cancelled' },
    });
    assert.equal(res.status, 409);
    assert.equal(res.json.code, 'CANCEL_TOO_LATE');
    assert.match(res.json.error, /void individual lines instead/);
  });

  test('timestamps are stamped by the status that caused them', async () => {
    const order = await newOrder(arjun, 'LIFE-4');
    for (const status of ['accepted', 'preparing', 'ready']) {
      await api('POST', `/orders/${order.id}/status`, { token: arjun, body: { status } });
    }
    const res = await api('GET', `/orders/${order.id}`, { token: arjun });
    assert.ok(res.json.order.readyAt, 'readyAt should be set');
    assert.equal(res.json.order.servedAt, null);
    assert.equal(res.json.order.cancelledAt, null);
  });
});

describe('§3 order lines', () => {
  test('a line snapshots the price, and a later menu change does not rewrite it', async () => {
    const item = await newMenuItem(manager, 'Snapshot Dish', 200);
    const order = await newOrder(arjun, 'LINE-1');

    const added = await api('POST', `/orders/${order.id}/lines`, {
      token: arjun, body: { menuItemId: item.id, quantity: 2 },
    });
    assert.equal(added.status, 201, added.text);
    assert.equal(added.json.order.lines[0].unitPrice, '200.00');
    assert.equal(added.json.order.total, '400.00');

    const repriced = await api('PATCH', `/menu-items/${item.id}`, {
      token: manager, body: { price: '999.00' },
    });
    assert.equal(repriced.status, 200);

    const after = await api('GET', `/orders/${order.id}`, { token: arjun });
    assert.equal(after.json.order.lines[0].unitPrice, '200.00', 'the snapshot must not move');
    assert.equal(after.json.order.total, '400.00');
  });

  test('money and ids are strings all the way out', async () => {
    const item = await newMenuItem(manager, 'Typed Dish', 12.5);
    const order = await newOrder(arjun, 'LINE-2');
    const res = await api('POST', `/orders/${order.id}/lines`, {
      token: arjun, body: { menuItemId: item.id, quantity: 3 },
    });

    const line = res.json.order.lines[0];
    assert.equal(typeof res.json.order.id, 'string');
    assert.equal(typeof line.id, 'string');
    assert.equal(typeof line.unitPrice, 'string');
    assert.equal(typeof res.json.order.total, 'string');
    assert.equal(line.unitPrice, '12.50');
    assert.equal(res.json.order.total, '37.50', 'summed by Postgres, not by JavaScript');
  });

  test('voiding removes a line from the total but not from the bill', async () => {
    const item = await newMenuItem(manager, 'Voided Dish', 50);
    const order = await newOrder(arjun, 'LINE-3');
    const added = await api('POST', `/orders/${order.id}/lines`, {
      token: arjun, body: { menuItemId: item.id, quantity: 4 },
    });
    const lineId = added.json.order.lines[0].id;
    assert.equal(added.json.order.total, '200.00');

    const noReason = await api('POST', `/orders/${order.id}/lines/${lineId}/void`, {
      token: arjun, body: { reason: '   ' },
    });
    assert.equal(noReason.status, 422, 'a void needs a reason');

    const voided = await api('POST', `/orders/${order.id}/lines/${lineId}/void`, {
      token: arjun, body: { reason: 'Sent back to the kitchen' },
    });
    assert.equal(voided.status, 200);
    assert.equal(voided.json.order.total, '0.00');
    assert.equal(voided.json.order.lines.length, 1, 'the line stays on the order');
    assert.equal(voided.json.order.lines[0].voidReason, 'Sent back to the kitchen');
    assert.equal(voided.json.order.lines[0].voidedBy.displayName, 'Arjun Mehta');

    assert.equal(
      (await api('POST', `/orders/${order.id}/lines/${lineId}/void`, { token: arjun, body: { reason: 'again' } })).status,
      409, 'voiding twice is a conflict'
    );
  });

  test('an unorderable item is 409 and an unknown item is 422', async () => {
    const order = await newOrder(arjun, 'LINE-4');
    const item = await newMenuItem(manager, 'Archived Dish', 10);
    await api('POST', `/menu-items/${item.id}/archive`, { token: manager });

    const archived = await api('POST', `/orders/${order.id}/lines`, {
      token: arjun, body: { menuItemId: item.id, quantity: 1 },
    });
    assert.equal(archived.status, 409);

    const unknown = await api('POST', `/orders/${order.id}/lines`, {
      token: arjun, body: { menuItemId: '999999999', quantity: 1 },
    });
    assert.equal(unknown.status, 422);
  });

  test('a closed order takes no more lines', async () => {
    const item = await anyAvailableItem(arjun);
    const order = await newOrder(arjun, 'LINE-5');
    await api('POST', `/orders/${order.id}/status`, { token: arjun, body: { status: 'cancelled' } });

    const res = await api('POST', `/orders/${order.id}/lines`, {
      token: arjun, body: { menuItemId: item.id, quantity: 1 },
    });
    assert.equal(res.status, 409);
    assert.equal(res.json.code, 'ORDER_CLOSED');
  });
});

describe('§2 archiving is restricted to terminal states', () => {
  test('an active order cannot be archived, a served one can', async () => {
    const order = await newOrder(arjun, 'ARCH-1');

    const early = await api('POST', `/orders/${order.id}/archive`, { token: arjun });
    assert.equal(early.status, 409);
    assert.equal(early.json.code, 'ORDER_STILL_ACTIVE');

    for (const status of ['accepted', 'preparing', 'ready', 'served']) {
      await api('POST', `/orders/${order.id}/status`, { token: arjun, body: { status } });
    }

    const archived = await api('POST', `/orders/${order.id}/archive`, { token: arjun });
    assert.equal(archived.status, 200);
    assert.ok(archived.json.order.archivedAt);

    assert.equal((await api('POST', `/orders/${order.id}/archive`, { token: arjun })).status, 409);

    const restored = await api('POST', `/orders/${order.id}/restore`, { token: arjun });
    assert.equal(restored.status, 200);
    assert.equal(restored.json.order.archivedAt, null);
  });
});

describe('§9 history you cannot rewrite or forge', () => {
  test('the actor comes from the token, not the body', async () => {
    const order = await newOrder(arjun, 'HIST-1');

    // A manager acts on a waiter's order. The timeline must name the manager.
    await api('POST', `/orders/${order.id}/status`, { token: manager, body: { status: 'accepted' } });

    const timeline = await api('GET', `/orders/${order.id}/timeline`, { token: arjun });
    assert.equal(timeline.status, 200);

    const created = timeline.json.timeline.find((e) => e.action === 'created');
    const changed = timeline.json.timeline.find((e) => e.action === 'status_changed');
    assert.equal(created.actor.displayName, 'Arjun Mehta');
    assert.equal(changed.actor.displayName, 'Priya Nair');
    assert.equal(changed.actor.role, 'manager', 'a manager override stays visible');
    assert.equal(changed.fromStatus, 'placed');
    assert.equal(changed.toStatus, 'accepted');
  });

  test('the database itself refuses to let history be edited', async () => {
    const order = await newOrder(arjun, 'HIST-2');

    await assert.rejects(
      () => query(`UPDATE order_timeline SET note = 'rewritten' WHERE order_id = $1`, [order.id]),
      (err) => err.message.includes('append-only'),
      'the append-only trigger should reject an UPDATE'
    );
    await assert.rejects(
      () => query(`DELETE FROM order_timeline WHERE order_id = $1`, [order.id]),
      (err) => err.message.includes('append-only')
    );
  });

  test('a timeline is scoped like its order', async () => {
    const order = await newOrder(arjun, 'HIST-3');
    assert.equal((await api('GET', `/orders/${order.id}/timeline`, { token: meera })).status, 404);
  });
});

describe('§6 finding orders', () => {
  test('filters compose, and a waiter can only ever search their own orders', async () => {
    const table = `FIND-${Date.now()}`;
    const mine = await newOrder(arjun, table);

    const found = await api('GET', `/orders?q=${encodeURIComponent(table)}`, { token: arjun });
    assert.equal(found.status, 200);
    assert.equal(found.json.page.total, 1);
    assert.equal(found.json.orders[0].id, mine.id);

    const others = await api('GET', `/orders?q=${encodeURIComponent(table)}`, { token: ravi });
    assert.equal(others.json.page.total, 0, "another waiter's search must not reach it");

    const asManager = await api('GET', `/orders?q=${encodeURIComponent(table)}`, { token: manager });
    assert.equal(asManager.json.page.total, 1, 'a manager searches everything');
  });

  test('status filtering accepts one value or several', async () => {
    const one = await api('GET', '/orders?status=placed&pageSize=100', { token: manager });
    assert.equal(one.status, 200);
    assert.ok(one.json.orders.every((o) => o.status === 'placed'));

    const two = await api('GET', '/orders?status=placed&status=ready&pageSize=100', { token: manager });
    assert.ok(two.json.orders.every((o) => ['placed', 'ready'].includes(o.status)));
    assert.ok(two.json.page.total >= one.json.page.total);

    assert.equal((await api('GET', '/orders?status=burnt', { token: manager })).status, 422);
    assert.equal((await api('GET', '/orders?sort=price', { token: manager })).status, 422);
  });

  test('paging does not lose or repeat rows, and reports a total past the last page', async () => {
    const first = await api('GET', '/orders?pageSize=5&page=1&sort=placedAt&order=desc', { token: manager });
    const second = await api('GET', '/orders?pageSize=5&page=2&sort=placedAt&order=desc', { token: manager });

    const ids = new Set(first.json.orders.map((o) => o.id));
    assert.ok(!second.json.orders.some((o) => ids.has(o.id)), 'pages must not overlap');
    assert.equal(first.json.page.total, second.json.page.total);

    // The count rides along on the rows, so an empty page has to find it another way.
    const beyond = await api('GET', '/orders?pageSize=5&page=9999', { token: manager });
    assert.equal(beyond.json.orders.length, 0);
    assert.equal(beyond.json.page.total, first.json.page.total, 'an empty page still knows the total');
  });

  test('archived orders are excluded unless asked for', async () => {
    const withOut = await api('GET', '/orders?pageSize=1', { token: manager });
    const withIn = await api('GET', '/orders?pageSize=1&includeArchived=true', { token: manager });
    assert.ok(withIn.json.page.total >= withOut.json.page.total);
  });
});
