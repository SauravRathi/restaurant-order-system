// The order lifecycle (§4), written once.
//
// docs/api.md states the matrix as forward-only, no skipping, no reversing, and cancellation
// dying at `preparing`. Keeping it as data rather than a chain of ifs means the API can also
// *tell* a client what the legal moves are, which is what stops the frontend keeping its own
// copy of these rules and drifting from this one.

import { conflict } from '../http/errors.js';

export const ORDER_STATUSES = ['placed', 'accepted', 'preparing', 'ready', 'served', 'cancelled'];

const TRANSITIONS = {
  placed: ['accepted', 'cancelled'],
  accepted: ['preparing', 'cancelled'],
  preparing: ['ready'],
  ready: ['served'],
  served: [],
  cancelled: [],
};

/** Statuses in which an order is still open for edits — lines may be added or voided. */
export const OPEN_STATUSES = ['placed', 'accepted', 'preparing', 'ready'];

/** Terminal statuses. Also the only two an order may be archived from (Decision 6). */
export const TERMINAL_STATUSES = ['served', 'cancelled'];

export const isOpen = (status) => OPEN_STATUSES.includes(status);
export const isTerminal = (status) => TERMINAL_STATUSES.includes(status);

export const nextStatuses = (status) => TRANSITIONS[status] ?? [];

// Moving into one of these stamps a column. placed_at is set at creation by the table default,
// so it is not here.
const STAMP_COLUMN = {
  ready: 'ready_at',
  served: 'served_at',
  cancelled: 'cancelled_at',
};

export const stampColumnFor = (status) => STAMP_COLUMN[status] ?? null;

const LABEL = {
  placed: 'Placed',
  accepted: 'Accepted',
  preparing: 'Preparing',
  ready: 'Ready',
  served: 'Served',
  cancelled: 'Cancelled',
};

/**
 * Throw 409 unless `to` is reachable from `from`.
 *
 * Every rejection names the current state and why the target is refused — a bare "invalid
 * transition" would leave a waiter staring at a button that does nothing. The cancellation
 * sentence is the one docs/api.md spells out word for word, because it is the specific rule §4
 * asks for and it has to point somewhere useful: void the lines instead.
 */
export function assertTransition(from, to) {
  if (TRANSITIONS[from]?.includes(to)) return;

  if (from === to) {
    throw conflict(`This order is already ${LABEL[from]}.`, { code: 'ALREADY_IN_STATUS' });
  }
  if (to === 'cancelled' && (from === 'preparing' || from === 'ready')) {
    throw conflict(
      'Cannot cancel an order that is already Preparing; void individual lines instead.',
      { code: 'CANCEL_TOO_LATE' }
    );
  }
  if (isTerminal(from)) {
    throw conflict(`This order is ${LABEL[from]} and can no longer change.`, {
      code: 'ORDER_CLOSED',
    });
  }
  throw conflict(
    `An order that is ${LABEL[from]} cannot move to ${LABEL[to]}; it can only move to ` +
      `${nextStatuses(from).map((s) => LABEL[s]).join(' or ')}.`,
    { code: 'ILLEGAL_TRANSITION' }
  );
}
