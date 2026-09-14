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
  const result = schema.safeParse(body ?? {});
  if (result.success) return result.data;

  throw unprocessable('Invalid payload', {
    code: 'VALIDATION_FAILED',
    details: result.error.issues.map((issue) => ({
      // path is [] for a problem with the object itself, e.g. an unrecognised key.
      field: issue.path.join('.') || '(body)',
      message: issue.message,
    })),
  });
}
