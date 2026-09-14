// Order rows, as the API shows them.
//
// Money is NUMERIC and arrives from pg as a string (src/db.js); it stays one all the way out.
// `total` and `lineTotal` are summed and multiplied by Postgres, never in JavaScript — a bill
// added up in floats is the one bug this whole convention exists to prevent.

import { nextStatuses } from './lifecycle.js';

const person = (id, displayName) => (id == null ? null : { id, displayName });

/**
 * One order. `total` and `lineCount` appear only when the query asked for them, so the same
 * function serves the list and the detail view.
 *
 * `allowedNextStatuses` is derived rather than stored: the client gets the legal moves with
 * the order, so a waiter's buttons come from the server's copy of the matrix instead of a
 * second copy in the frontend.
 */
export const toOrder = (row) => ({
  id: row.id,
  tableNumber: row.table_number,
  status: row.status,
  allowedNextStatuses: nextStatuses(row.status),
  primaryWaiter: person(row.primary_waiter_id, row.primary_waiter_name),
  placedAt: row.placed_at,
  readyAt: row.ready_at,
  servedAt: row.served_at,
  cancelledAt: row.cancelled_at,
  archivedAt: row.archived_at,
  alertAckedAt: row.alert_acked_at,
  updatedAt: row.updated_at,
  ...(row.total !== undefined ? { total: row.total } : {}),
  ...(row.line_count !== undefined ? { lineCount: row.line_count } : {}),
  ...(row.collaborator_count !== undefined
    ? { collaboratorCount: row.collaborator_count }
    : {}),
});

/**
 * One order line. `itemName` and `unitPrice` are the snapshot taken when the line was added,
 * not the menu item's current values — a later price change must not rewrite an old bill (§3).
 * `menuItemId` is kept so the UI can still link back to the item it came from, archived or not.
 */
export const toLine = (row) => ({
  id: row.id,
  menuItemId: row.menu_item_id,
  itemName: row.item_name,
  unitPrice: row.unit_price,
  quantity: row.quantity,
  lineTotal: row.line_total,
  instructions: row.instructions,
  voidedAt: row.voided_at,
  voidedBy: person(row.voided_by, row.voided_by_name),
  voidReason: row.void_reason,
  createdAt: row.created_at,
});

export const toCollaborator = (row) => ({
  id: row.id,
  displayName: row.display_name,
  role: row.role,
  addedAt: row.added_at,
  addedBy: person(row.added_by, row.added_by_name),
});

/**
 * One timeline entry (§9). `actor` is the whole point of the table: the append-only trigger
 * stops history being edited, and actor_id coming from the token stops it being forged, so
 * "the manager overrode this" stays visible forever.
 */
export const toTimelineEntry = (row) => ({
  id: row.id,
  action: row.action,
  actor: { id: row.actor_id, displayName: row.actor_name, role: row.actor_role },
  fromStatus: row.from_status,
  toStatus: row.to_status,
  lineId: row.line_id,
  note: row.note,
  details: row.details,
  createdAt: row.created_at,
});
