// The outcome of a bulk apply, shown in place above the list rather than in a window.
//
// Keeping it inline matters more than it looks: the items it is describing are on screen
// directly beneath it, so "Updated · ₹55.00" can be checked against the row it refers to
// without dismissing anything.

import { ErrorNotice } from '../ui/components.jsx';
import { money } from '../ui/format.js';

/** One field's outcome for one item. */
function Outcome({ change }) {
  // The field was not part of this sweep, so there is nothing to say about it.
  if (!change) return <span className="faint">—</span>;
  if (change.status === 'updated') return <span className="badge ready">Updated</span>;

  return (
    <>
      <span className="badge cancelled">{change.code}</span>{' '}
      <span className="muted">{change.reason}</span>
    </>
  );
}

export default function BulkReport({ report, nameOf, onDismiss }) {
  if (report.error) {
    return (
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-body">
          <ErrorNotice error={report.error} />
          <button onClick={onDismiss}>Dismiss</button>
        </div>
      </div>
    );
  }

  const { summary, results, fields } = report;

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-head">
        <h2>Bulk update — result</h2>
        <button className="ghost small" onClick={onDismiss} aria-label="Dismiss">
          ✕
        </button>
      </div>

      <div className="card-body">
        {/* Four outcomes, not two. "Partly" is the one the per-field report exists for. */}
        <div
          className={`notice ${
            summary.rejected === 0 && summary.partial === 0
              ? 'ok'
              : summary.updated === 0 && summary.partial === 0
                ? 'error'
                : 'warn'
          }`}
          style={{ marginBottom: 12 }}
        >
          <strong>
            {summary.updated} of {summary.requested} fully updated
          </strong>
          {summary.partial > 0 && <> · {summary.partial} partly</>}
          {summary.rejected > 0 && <> · {summary.rejected} rejected</>}
          .{' '}
          {summary.updated === 0 && summary.partial === 0
            ? 'Nothing was changed.'
            : 'Whatever succeeded was not rolled back — each item, and each field, stands or falls on its own.'}
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Item</th>
                {/* Only the fields this sweep actually carried get a column. */}
                {fields.includes('price') && <th>Price</th>}
                {fields.includes('isAvailable') && <th>Availability</th>}
                {fields.includes('archived') && <th>Archive</th>}
              </tr>
            </thead>
            <tbody>
              {results.map((result) => (
                <tr key={result.id}>
                  <td>
                    {/* A rejection carries an id and a reason but no row — the server has
                        nothing to return for an item it refused — so the name falls back to
                        the list the request was built from. */}
                    {result.menuItem?.name ?? nameOf(result.id) ?? (
                      <span className="mono">#{result.id}</span>
                    )}
                  </td>
                  {fields.includes('price') && (
                    <td>
                      <Outcome change={result.changes.price} />
                      {result.changes.price?.status === 'updated' && result.menuItem && (
                        <span className="faint"> · {money(result.menuItem.price)}</span>
                      )}
                    </td>
                  )}
                  {fields.includes('isAvailable') && (
                    <td>
                      <Outcome change={result.changes.isAvailable} />
                      {result.changes.isAvailable?.status === 'updated' && result.menuItem && (
                        <span className="faint">
                          {' '}
                          · {result.menuItem.isAvailable ? 'available' : 'off'}
                        </span>
                      )}
                    </td>
                  )}
                  {fields.includes('archived') && (
                    <td>
                      <Outcome change={result.changes.archived} />
                      {result.changes.archived?.status === 'updated' && result.menuItem && (
                        <span className="faint">
                          {' '}
                          · {result.menuItem.archivedAt ? 'archived' : 'restored'}
                        </span>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
