// The one place the order visibility rule is written down.
//
// docs/api.md states it as:
//
//   canAccessOrder(user, order) =
//        user.role === 'manager'
//     || order.primary_waiter_id === user.id
//     || exists(order_collaborators WHERE order_id = order.id AND user_id = user.id)
//
// and states that visibility and actionability are identical — a waiter cannot *see* an order
// they are not part of. That makes this a filter on the SELECT, not a check after the fact,
// and it is why it lives as SQL rather than as a JavaScript predicate. A JS version would mean
// fetching rows the caller may not see in order to decide they may not see them, and the rule
// would then exist in two places that could drift. If some future code path needs the answer
// in JS, it should ask the database using this fragment, not re-implement it.
//
// The same expression serves both failure codes settled in api.md: a list endpoint ANDs it
// into the WHERE clause, and a single-order endpoint ANDs it too, so an order that exists but
// is not yours returns no row and becomes a 404 — never a 403, which would confirm that the
// id exists and let a waiter enumerate the restaurant by walking /orders/1, /orders/2.

/**
 * PARAMETER CONTRACT: the visible-user parameters are always $1 (user id) and $2 (role), and
 * a query's own parameters therefore start at $3.
 *
 * Fixing the positions is the deliberate trade. The alternative — a helper that threads "the
 * next free index" through every query — turns each call site into index arithmetic, and an
 * off-by-one there is a silent authorization bug rather than a syntax error. A fixed prefix is
 * checkable by eye. Build the array with scopedParams() and the contract holds itself up.
 *
 * @param {string} alias  how the orders table is aliased in the enclosing query.
 */
export function orderVisibilitySql(alias = 'o') {
  return `(
       $2 = 'manager'
    OR ${alias}.primary_waiter_id = $1
    OR EXISTS (
         SELECT 1
           FROM order_collaborators vis_oc
          WHERE vis_oc.order_id = ${alias}.id
            AND vis_oc.user_id  = $1
       )
  )`;
}

/**
 * Build the parameter array for a query that uses orderVisibilitySql(), putting the two
 * visibility parameters in the positions the fragment expects.
 *
 *   const { rows } = await query(
 *     `SELECT o.* FROM orders o
 *       WHERE ${orderVisibilitySql()} AND o.status = $3`,
 *     scopedParams(req.user, 'placed')
 *   );
 */
export const scopedParams = (user, ...rest) => [user.id, user.role, ...rest];
