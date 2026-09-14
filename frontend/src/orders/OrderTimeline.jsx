// §9. The order's history.
//
// Append-only, and the database enforces it: migration 001 has a trigger that refuses UPDATE
// and DELETE on order_timeline outright. So there is no edit control here and no delete
// control, not because they were left out but because there is no route to call — the API has
// only the half that appends.
//
// `actor` is the point of the whole table. The trigger stops history being *edited*; actor_id
// coming from the token rather than the request body stops it being *forged*. Both are needed,
// and together they are what makes "the manager overrode this" a fact rather than a claim.

import { EmptyState, Loading } from '../ui/components.jsx';
import { dateTime, money, statusLabel } from '../ui/format.js';
import { useTimeline } from './queries.js';

/**
 * One entry as a sentence.
 *
 * `details` is jsonb, and it is the one field that does not pass through a serializer —
 * toTimelineEntry hands `row.details` straight out — so what is in it is whatever the writer
 * put there. Everything the API writes is camelCase, which is what this reads.
 *
 * Every branch degrades instead of interpolating an absent value. An entry written by something
 * other than the API (the demo seed writes its own spelling: `qty`, `unit_price`, `collaborator`)
 * then reads as a plainer sentence that is still true, rather than "added undefined × Masala
 * Papad". Teaching this function the seed's spelling as well would make the frontend the place
 * that reconciles two shapes, which is the job of whoever writes them.
 *
 * An unrecognised action still renders: a timeline that silently omits an event it does not
 * understand is worse than one showing a bare verb.
 */
function describe(entry) {
  const d = entry.details ?? {};

  switch (entry.action) {
    case 'created':
      return d.tableNumber ? `opened the order for table ${d.tableNumber}` : 'opened the order';
    case 'status_changed':
      return `moved it from ${statusLabel(entry.fromStatus)} to ${statusLabel(entry.toStatus)}`;
    case 'line_added': {
      const what = d.item ? `${d.quantity ? `${d.quantity} × ` : ''}${d.item}` : 'an item';
      return `added ${what}${d.unitPrice ? ` at ${money(d.unitPrice)}` : ''}`;
    }
    case 'line_voided':
      return d.item ? `voided ${d.item}` : 'voided a line';
    case 'collaborator_added':
      return d.displayName ? `added ${d.displayName} as a collaborator` : 'added a collaborator';
    case 'note_added':
      return 'left a note';
    case 'archived':
      return 'archived the order';
    case 'restored':
      return 'restored the order';
    case 'alert_acknowledged':
      return d.snoozeMinutes
        ? `acknowledged the slow-order alert, snoozing it for ${d.snoozeMinutes} minutes`
        : 'acknowledged the slow-order alert';
    default:
      return entry.action.replace(/_/g, ' ');
  }
}

export default function OrderTimeline({ orderId, onAddNote }) {
  const { data: timeline, isPending } = useTimeline(orderId);

  return (
    <div className="card">
      <div className="card-head">
        <h2>History</h2>
        <button className="small" onClick={onAddNote}>
          Add note
        </button>
      </div>

      {isPending ? (
        <Loading />
      ) : timeline.length === 0 ? (
        <EmptyState title="No history yet" />
      ) : (
        <ol className="timeline">
          {/* Oldest first, as the API returns it. A history read top to bottom is the order of
              events; reversing it would make "moved it from Placed to Accepted" arrive before
              "opened the order". */}
          {timeline.map((entry) => (
            <li key={entry.id}>
              <div>
                <strong>{entry.actor.displayName}</strong>{' '}
                <span className="faint">({entry.actor.role})</span> {describe(entry)}
              </div>
              {/* The note is shown separately from the sentence: for a void it is the reason,
                  for a note it is the whole point, and quoting it keeps the two apart. */}
              {entry.note && <div className="timeline-note">“{entry.note}”</div>}
              <div className="faint" style={{ fontSize: 12.5 }}>
                {dateTime(entry.createdAt)}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
