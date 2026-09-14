// The bulk controls, inline at the top of the menu editor.
//
// Not a dialog. Both changes are offered side by side and the manager picks one; the list below
// then becomes the thing they select from, so the items being changed stay visible the whole
// time instead of being hidden behind the window asking about them.
import { describeOperation, MAX_OPERATIONS } from './bulkQueue.js';
import { money } from '../ui/format.js';
// A banked operation can name every item on the menu. Printing all of them makes one queue row
// taller than the list it describes, so the names are truncated and the count carries the rest.
const MAX_NAMES_SHOWN = 4;
function summariseItems(ids, nameOf) {
  const names = ids.slice(0, MAX_NAMES_SHOWN).map(nameOf).filter(Boolean);
  const rest = ids.length - names.length;
  return rest > 0 ? `${names.join(', ')} and ${rest} more` : names.join(', ');
}
export default function BulkBar({ bulk, nameOf }) {
  const { mode, queue, pending, applying } = bulk;
  return (
    <div className="bulk-bar">
      <div className="row">
        <strong className="nowrap">Change several:</strong>
        <label className="row" style={{ gap: 7 }}>
          <input
            type="checkbox"
            checked={mode === 'price'}
            onChange={() => bulk.switchMode(mode === 'price' ? null : 'price')}
          />
          <span>Set a new price</span>
        </label>
        <label className="row" style={{ gap: 7 }}>
          <input
            type="checkbox"
            checked={mode === 'isAvailable'}
            onChange={() => bulk.switchMode(mode === 'isAvailable' ? null : 'isAvailable')}
          />
          <span>Change availability</span>
        </label>
        <label className="row" style={{ gap: 7 }}>
          <input
            type="checkbox"
            checked={mode === 'archived'}
            onChange={() => bulk.switchMode(mode === 'archived' ? null : 'archived')}
          />
          <span>Archive or restore</span>
        </label>
        {mode === 'price' && (
          <input
            value={bulk.price}
            onChange={(e) => bulk.setPrice(e.target.value)}
            inputMode="decimal"
            placeholder="320.00"
            aria-label="New price"
            style={{ width: 120 }}
            autoFocus
          />
        )}
        {/* Radios, not a dropdown. Two options do not need a popup, and a <select> was the one
            control here that could not be changed reliably. */}
        {mode === 'isAvailable' &&
          [
            [true, 'Available'],
            [false, 'Off the menu'],
          ].map(([value, text]) => (
            <label key={String(value)} className="row" style={{ gap: 6 }}>
              <input
                type="radio"
                name="bulk-availability"
                checked={bulk.isAvailable === value}
                onChange={() => bulk.setIsAvailable(value)}
                style={{ width: 'auto' }}
              />
              <span>{text}</span>
            </label>
          ))}
        {mode === 'archived' &&
          [
            [true, 'Archive'],
            [false, 'Restore'],
          ].map(([value, text]) => (
            <label key={String(value)} className="row" style={{ gap: 6 }}>
              <input
                type="radio"
                name="bulk-archived"
                checked={bulk.archivedValue === value}
                onChange={() => bulk.setArchivedValue(value)}
                style={{ width: 'auto' }}
              />
              <span>{text}</span>
            </label>
          ))}
        <span style={{ marginLeft: 'auto' }} className="row">
          {mode !== null && (
            <span className="muted nowrap">{bulk.selected.size} selected</span>
          )}
          {/* Queue banks the change; it does not send it. Nothing reaches the database until
              Done, which is what makes a queue a queue rather than a slow Apply. */}
          <button onClick={bulk.queueCurrent} disabled={applying || pending === null}>
            Queue
          </button>
        </span>
      </div>
      {mode !== null && (
        <p className="faint" style={{ margin: '8px 0 0' }}>
          Pick the items below, then Queue it. Nothing is applied until you press Done.
        </p>
      )}
      {queue.length > 0 && (
        <div className="queue">
          <strong>Queued — applied when you press Done</strong>
          {queue.map((op, i) => (
            <div key={i} className="queue-row">
              <span style={{ flex: 1 }}>
                {describeOperation(op, money)}{' '}
                <span className="faint">
                  · {op.ids.length} item{op.ids.length === 1 ? '' : 's'}:{' '}
                  {summariseItems(op.ids, nameOf)}
                </span>
              </span>
              <button
                className="ghost small"
                onClick={() => bulk.removeOperation(i)}
                aria-label={`Remove ${describeOperation(op, money)}`}
              >
                ✕
              </button>
            </div>
          ))}
          <p className="faint" style={{ margin: '6px 0 0' }}>
            If an item appears twice for the same field, the later entry wins.
          </p>
        </div>
      )}
      {bulk.atCap && (
        <div className="notice warn" style={{ marginTop: 10, marginBottom: 0 }}>
          That is {MAX_OPERATIONS} banked changes — apply these before adding more.
        </div>
      )}
    </div>
  );
}
