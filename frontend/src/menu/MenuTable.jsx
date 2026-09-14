// The menu list, rendered once and used twice: read-only on the page, interactive in the editor.
//
// Whether a row does anything is decided by `onRowClick` being passed or not, and what it means
// is decided by `selecting`. That keeps "what the menu looks like" in one file, so the browse
// view and the edit view can never drift into showing different columns or formatting a price
// two different ways.

import { money } from '../ui/format.js';

export default function MenuTable({ items, onRowClick, selecting, selectedIds, queuedIds, allArchived }) {
  const clickable = typeof onRowClick === 'function';

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th>Category</th>
            <th className="right">Price</th>
            <th>Availability</th>
            {clickable && <th />}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const isSelected = selecting && selectedIds?.has(item.id);

            return (
              <tr
                key={item.id}
                className={[
                  item.archivedAt ? 'voided' : '',
                  clickable ? 'clickable' : '',
                  isSelected ? 'selected' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={clickable ? () => onRowClick(item) : undefined}
                // A row that does something must be reachable and operable from the keyboard. A
                // <tr> is not a button, so it needs the role, a tab stop, and Enter/Space handled
                // by hand — the three things a real <button> would have given for free.
                //
                // While selecting, the row is a toggle rather than a link, so it also carries
                // aria-pressed: a screen reader should be told whether this item is in the
                // selection, which is the whole state the click is changing.
                {...(clickable
                  ? {
                      role: 'button',
                      tabIndex: 0,
                      ...(selecting ? { 'aria-pressed': Boolean(isSelected) } : {}),
                      onKeyDown: (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onRowClick(item);
                        }
                      },
                    }
                  : {})}
              >
                <td>
                  <strong>{item.name}</strong>
                  {/* Suppressed when the whole table is the archived section — the heading
                      above it already says so, and a badge on every row is just noise. */}
                  {item.archivedAt && !allArchived && (
                    <span className="badge archived" style={{ marginLeft: 8 }}>
                      Archived
                    </span>
                  )}
                  {/* An item already carrying a banked change. Selecting it again is allowed —
                      that is how "the later entry wins" gets expressed. */}
                  {queuedIds?.has(item.id) && (
                    <span className="badge" style={{ marginLeft: 8 }}>
                      Banked
                    </span>
                  )}
                </td>
                <td className="muted">{item.category}</td>
                {/* NUMERIC(10,2) as a string, formatted. Never parsed, never added up. */}
                <td className="right nowrap">{money(item.price)}</td>
                <td>
                  <span className={`badge ${item.isAvailable ? 'ready' : 'cancelled'}`}>
                    {item.isAvailable ? 'Available' : 'Off'}
                  </span>
                </td>
                {clickable && (
                  <td className="right nowrap" aria-hidden="true">
                    {selecting ? (
                      <span className={isSelected ? 'tick on' : 'tick'}>✓</span>
                    ) : (
                      <span className="faint">Edit →</span>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
