// §3. The bill.
//
// Two things this component deliberately does not do:
//
//   * It never adds anything up. `total` is summed by Postgres on every read and arrives as a
//     string; `lineTotal` is quantity × unit_price done by Postgres too. Summing the lines here
//     to check would be reimplementing the FILTER that excludes voided lines, in floats.
//
//   * It never shows a voided line's value in the total's column. A voided line still exists
//     and still displays — struck through, with who voided it and why — because the difference
//     between a correction and an erasure is that a correction leaves a record.

import { useState } from 'react';
import { EmptyState } from '../ui/components.jsx';
import { money, time } from '../ui/format.js';
import VoidLineDialog from './VoidLineDialog.jsx';

// Lines can only change while the order is open. Same four statuses the API enforces — but
// this is the "may I edit" question, not "what may this become", so it is not the transition
// matrix and there is no endpoint that answers it per-order.
const OPEN_STATUSES = ['placed', 'accepted', 'preparing', 'ready'];

export default function OrderLines({ order, onAddLine }) {
  const [voiding, setVoiding] = useState(null);
  const open = OPEN_STATUSES.includes(order.status) && !order.archivedAt;

  return (
    <div className="card">
      <div className="card-head">
        <h2>Items</h2>
        {open && (
          <button className="small primary" onClick={onAddLine}>
            Add item
          </button>
        )}
      </div>

      {order.lines.length === 0 ? (
        <EmptyState title="Nothing on this order yet">
          {open ? 'Add the first item.' : 'This order was closed without any items.'}
        </EmptyState>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th className="right">Qty</th>
                <th className="right">Unit</th>
                <th className="right">Line total</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {order.lines.map((line) => (
                <tr key={line.id} className={line.voidedAt ? 'voided' : undefined}>
                  <td>
                    <div>{line.itemName}</div>
                    {line.instructions && (
                      <div className="faint" style={{ fontSize: 13 }}>
                        {line.instructions}
                      </div>
                    )}
                    {line.voidedAt && (
                      <div className="faint" style={{ fontSize: 13 }}>
                        Voided by {line.voidedBy.displayName} at {time(line.voidedAt)} —{' '}
                        {line.voidReason}
                      </div>
                    )}
                  </td>
                  <td className="right">{line.quantity}</td>
                  {/* The price snapshotted when the line was added, not the menu's price now.
                      Repricing the menu tomorrow must not rewrite tonight's bill. */}
                  <td className="right nowrap">{money(line.unitPrice)}</td>
                  <td className="right nowrap">{money(line.lineTotal)}</td>
                  <td className="right">
                    {open && !line.voidedAt && (
                      <button className="ghost small danger" onClick={() => setVoiding(line)}>
                        Void
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} className="right">
                  <strong>Total</strong>
                  {order.lines.some((l) => l.voidedAt) && (
                    <span className="faint"> (voided lines excluded)</span>
                  )}
                </td>
                <td className="right nowrap">
                  <strong>{money(order.total)}</strong>
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {voiding && (
        <VoidLineDialog order={order} line={voiding} onClose={() => setVoiding(null)} />
      )}
    </div>
  );
}
