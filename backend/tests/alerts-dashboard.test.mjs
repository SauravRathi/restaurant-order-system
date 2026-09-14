// §8 and §10 — the dashboard, and slow-order alerts including the repeat window.

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { ARJUN, MANAGER, RAVI, api, login, newOrder, query, startApi, stopApi } from './helpers.mjs';

let manager, arjun, ravi;

before(async () => {
  await startApi();
  [manager, arjun, ravi] = await Promise.all([MANAGER, ARJUN, RAVI].map(login));
});
after(stopApi);

/**
 * An order that is old enough to alert. placed_at is pushed into the past directly, because
 * the alternative is a test that sleeps for twenty minutes.
 */
async function slowOrder(token, minutesOld = 60) {
  const order = await newOrder(token, `ALERT-${Date.now()}`);
  await query(`UPDATE orders SET placed_at = now() - make_interval(mins => $2) WHERE id = $1`,
    [order.id, minutesOld]);
  return order;
}

describe('§10 alerts', () => {
  test('an order open past the threshold alerts; a fresh one does not', async () => {
    const fresh = await newOrder(arjun, 'ALERT-FRESH');
    const slow = await slowOrder(arjun);

    const res = await api('GET', '/alerts', { token: arjun });
    assert.equal(res.status, 200);

    const ids = res.json.alerts.map((a) => a.id);
    assert.ok(ids.includes(slow.id), 'the slow order should be alerting');
    assert.ok(!ids.includes(fresh.id), 'a new order should not');

    const alert = res.json.alerts.find((a) => a.id === slow.id);
    assert.ok(alert.minutesOpen >= 59, `minutesOpen was ${alert.minutesOpen}`);
    assert.equal(alert.previouslyAcknowledgedAt, null);
    assert.deepEqual(res.json.thresholds, { slowOrderMinutes: 20, repeatMinutes: 10 });
  });

  test('an order that reached Ready stops alerting', async () => {
    const slow = await slowOrder(arjun);
    for (const status of ['accepted', 'preparing', 'ready']) {
      await api('POST', `/orders/${slow.id}/status`, { token: arjun, body: { status } });
    }

    const res = await api('GET', '/alerts', { token: arjun });
    assert.ok(!res.json.alerts.some((a) => a.id === slow.id));
  });

  test('alerts are scoped exactly like orders', async () => {
    const slow = await slowOrder(arjun);

    const mine = await api('GET', '/alerts', { token: arjun });
    assert.ok(mine.json.alerts.some((a) => a.id === slow.id));

    const stranger = await api('GET', '/alerts', { token: ravi });
    assert.ok(!stranger.json.alerts.some((a) => a.id === slow.id),
      'a waiter must not be warned about a table they cannot see');

    const boss = await api('GET', '/alerts', { token: manager });
    assert.ok(boss.json.alerts.some((a) => a.id === slow.id), 'a manager sees every alert');
  });

  test('/alerts/count agrees with /alerts, for each caller', async () => {
    await slowOrder(arjun);
    for (const token of [manager, arjun, ravi]) {
      const [list, count] = await Promise.all([
        api('GET', '/alerts', { token }),
        api('GET', '/alerts/count', { token }),
      ]);
      assert.equal(count.json.count, list.json.alerts.length);
    }
  });

  test('acknowledging suppresses the alert, and the repeat window brings it back', async () => {
    const slow = await slowOrder(arjun);

    const acked = await api('POST', `/orders/${slow.id}/alert/ack`, { token: arjun });
    assert.equal(acked.status, 200, acked.text);
    assert.ok(acked.json.order.alertAckedAt);

    const suppressed = await api('GET', '/alerts', { token: arjun });
    assert.ok(!suppressed.json.alerts.some((a) => a.id === slow.id), 'just acknowledged');

    // Inside the window it stays quiet; one minute past it, it comes back. Driven directly so
    // the assertion does not depend on how long ago the fixture happened to be seeded.
    await query(`UPDATE orders SET alert_acked_at = now() - interval '9 minutes' WHERE id = $1`, [slow.id]);
    const stillQuiet = await api('GET', '/alerts', { token: arjun });
    assert.ok(!stillQuiet.json.alerts.some((a) => a.id === slow.id), '9 minutes is inside the window');

    await query(`UPDATE orders SET alert_acked_at = now() - interval '11 minutes' WHERE id = $1`, [slow.id]);
    const back = await api('GET', '/alerts', { token: arjun });
    const refired = back.json.alerts.find((a) => a.id === slow.id);
    assert.ok(refired, '11 minutes is past the window, so it should alert again');
    assert.ok(refired.previouslyAcknowledgedBy, 'a re-fired alert says who last acknowledged it');
  });

  test('acknowledging something that is not alerting is 409, and someone else\'s is 404', async () => {
    const fresh = await newOrder(arjun, 'ALERT-QUIET');
    const quiet = await api('POST', `/orders/${fresh.id}/alert/ack`, { token: arjun });
    assert.equal(quiet.status, 409);
    assert.equal(quiet.json.code, 'NOT_ALERTING');

    const slow = await slowOrder(arjun);
    assert.equal((await api('POST', `/orders/${slow.id}/alert/ack`, { token: ravi })).status, 404);
    assert.equal((await api('POST', '/orders/999999999/alert/ack', { token: manager })).status, 404);
  });

  test('an acknowledgement is recorded in the timeline', async () => {
    const slow = await slowOrder(arjun);
    await api('POST', `/orders/${slow.id}/alert/ack`, { token: manager });

    const timeline = await api('GET', `/orders/${slow.id}/timeline`, { token: arjun });
    const event = timeline.json.timeline.find((e) => e.action === 'alert_acknowledged');
    assert.ok(event, 'the acknowledgement should be history');
    assert.equal(event.actor.role, 'manager');
  });
});

