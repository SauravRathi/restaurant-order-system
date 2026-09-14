// The §10 slow-order rule, written once for the API.
//
// An order is alerting when all four hold:
//
//   it never reached Ready          status IN ('placed','accepted','preparing')
//   it is still on the board        archived_at IS NULL
//   it has been open too long       now() - placed_at > SLOW_ORDER_MINUTES
//   nobody has recently said so     alert_acked_at IS NULL
//                                     OR now() - alert_acked_at > ALERT_REPEAT_MINUTES
//
// The last clause is what makes acknowledging mean "I know, give me ten minutes" rather than
// "never tell me again" — an order that is still not Ready comes back.
//
// scripts/verify.mjs holds its own copy of this SQL on purpose and must not import this file.
// Its job is to assert that the database still behaves the way docs/schema.md claims; a check
// that imported the implementation it is checking would pass by construction.

/** Thresholds, read at call time so a redeploy with new values needs no code change. */
export const alertThresholds = () => ({
  slowOrderMinutes: Number(process.env.SLOW_ORDER_MINUTES ?? 20),
  repeatMinutes: Number(process.env.ALERT_REPEAT_MINUTES ?? 10),
});

/**
 * The predicate as a SQL fragment.
 *
 * The two thresholds are passed in as placeholder names rather than baked in, so a caller can
 * put them wherever its own parameter numbering has room — which matters because the visibility
 * contract in auth/visibility.js has already claimed $1 and $2.
 *
 * make_interval(mins => ...) rather than string concatenation into an interval literal: the
 * value stays a bound parameter, so the planner sees it as data and nothing has to be escaped.
 */
export function alertPredicateSql({ alias = 'o', slowParam, repeatParam }) {
  return `(
        ${alias}.archived_at IS NULL
    AND ${alias}.status IN ('placed', 'accepted', 'preparing')
    AND ${alias}.placed_at < now() - make_interval(mins => ${slowParam})
    AND (${alias}.alert_acked_at IS NULL
         OR ${alias}.alert_acked_at < now() - make_interval(mins => ${repeatParam}))
  )`;
}
