// Edit mode for the menu, as one full-screen modal.
//
// Why a <dialog> opened with showModal() rather than a panel on the page: showModal() puts the
// element in the browser's "top layer" and makes everything behind it INERT — not merely
// covered. Clicks do not land, Tab does not reach it, screen readers skip it, and the page
// behind does not scroll. That is the "you cannot interact with anything else until you leave"
// rule enforced by the browser, rather than by me stacking a div with a high z-index and then
// discovering six months later that the nav is still keyboard-reachable underneath.
//
// Everything else happens in here rather than in further windows. The bulk controls sit above
// the list, the list is what you select from, and the result appears in place — so the items
// being changed are on screen the whole time instead of behind the thing asking about them.
//
// One list, two meanings for a click, decided by whether a bulk change is being built:
//
//   no bulk change  →  clicking a row opens that item's own options
//   building one    →  clicking a row adds or removes it from the selection

import { useEffect, useRef, useState } from 'react';
import { EmptyState, ErrorNotice, Loading, Spinner } from '../ui/components.jsx';
import BulkBar from './BulkBar.jsx';
import BulkReport from './BulkReport.jsx';
import { useBulkQueue } from './bulkQueue.js';
import MenuItemDialog from './MenuItemDialog.jsx';
import MenuTable from './MenuTable.jsx';
import { useMenuItems } from './queries.js';

export default function MenuEditor({ onClose }) {
  const ref = useRef(null);

  const [editingItem, setEditingItem] = useState(null); // an item, or 'new'

  // Always with archived items, and no toggle.
  //
  // They are only ever visible here — the browse view asks for the live menu and has no switch,
  // because a menu you are reading should be the menu you can order from. Inside the editor
  // they are always relevant: restoring one is an editing action, bulk archive needs them as
  // targets, and a hidden-by-default section is a thing managers forget exists.
  const { data: items, isPending, error } = useMenuItems(true);
  const bulk = useBulkQueue();

  useEffect(() => {
    const el = ref.current;
    if (!el.open) el.showModal();

    const handleClose = () => onClose();
    el.addEventListener('close', handleClose);
    return () => el.removeEventListener('close', handleClose);
  }, [onClose]);

  // The queue lives in memory only, so closing this dialog destroys it. Escape is one keystroke
  // away at all times, so it gets a confirmation rather than silently binning work — the same
  // reasoning as the price that used to vanish when you switched fields.
  useEffect(() => {
    const el = ref.current;
    const onCancel = (e) => {
      if (bulk.queue.length === 0 && bulk.pending === null) return;
      e.preventDefault();
      if (window.confirm('Discard the queued changes? They have not been applied yet.')) {
        el.close();
      }
    };
    el.addEventListener('cancel', onCancel);
    return () => el.removeEventListener('cancel', onCancel);
  }, [bulk.queue.length, bulk.pending]);

  const nameOf = (id) => (items ?? []).find((i) => i.id === id)?.name;

  // Split rather than sorted. Archived items are a different kind of thing from the working
  // menu — they cannot be ordered and most of the time nobody is looking for them — so they get
  // their own section at the bottom instead of being interleaved by category.
  const live = (items ?? []).filter((i) => !i.archivedAt);
  const archived = (items ?? []).filter((i) => i.archivedAt);

  return (
    <dialog ref={ref} className="editor">
      <div className="editor-head">
        <div>
          <h2>Editing the menu</h2>
          <p className="muted" style={{ margin: 0 }}>
            {bulk.selecting
              ? 'Click items to include them in the change above.'
              : 'Click an item to change its price or availability, or to archive it.'}
          </p>
        </div>
        {/* Done is where everything actually happens. With work queued it applies it and stays
            open so the result can be read; with nothing queued there is nothing left to do but
            leave. Anything still being described is banked first, so a manager who queued
            nothing and simply picked items never loses them to a button labelled "Done". */}
        <button
          className="primary"
          disabled={bulk.applying}
          onClick={() => (bulk.hasWork ? bulk.apply() : ref.current.close())}
        >
          {bulk.applying && <Spinner />}
          {bulk.hasWork ? `Done — apply ${bulk.queue.length + (bulk.pending ? 1 : 0)}` : 'Done'}
        </button>
      </div>

      <div className="editor-toolbar">
        <button onClick={() => setEditingItem('new')}>New item</button>

        {bulk.selecting && (
          <button
            className="small"
            onClick={() =>
              bulk.selectMany(
                live.length > 0 && live.every((i) => bulk.selected.has(i.id))
                  ? []
                  : live.map((i) => i.id)
              )
            }
          >
            {live.length > 0 && live.every((i) => bulk.selected.has(i.id))
              ? 'Clear selection'
              : 'Select all live'}
          </button>
        )}

      </div>

      {/* §7, offered directly rather than behind a window that asks which change you meant. */}
      <BulkBar bulk={bulk} nameOf={nameOf} />

      <div className="editor-body">
        <ErrorNotice error={error} />

        {bulk.report && (
          <BulkReport report={bulk.report} nameOf={nameOf} onDismiss={bulk.dismissReport} />
        )}

        {isPending ? (
          <Loading />
        ) : items.length === 0 ? (
          <EmptyState title="The menu is empty">Start with New item.</EmptyState>
        ) : (
          <>
            <MenuTable
              items={live}
              selecting={bulk.selecting}
              selectedIds={bulk.selected}
              queuedIds={bulk.queuedIds}
              onRowClick={(item) => (bulk.selecting ? bulk.toggle(item.id) : setEditingItem(item))}
            />

            {archived.length > 0 && (
              <div className="archived-section">
                <h3>
                  Archived <span className="faint">· {archived.length}</span>
                </h3>
                <p className="faint" style={{ margin: '2px 0 10px' }}>
                  Off the menu and not orderable. Old order lines still point at these, which is
                  why they are archived rather than deleted.
                </p>
                <MenuTable
                  items={archived}
                  allArchived
                  selecting={bulk.selecting}
                  selectedIds={bulk.selected}
                  queuedIds={bulk.queuedIds}
                  onRowClick={(item) =>
                    bulk.selecting ? bulk.toggle(item.id) : setEditingItem(item)
                  }
                />
              </div>
            )}
          </>
        )}
      </div>

      {/* The only remaining window, and it is not asking which action you want — it is one
          item's own form, reached by clicking that item. */}
      {editingItem === 'new' && (
        <MenuItemDialog item={null} onClose={() => setEditingItem(null)} />
      )}
      {editingItem && editingItem !== 'new' && (
        <MenuItemDialog item={editingItem} onClose={() => setEditingItem(null)} />
      )}
    </dialog>
  );
}
