// One order: its lines and total (§3), its status actions (§4), and its history (§9).
//
// The status buttons are the thing to look at. There is no transition matrix in this file, or
// anywhere else in the frontend — `order.allowedNextStatuses` arrives on every order, derived
// by the server from the one copy in backend/src/orders/lifecycle.js. Which means a rule change
// there changes the buttons here with no frontend edit at all, and the two can never disagree.

import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { post } from '../api/client.js';
import { useAlerts } from '../alerts/queries.js';
import { ErrorNotice, Loading, StatusBadge } from '../ui/components.jsx';
import { dateTime, duration, minutesSince, statusLabel, time } from '../ui/format.js';
import AddCollaboratorDialog from './AddCollaboratorDialog.jsx';
import AddLineDialog from './AddLineDialog.jsx';
import AddNoteDialog from './AddNoteDialog.jsx';
import OrderLines from './OrderLines.jsx';
import OrderTimeline from './OrderTimeline.jsx';
import { useOrder, useOrderMutation } from './queries.js';

export default function OrderDetailPage() {
  const { id } = useParams();
  const { data: order, isPending, error } = useOrder(id);

  const [dialog, setDialog] = useState(null);

  // Is this order alerting right now? Asked of /alerts rather than worked out from placedAt —
  // the predicate has an acknowledgement window and a repeat rule, and POST /alert/ack answers
  // 409 NOT_ALERTING if we get it wrong, so the button must only appear when the server agrees.
  const { data: alertData } = useAlerts();
  const alert = (alertData?.alerts ?? []).find((a) => a.id === id);

  // One hook for every status move, including cancelling — the API made them one route because
  // they are one rule, and cancelling is simply the move that stops being legal at Preparing.
  const changeStatus = useOrderMutation(id, (status) => post(`/orders/${id}/status`, { status }));
  const archive = useOrderMutation(id, (restore) => post(`/orders/${id}/${restore ? 'restore' : 'archive'}`));
  const ack = useOrderMutation(id, () => post(`/orders/${id}/alert/ack`));

  if (isPending) return <Loading label="Loading order…" />;

  // 404 covers both "no such order" and "not yours" — deliberately indistinguishable, because
  // order ids are sequential and a 403 would let a waiter enumerate the restaurant's orders.
  if (error) {
    return (
      <main className="page">
        <ErrorNotice error={error} />
        <Link to="/orders" className="btn">
          Back to orders
        </Link>
      </main>
    );
  }

  const busy = changeStatus.isPending || archive.isPending || ack.isPending;
  const actionError = changeStatus.error ?? archive.error ?? ack.error;

  return (
    <main className="page">
      <Link to="/orders" className="muted">
        ← Orders
      </Link>

      <div className="page-head" style={{ marginTop: 10 }}>
        <div>
          <div className="row">
            <h1>Table {order.tableNumber}</h1>
            <StatusBadge status={order.status} />
            {alert && (
              <span className="badge alert">
                Open {duration(alert.minutesOpen)} · limit {alertData.thresholds.slowOrderMinutes}m
              </span>
            )}
            {order.archivedAt && <span className="badge archived">Archived</span>}
          </div>
          <p>
            {order.primaryWaiter.displayName} · placed {time(order.placedAt)} (
            {duration(minutesSince(order.placedAt))} ago)
          </p>
        </div>

        <div className="row">
          {/* Straight from the server. No filtering, no reordering, no extra conditions —
              if it is in this array the transition is legal, and if it is not it is a 409. */}
          {order.allowedNextStatuses.map((status) => (
            <button
              key={status}
              className={status === 'cancelled' ? 'danger' : 'primary'}
              disabled={busy}
              onClick={() => changeStatus.mutate(status)}
            >
              {status === 'cancelled' ? 'Cancel order' : `Mark ${statusLabel(status)}`}
            </button>
          ))}

          {alert && (
            <button disabled={busy} onClick={() => ack.mutate()}>
              Acknowledge ({alertData.thresholds.repeatMinutes}m)
            </button>
          )}

          {/* Archiving is restricted to terminal states (Decision 6), so the button only shows
              where the server would accept it. The restore side has no such rule. */}
          {order.archivedAt ? (
            <button disabled={busy} onClick={() => archive.mutate(true)}>
              Restore
            </button>
          ) : (
            (order.status === 'served' || order.status === 'cancelled') && (
              <button disabled={busy} onClick={() => archive.mutate(false)}>
                Archive
              </button>
            )
          )}
        </div>
      </div>

      <ErrorNotice error={actionError} />

      <div className="detail-grid">
        <div style={{ display: 'grid', gap: 16 }}>
          <OrderLines order={order} onAddLine={() => setDialog('line')} />
        </div>

        <div style={{ display: 'grid', gap: 16 }}>
          <div className="card">
            <div className="card-head">
              <h2>People</h2>
              <button className="small" onClick={() => setDialog('collaborator')}>
                Add collaborator
              </button>
            </div>
            <div className="card-body" style={{ display: 'grid', gap: 10 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span>{order.primaryWaiter.displayName}</span>
                <span className="badge">Primary</span>
              </div>
              {order.collaborators.map((c) => (
                <div key={c.id} className="row" style={{ justifyContent: 'space-between' }}>
                  <span>{c.displayName}</span>
                  <span className="faint">added by {c.addedBy.displayName}</span>
                </div>
              ))}
              {order.collaborators.length === 0 && (
                <p className="faint" style={{ margin: 0 }}>
                  Adding a collaborator lets another waiter see and act on this order — in this
                  API, being able to see an order and being able to act on it are the same thing.
                </p>
              )}
            </div>
          </div>

          <Timestamps order={order} />

          <OrderTimeline orderId={id} onAddNote={() => setDialog('note')} />
        </div>
      </div>

      {dialog === 'line' && <AddLineDialog order={order} onClose={() => setDialog(null)} />}
      {dialog === 'collaborator' && (
        <AddCollaboratorDialog order={order} onClose={() => setDialog(null)} />
      )}
      {dialog === 'note' && <AddNoteDialog orderId={id} onClose={() => setDialog(null)} />}
    </main>
  );
}

/** The stamped columns. Only the ones that happened — a null readyAt is not a fact worth a row. */
function Timestamps({ order }) {
  const stamps = [
    ['Placed', order.placedAt],
    ['Ready', order.readyAt],
    ['Served', order.servedAt],
    ['Cancelled', order.cancelledAt],
    ['Archived', order.archivedAt],
  ].filter(([, value]) => value);

  return (
    <div className="card">
      <div className="card-head">
        <h2>Timestamps</h2>
      </div>
      <div className="card-body" style={{ display: 'grid', gap: 7 }}>
        {stamps.map(([label, value]) => (
          <div key={label} className="row" style={{ justifyContent: 'space-between' }}>
            <span className="muted">{label}</span>
            <span className="nowrap">{dateTime(value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
