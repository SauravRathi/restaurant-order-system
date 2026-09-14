// §8. The day at a glance.
//
// This is the one read in the API that is not scoped by the visibility predicate — it is
// restaurant-wide for both roles, deliberately. A waiter seeing the restaurant's takings and
// how the floor is doing is the point of a dashboard; scoping it would give each waiter a
// private dashboard of their own orders, which is a different feature.
//
// So there is no role check on this page. The CSV export below is a different matter: that one
// is manager-only and the server answers 403.

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { download, get } from '../api/client.js';
import { useIsManager } from '../auth/AuthContext.jsx';
import { ErrorNotice, Loading, Spinner } from '../ui/components.jsx';
import { money, moneyToNumber, shortDate, statusLabel } from '../ui/format.js';

// Recharts takes colours as strings, not CSS variables, so the palette is repeated here. The
// values match the --badge colours in index.css and are the only place in the app that happens.
const STATUS_COLOUR = {
  placed: '#8b96a3',
  accepted: '#1a5fb4',
  preparing: '#c9871a',
  ready: '#1a6b3c',
  served: '#5c6773',
  cancelled: '#b3261e',
};

export default function DashboardPage() {
  const isManager = useIsManager();

  const { data, isPending, error } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => get('/dashboard'),
    // Four queries on the server behind this one request. A minute is frequent enough for a
    // summary of the day and infrequent enough not to sit on the database.
    refetchInterval: 60_000,
  });

  if (isPending) return <Loading label="Building the dashboard…" />;
  if (error)
    return (
      <main className="page">
        <ErrorNotice error={error} />
      </main>
    );

  const { headlines, byStatus, byWaiter, servedPerDay, timezone } = data;

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          {/* "Today" is a date in the restaurant's timezone, not the server's — the API runs in
              UTC, where a 23:30 dinner has already become tomorrow. Saying which timezone is
              being used is the difference between a number and a number you can check. */}
          <p>Today, in {timezone}.</p>
        </div>
        {isManager && <ExportButton />}
      </div>

      <div className="stat-row">
        <Stat label="Orders placed" value={headlines.ordersPlacedToday} />
        <Stat label="Served" value={headlines.ordersServedToday} />
        <Stat label="Revenue" value={money(headlines.revenueToday)} />
        <Stat label="Active now" value={headlines.activeOrders} />
        <Stat
          label="Alerting"
          value={headlines.alertingOrders}
          tone={headlines.alertingOrders > 0 ? 'danger' : undefined}
        />
      </div>

      <div className="chart-row">
        <div className="card">
          <div className="card-head">
            {/* Not "open orders": this is every unarchived order grouped by status, served and
                cancelled included. Naming it accurately matters because the shape of the chart
                depends on it — most of the bar height is finished business. */}
            <h2>Orders by status</h2>
          </div>
          <div className="card-body">
            {/* All six statuses always appear, including empty ones — the API builds this from
                enum_range, so "no cancellations today" is a visible zero rather than a missing
                bar the eye reads as a shorter chart.

                A LabelList on every bar, because the interesting bars are the small ones. A
                restaurant that has served sixty orders and has one Ready dwarfs that Ready bar
                to a pixel, and "1" printed above it is readable where the height is not. The
                alternative — a log scale — would make the axis lie about proportion to rescue
                a detail a label fixes honestly. */}
            <ResponsiveContainer width="100%" height={240}>
              <BarChart
                data={byStatus.map((s) => ({ ...s, label: statusLabel(s.status) }))}
                margin={{ top: 18, right: 4, bottom: 0, left: -14 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#dfe3e8" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} stroke="#8b96a3" />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} stroke="#8b96a3" />
                <Tooltip
                  cursor={{ fill: '#f2f4f7' }}
                  formatter={(value, _name, item) => [
                    `${value} orders · ${money(item.payload.total)}`,
                    'Orders',
                  ]}
                />
                <Bar dataKey="orders" radius={[3, 3, 0, 0]}>
                  <LabelList dataKey="orders" position="top" style={{ fontSize: 12, fill: '#5c6773' }} />
                  {byStatus.map((s) => (
                    <Cell key={s.status} fill={STATUS_COLOUR[s.status]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h2>Last 14 days</h2>
          </div>
          <div className="card-body">
            {/* Zero-filled by the API from a generated series, so a closed day is a point at
                zero rather than a gap the line would silently close over. */}
            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart
                data={servedPerDay.map((d) => ({
                  ...d,
                  label: shortDate(d.date),
                  // The one place money becomes a number, because a chart measures pixels.
                  // Confined to moneyToNumber so there is a single name to point at.
                  revenueValue: moneyToNumber(d.revenue),
                }))}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#dfe3e8" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="#8b96a3" />
                <YAxis yAxisId="left" allowDecimals={false} tick={{ fontSize: 11 }} stroke="#8b96a3" />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} stroke="#8b96a3" />
                <Tooltip
                  formatter={(value, name, item) =>
                    name === 'revenueValue'
                      ? // Formatted from the original string, not from the number the chart
                        // was given — the tooltip shows the exact NUMERIC the API sent.
                        [money(item.payload.revenue), 'Revenue']
                      : [value, 'Served']
                  }
                />
                <Bar yAxisId="left" dataKey="served" fill="#c5d9f2" radius={[3, 3, 0, 0]} />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="revenueValue"
                  stroke="#1a5fb4"
                  strokeWidth={2}
                  dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-head">
          <h2>By waiter, today</h2>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Waiter</th>
                <th className="right">Orders</th>
                <th className="right">Served</th>
                <th className="right">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {/* Primary waiter only, not collaborators — revenue attributed to two people at
                  once would make the day's totals sum to more than the takings. Every waiter
                  appears, including one who has taken nothing: an empty row is the informative
                  part of a by-waiter table. */}
              {byWaiter.map((row) => (
                <tr key={row.waiter.id}>
                  <td>
                    {row.waiter.displayName}
                    {row.waiter.role === 'manager' && <span className="faint"> (manager)</span>}
                  </td>
                  <td className="right">{row.ordersToday}</td>
                  <td className="right">{row.servedToday}</td>
                  <td className="right nowrap">{money(row.revenueToday)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}

const Stat = ({ label, value, tone }) => (
  <div className="card stat">
    <div className="stat-label">{label}</div>
    <div className={`stat-value${tone ? ` ${tone}` : ''}`}>{value}</div>
  </div>
);

/**
 * §7's other half — today's orders as a CSV, manager-only.
 *
 * The filename comes from Content-Disposition, which is readable cross-origin only because the
 * API names it in Access-Control-Expose-Headers. The bytes start with a UTF-8 BOM so Excel
 * opens ₹ correctly instead of mojibake.
 */
function ExportButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function onExport() {
    setBusy(true);
    setError(null);
    try {
      const { blob, filename } = await download('/orders/export', 'orders.csv');

      // A blob URL and a synthetic click: the request needs an Authorization header, so a plain
      // <a href> to the endpoint would arrive unauthenticated and 401. The URL is revoked
      // straight after — it pins the blob in memory until it is.
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button onClick={onExport} disabled={busy}>
        {busy && <Spinner />}
        Export today as CSV
      </button>
      <ErrorNotice error={error} />
    </div>
  );
}
