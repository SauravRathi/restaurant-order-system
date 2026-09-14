// Payload validation. One helper so every route rejects a bad body the same way, before any
// business logic runs — which is the whole reason the 422/409 split is meaningful: 422 means
// we never got as far as looking at the order.

import { z } from 'zod';
import { notFound, unprocessable } from './errors.js';

// BIGSERIAL ids: at least one digit, no leading zero, and short enough that the value cannot
// overflow int8. Without this guard `/menu-items/abc` reaches Postgres and comes back as
// error 22P02 — an unhandled 500 for what is really just a bad URL.
const ID_PATTERN = /^[1-9][0-9]{0,17}$/;

/**
 * Validate an id taken from the path. Returns it unchanged — as a string, which is what pg
 * gives us for BIGINT and what it expects back.
 *
 * A malformed id is a 404 rather than a 422: the id is part of the path, so `/menu-items/abc`
 * names a resource that cannot exist, which is the same answer as `/menu-items/999999`. It
 * also keeps the 404 story from docs/api.md intact — every unreachable object looks alike,
 * whether it is absent, malformed, or simply not yours.
 */
export function parseId(raw, what = 'Resource') {
  if (typeof raw !== 'string' || !ID_PATTERN.test(raw)) {
    throw notFound(`${what} not found`, { code: 'NOT_FOUND' });
  }
  return raw;
}

/**
 * The same id rule as a zod schema, for ids that arrive inside a body rather than in the path.
 *
 * A number is accepted as well as a string because JSON has no bigint and a client holding an
 * id it read from us as `"12"` may well send it back as `12`. Both normalise to the string pg
 * wants. Unlike parseId this yields 422, not 404 — an id list with `"abc"` in it is a
 * malformed payload, and nothing has been touched yet.
 */
export const idSchema = z
  .union([z.string(), z.number()], 'Must be an id')
  .transform((v) => (typeof v === 'number' ? String(v) : v.trim()))
  .refine((v) => ID_PATTERN.test(v), 'Must be a positive whole-number id');

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
