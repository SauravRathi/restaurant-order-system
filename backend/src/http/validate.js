// Payload validation. One helper so every route rejects a bad body the same way, before any
// business logic runs — which is the whole reason the 422/409 split is meaningful: 422 means
// we never got as far as looking at the order.

import { unprocessable } from './errors.js';

/**
 * Parse `body` against a zod schema, or throw a 422 listing every problem at once.
 *
 * safeParse, not parse: a thrown ZodError would reach errorHandler as an unknown error and
 * become a 500. Returning the issues instead lets the client fix all of them in one round trip
 * rather than discovering them one at a time.
 */
export function parseBody(schema, body) {
  return parse(schema, body, 'Invalid payload', '(body)');
}

/**
 * The same, for query strings.
 *
 * Separate from parseBody only so the message names the right thing — a client told "invalid
 * payload" when the problem is `?role=chef` will go looking in the wrong place. Query values
 * arrive as strings, or as arrays when a parameter is repeated, so schemas here must expect
 * that rather than assuming a scalar.
 */
export function parseQuery(schema, query) {
  return parse(schema, query, 'Invalid query parameters', '(query)');
}

function parse(schema, value, message, anonymousField) {
  const result = schema.safeParse(value ?? {});
  if (result.success) return result.data;

  throw unprocessable(message, {
    code: 'VALIDATION_FAILED',
    details: result.error.issues.map((issue) => ({
      // path is [] for a problem with the object itself, e.g. an unrecognised key.
      field: issue.path.join('.') || anonymousField,
      message: issue.message,
    })),
  });
}
