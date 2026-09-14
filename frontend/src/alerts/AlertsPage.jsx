// §10. Orders that have been open too long.
//
// The thresholds are not written down here. They arrive with the answer — `GET /alerts` returns
// `{ thresholds, alerts }` precisely so the UI can say "open 82 minutes, limit is 20" without a
// second copy of SLOW_ORDER_MINUTES baked into the frontend and free to drift from the server's.
//
// Scoping is the server's too: a waiter is told about the orders they could act on and no
// others, by the same predicate that decides which orders they can see at all. There is no
// role check in this file.

import { Link } from 'react-router-dom';
import { post } from '../api/client.js';
import { useOrderMutation } from '../orders/queries.js';
import { EmptyState, ErrorNotice, Loading, StatusBadge } from '../ui/components.jsx';
import { dateTime, duration, money } from '../ui/format.js';
import { useAlerts } from './queries.js';

export default function AlertsPage() {
  const { data, isPending, error } = useAlerts();

  if (isPending) return <Loading label="Checking for slow orders…" />;

  const { thresholds, alerts } = data;

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Slow orders</h1>
          <p>
            An order alerts once it has been open for {thresholds.slowOrderMinutes} minutes
            without being served or cancelled. Acknowledging one silences it for{' '}
            {thresholds.repeatMinutes} minutes, after which it comes back.
          </p>
        </div>
      </div>

      <ErrorNotice error={error} />

      {alerts.length === 0 ? (
        <div className="card">
          <EmptyState title="Nothing is running late">
            Every open order is inside the {thresholds.slowOrderMinutes}-minute limit.
          </EmptyState>
        </div>
      ) : (
        <div className="grid">
          {/* Oldest first, as the API returns them: the list is a queue of what to deal with,
              and the table that has been waiting longest is the one to deal with first. */}
          {alerts.map((alert) => (
            <AlertCard key={alert.id} alert={alert} thresholds={thresholds} />
          ))}
        </div>
      )}
    </main>
  );
}

function AlertCard({ alert, thresholds }) {
  const ack = useOrderMutation(alert.id, () => post(`/orders/${alert.id}/alert/ack`));

  // Present means this alert was acknowledged and has come back — the repeat window expired.
  // That is a different thing for a reader than an alert nobody has seen yet, so it says so.
  const returned = alert.previouslyAcknowledgedAt !== null;

  return (
    <div className="card">
      <div className="card-body row" style={{ justifyContent: 'space-between' }}>
        <div>
          <div className="row">
            <Link to={`/orders/${alert.id}`}>
              <strong>Table {alert.tableNumber}</strong>
            </Link>
            <StatusBadge status={alert.status} />
            <span className="badge alert">
              Open {duration(alert.minutesOpen)} · limit {thresholds.slowOrderMinutes}m
            </span>
          </div>
          <p className="muted" style={{ margin: '5px 0 0' }}>
            {alert.primaryWaiter.displayName} · {money(alert.total)}
            {returned && (
              <>
                {' '}
                · acknowledged by {alert.previouslyAcknowledgedBy.displayName} at{' '}
                {dateTime(alert.previouslyAcknowledgedAt)}, and alerting again
              </>
            )}
          </p>
        </div>

        <div className="row">
          <ErrorNotice error={ack.error} />
          <button disabled={ack.isPending} onClick={() => ack.mutate()}>
            {returned ? 'Acknowledge again' : 'Acknowledge'}
          </button>
          <Link to={`/orders/${alert.id}`} className="btn primary">
            Open
          </Link>
        </div>
      </div>
    </div>
  );
}
