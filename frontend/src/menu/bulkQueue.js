// §7's queue: the state and the rules behind the bulk controls in the menu editor.
//
// A bulk change is built up as a list of operations. Each one is a field, a value, and the
// items that were selected at the moment it was banked — so a price change applies to the items
// chosen for it and nothing else. Choosing the other field banks what you have and clears the
// selection, which is what stops one selection bleeding into the next.
//
// Separated from the components on purpose: resolveIntent and planRequests are the only two
// pieces of real logic here, they are pure, and keeping them out of JSX is what would make them
// straightforward to test.

import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { post } from '../api/client.js';
import { menuKeys } from './queries.js';

// The queue lives only while the editor is open, so it cannot grow without bound — but a cap
// keeps an accidental click-fest from building a list nobody can read. The second cap is the
// API's own: it refuses more than 200 ids in one request.
export const MAX_OPERATIONS = 20;
const MAX_IDS_PER_REQUEST = 200;

// How many of those requests are allowed to be in flight at once.
//
// The queue folds down to one request per distinct payload, so twenty banked operations can
// still mean twenty calls. Firing all of them together would put twenty concurrent requests
// against an API whose connection pool is five (PGPOOL_MAX on Render), each one running two
// queries — they would not fail, they would queue inside the server and hold connections that
// the rest of the restaurant is also trying to use. Four at a time keeps it brisk without
// monopolising the pool.
const MAX_IN_FLIGHT = 4;

/** Run thunks in batches, so at most `limit` are outstanding at any moment. */
async function runBatched(thunks, limit) {
  const out = [];
  for (let i = 0; i < thunks.length; i += limit) {
    out.push(...(await Promise.all(thunks.slice(i, i + limit).map((run) => run()))));
  }
  return out;
}

/**
 * Fold the queue into one final intention per item.
 *
 * Later operations win, per field: an item named by two price operations ends at the second
 * price, and an availability change in between survives untouched because it is a different
 * key. Without this the same item would be written twice and appear twice in the report — once
 * with a value that was already superseded before the request left the browser.
 */
export function resolveIntent(queue) {
  const intent = new Map();
  for (const op of queue) {
    for (const id of op.ids) {
      intent.set(id, { ...(intent.get(id) ?? {}), [op.field]: op.value });
    }
  }
  return intent;
}

/**
 * Group items that end with identical intentions, so each distinct payload is one request.
 *
 * This is where an item that collected BOTH a price and an availability along the way becomes a
 * single call carrying both — which is what the endpoint was widened to accept, and what lets
 * the two changes be reported independently for that item.
 *
 * Every item lands in exactly one batch, so the batches are disjoint and can be sent in
 * parallel without racing each other.
 */
export function planRequests(intent) {
  const byPayload = new Map();
  for (const [id, fields] of intent) {
    const key = JSON.stringify(fields);
    if (!byPayload.has(key)) byPayload.set(key, { fields, ids: [] });
    byPayload.get(key).ids.push(id);
  }

  // Split anything over the endpoint's own limit rather than letting it 422.
  return [...byPayload.values()].flatMap(({ fields, ids }) => {
    const chunks = [];
    for (let i = 0; i < ids.length; i += MAX_IDS_PER_REQUEST) {
      chunks.push({ fields, ids: ids.slice(i, i + MAX_IDS_PER_REQUEST) });
    }
    return chunks;
  });
}

export const describeOperation = (op, money) => {
  if (op.field === 'price') return `Price → ${money(op.value)}`;
  if (op.field === 'isAvailable') return `Availability → ${op.value ? 'available' : 'off the menu'}`;
  return op.value ? 'Archive' : 'Restore from archive';
};

