// The six statuses, in lifecycle order.
//
// This is a copy of ORDER_STATUSES from backend/src/orders/lifecycle.js, and it is worth being
// clear about what it is not: it is the *set* of statuses, not the transition matrix. Which
// status may follow which is never written down here — that arrives on every order as
// `allowedNextStatuses`, derived by the server, which is the whole reason the API sends it.
//
// The set is needed because the filter chips have to list all six, including ones no current
// order is in, and no endpoint serves it. A list that only reflected the statuses present in
// today's results would quietly lose "Cancelled" on a good day.

export const ORDER_STATUSES = [
  'placed',
  'accepted',
  'preparing',
  'ready',
  'served',
  'cancelled',
];
