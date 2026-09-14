// §1. Browsing is open to both roles; every write is manager-only.
//
// This page is only ever a menu to read. A manager sees what a waiter sees plus two controls —
// editing is a mode you enter deliberately, not a set of buttons sitting on top of a list you
// are mostly just looking at.
//
// Nothing here deletes. Archiving is a timestamp, because old order lines still point at the
// item and a deleted row would take a served order's history with it.

import { useState } from 'react';
import { useIsManager } from '../auth/AuthContext.jsx';
import { EmptyState, ErrorNotice, Loading } from '../ui/components.jsx';
import MenuEditor from './MenuEditor.jsx';
import MenuTable from './MenuTable.jsx';
import { useMenuItems } from './queries.js';

export default function MenuPage() {
  const isManager = useIsManager();
  const [editing, setEditing] = useState(false);

  // Off by default, and a manager's control only.
  //
  // The default matters more than the switch: a menu you are reading should be the menu you can
  // order from, so anything retired stays out until somebody asks for it. But "asks for it" has
  // to be possible without entering edit mode — checking whether last season's dish is still on
  // record is a reading question, not an editing one.
  //
  // Deliberately different from the editor, where archived items are always shown in their own
  // section at the bottom. There they are always relevant; here they are the exception.
  const [showArchived, setShowArchived] = useState(false);

  // The server ignores this flag for a waiter rather than refusing it, so the request is the
  // same for both roles and only the checkbox is hidden. Guarded here anyway, so a waiter never
  // sends a parameter that could not do anything.
  const { data: items, isPending, error } = useMenuItems(isManager && showArchived);

  if (isPending) return <Loading label="Loading the menu…" />;

  const archivedCount = (items ?? []).filter((i) => i.archivedAt).length;

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Menu</h1>
          <p>
            {(items?.length ?? 0) - archivedCount} on the menu
            {archivedCount > 0 && ` · ${archivedCount} archived`}
          </p>
        </div>

        {isManager && (
          <div className="row">
            <label className="row" style={{ gap: 6 }}>
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
              />
              <span>Show archived</span>
            </label>
            <button className="primary" onClick={() => setEditing(true)}>
              Update menu
            </button>
          </div>
        )}
      </div>

      <ErrorNotice error={error} />

      <div className="card">
        {items.length === 0 ? <EmptyState title="The menu is empty" /> : <MenuTable items={items} />}
      </div>

      {editing && <MenuEditor onClose={() => setEditing(false)} />}
    </main>
  );
}