describe('§8 dashboard', () => {
  test('it is restaurant-wide: both roles get identical data', async () => {
    const [asManager, asWaiter] = await Promise.all([
      api('GET', '/dashboard', { token: manager }),
      api('GET', '/dashboard', { token: arjun }),
    ]);
    assert.equal(asManager.status, 200);
    assert.deepEqual(asManager.json, asWaiter.json);
  });

  test('headlines agree with the database', async () => {
    const res = await api('GET', '/dashboard', { token: manager });
    const { rows: [truth] } = await query(
      `SELECT (SELECT count(*)::int FROM orders
                WHERE (placed_at AT TIME ZONE $1)::date = (now() AT TIME ZONE $1)::date) AS placed,
              (SELECT count(*)::int FROM orders
                WHERE status = 'served'
                  AND (served_at AT TIME ZONE $1)::date = (now() AT TIME ZONE $1)::date) AS served,
              (SELECT count(*)::int FROM orders
                WHERE archived_at IS NULL
                  AND status IN ('placed','accepted','preparing','ready')) AS active`,
      [res.json.timezone]
    );

    assert.equal(res.json.headlines.ordersPlacedToday, truth.placed);
    assert.equal(res.json.headlines.ordersServedToday, truth.served);
    assert.equal(res.json.headlines.activeOrders, truth.active);
    assert.equal(typeof res.json.headlines.revenueToday, 'string', 'money stays a string');
  });

  test('byStatus covers all six statuses, in lifecycle order', async () => {
    const res = await api('GET', '/dashboard', { token: manager });
    assert.deepEqual(
      res.json.byStatus.map((s) => s.status),
      ['placed', 'accepted', 'preparing', 'ready', 'served', 'cancelled'],
      'enum_range gives the zero rows and array_position gives the order'
    );
  });

  test('byWaiter lists every waiter, including one with nothing today', async () => {
    const res = await api('GET', '/dashboard', { token: manager });
    const { rows: [{ n }] } = await query(`SELECT count(*)::int AS n FROM users WHERE role = 'waiter'`);

    const waiters = res.json.byWaiter.filter((w) => w.waiter.role === 'waiter');
    assert.equal(waiters.length, n, 'a waiter with no orders is an informative zero, not a gap');
    assert.ok(res.json.byWaiter.every((w) => typeof w.revenueToday === 'string'));
  });

  test('servedPerDay is fourteen consecutive days, zero-filled', async () => {
    const res = await api('GET', '/dashboard', { token: manager });
    const days = res.json.servedPerDay;

    assert.equal(days.length, 14);
    assert.ok(days.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date)), 'plain dates, not timestamps');
    assert.ok(days.every((d) => typeof d.revenue === 'string'));

    for (let i = 1; i < days.length; i++) {
      const gap = (Date.parse(days[i].date) - Date.parse(days[i - 1].date)) / 86_400_000;
      assert.equal(gap, 1, `${days[i - 1].date} -> ${days[i].date} is not one day`);
    }
  });

  test('the dashboard needs a token like everything else', async () => {
    assert.equal((await api('GET', '/dashboard')).status, 401);
    assert.equal((await api('GET', '/alerts')).status, 401);
    assert.equal((await api('GET', '/alerts/count')).status, 401);
  });
});