export function useBulkQueue() {
  // Neither field is chosen until the manager chooses one. Defaulting to "price" pre-answered a
  // question nobody had asked, and made the first click a correction rather than a choice.
  const [mode, setMode] = useState(null); // 'price' | 'isAvailable' | 'archived' | null
  const [price, setPrice] = useState('');
  const [isAvailable, setIsAvailable] = useState(true);
  // true archives, false restores — the same shape the endpoint takes.
  const [archivedValue, setArchivedValue] = useState(true);
  const [selected, setSelected] = useState(() => new Set());
  const [queue, setQueue] = useState([]);
  const [report, setReport] = useState(null);
  const [applying, setApplying] = useState(false);

  // The requests are fired by hand rather than through a mutation hook, because one Apply can
  // mean several calls and a mutation models one. Invalidation is the part that must not be
  // lost, so it is done explicitly.
  const queryClient = useQueryClient();

  /** The in-progress operation, or null if it is not complete enough to bank. */
  const pending = useMemo(() => {
    if (mode === null || selected.size === 0) return null;
    if (mode === 'price' && price.trim() === '') return null;

    const value =
      mode === 'price' ? price.trim() : mode === 'isAvailable' ? isAvailable : archivedValue;

    return { field: mode, value, ids: [...selected] };
  }, [mode, price, isAvailable, archivedValue, selected]);

  // Items already carrying a queued change, so the list can say so. Selecting one again is
  // allowed on purpose — that is how "the later entry wins" gets expressed.
  const queuedIds = useMemo(() => new Set(queue.flatMap((op) => op.ids)), [queue]);

  const clearForm = () => {
    setSelected(new Set());
    setPrice('');
    setIsAvailable(true);
    setArchivedValue(true);
  };

  /** Bank whatever is in progress, then start fresh on `next` (or on nothing). */
  function switchMode(next) {
    if (pending && queue.length < MAX_OPERATIONS) setQueue((q) => [...q, pending]);
    setMode(next);
    clearForm();
  }

  /**
   * Bank the operation in progress and clear the form for the next one.
   *
   * The explicit version of what switching fields already did implicitly. Nothing is sent —
   * that only happens on Done — so this is purely "I have finished describing this change".
   */
  function queueCurrent() {
    if (!pending || queue.length >= MAX_OPERATIONS) return;
    setQueue((q) => [...q, pending]);
    setMode(null);
    clearForm();
  }

  const toggle = (id) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const removeOperation = (index) => setQueue((q) => q.filter((_, i) => i !== index));

  async function apply() {
    // Apply banks the operation in progress first, so a single change never needs a mode switch
    // to count — and nothing a manager typed is silently thrown away.
    const finalQueue = pending && queue.length < MAX_OPERATIONS ? [...queue, pending] : queue;
    if (finalQueue.length === 0) return;

    const requests = planRequests(resolveIntent(finalQueue));

    setApplying(true);
    try {
      const responses = await runBatched(
        requests.map(
          (r) => () =>
            post('/menu-items/bulk', { ids: r.ids, ...r.fields }).catch((error) => ({ error }))
        ),
        MAX_IN_FLIGHT
      );

      // Something reached the database either way, so the menu is stale — invalidate before
      // deciding what to show.
      queryClient.invalidateQueries({ queryKey: menuKeys.all });

      const failed = responses.find((r) => r.error);
      setReport(
        failed
          ? { error: failed.error }
          : {
              summary: responses.reduce(
                (acc, r) => ({
                  requested: acc.requested + r.summary.requested,
                  updated: acc.updated + r.summary.updated,
                  partial: acc.partial + r.summary.partial,
                  rejected: acc.rejected + r.summary.rejected,
                }),
                { requested: 0, updated: 0, partial: 0, rejected: 0 }
              ),
              results: responses.flatMap((r) => r.results),
              fields: [...new Set(finalQueue.map((op) => op.field))],
            }
      );

      setQueue([]);
      setMode(null);
      clearForm();
    } finally {
      setApplying(false);
    }
  }

  return {
    mode,
    switchMode,
    price,
    setPrice,
    isAvailable,
    setIsAvailable,
    archivedValue,
    setArchivedValue,
    selected,
    toggle,
    selectMany: (ids) => setSelected(new Set(ids)),
    queue,
    queuedIds,
    queueCurrent,
    removeOperation,
    pending,
    // Anything Done would send: banked operations, plus one still being described.
    hasWork: queue.length > 0 || pending !== null,
    applying,
    apply,
    report,
    dismissReport: () => setReport(null),
    // True when the list should behave as a selection surface rather than a set of links.
    selecting: mode !== null,
    atCap: queue.length >= MAX_OPERATIONS,
  };
}
