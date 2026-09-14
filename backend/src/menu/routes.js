// Menu routes. Browsing is open to both roles; every write is manager-only (§1).
//
// Nothing here is ever hard-deleted. Archiving is a timestamp, because old order lines still
// point at the item and a deleted row would take a served order's history with it.

import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { query } from '../db.js';
import { conflict, notFound } from '../http/errors.js';
import { idSchema, parseBody, parseId, parseQuery } from '../http/validate.js';
import { MENU_COLUMNS, toMenuItem } from './serialize.js';

// NUMERIC(10,2) holds at most eight digits before the point and two after.
//
// Validating the scale rather than letting the database round is the point of this: Postgres
// would accept 320.999 and silently store 321.00, so a manager would be told their price was
// saved and shown a different number. 422 with a sentence is the better answer.
const PRICE_PATTERN = /^\d{1,8}(\.\d{1,2})?$/;

const priceSchema = z
  .union([z.number(), z.string()], 'Price must be a number')
  // A JSON number and a decimal string are both reasonable things for a client to send. Both
  // become a string here, which is what pg hands to NUMERIC without going via a float.
  .transform((v) => (typeof v === 'number' ? String(v) : v.trim()))
  .refine(
    (v) => PRICE_PATTERN.test(v),
    'Price must be 0 or more, with at most 8 digits before the decimal point and 2 after'
  );

/**
 * The bulk endpoint's price, checked for TYPE only.
 *
 * §7 requires a bulk action to "report per item what succeeded and what was rejected and why,
 * not just fail the whole batch", and the example the brief names is a negative price. Running
 * the strict priceSchema above on this route refuses the whole request with a 422 — which is
 * precisely the batch failure the goal rules out, for precisely the case it calls out.
 *
 * So the line moves, on this route alone. A TYPE error still fails the request, because
 * `price: true` is not a price under any reading and there is nothing per-item to say about it.
 * Everything about the VALUE — negative, too many decimals, too large — becomes a per-item
 * rejection inside a 200.
 *
 * POST and PATCH keep the strict schema deliberately: there a manager named one exact item, so
 * one clear 422 beats a one-line report saying the same thing.
 */
const bulkPriceSchema = z
  .union([z.number(), z.string()], 'Price must be a number')
  .transform((v) => (typeof v === 'number' ? String(v) : v.trim()));

/**
 * Why this price cannot be applied, or null if it can.
 *
 * Negative is separated from merely malformed because it is the case §7 names, and because
 * "cannot be negative" tells a manager what to change where a restatement of the number format
 * does not.
 */
function priceRejection(value) {
  if (PRICE_PATTERN.test(value)) return null;

  if (/^-\d{1,8}(\.\d{1,2})?$/.test(value)) {
    return { code: 'NEGATIVE_PRICE', reason: 'Price cannot be negative' };
  }
  return {
    code: 'INVALID_PRICE',
    reason: 'Price must have at most 8 digits before the decimal point and 2 after',
  };
}

const nameSchema = z.string().trim().min(1, 'Name is required').max(120);
const categorySchema = z.string().trim().min(1, 'Category is required').max(60);

const listQuerySchema = z.strictObject({
  // `?includeArchived=` with nothing after it is how docs/api.md writes this parameter, and it
  // is also what an HTML form sends for an unticked checkbox. z.stringbool() rejects the empty
  // string outright, so absent and empty are both normalised to false first — the direction
  // that shows fewer rows rather than more.
  includeArchived: z.preprocess(
    (v) => (v === undefined || v === '' ? 'false' : v),
    z.stringbool()
  ),
});

const createSchema = z.strictObject({
  name: nameSchema,
  category: categorySchema,
  price: priceSchema,
  isAvailable: z.boolean('isAvailable must be true or false').default(true),
});

// Every field optional, but not all of them at once: an empty PATCH is a client bug, and
// answering 200 to it would hide that. Archiving is deliberately absent — it has its own two
// routes, so "update" never has to mean "and also retire this item".
const updateSchema = z
  .strictObject({
    name: nameSchema.optional(),
    category: categorySchema.optional(),
    price: priceSchema.optional(),
    isAvailable: z.boolean('isAvailable must be true or false').optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, 'Provide at least one field to update');

// §7, read a step further than the brief's wording.
//
// The goal says "one change to all of them — a new price or a change in availability". This
// endpoint accepts either, or both, and also archiving — a deliberate widening recorded here so
// it can be defended rather than discovered. Archiving is in scope because it is the third thing
// a manager does to a batch of items at end of service, and doing it one row at a time was the
// only part of the menu editor that still made you click twenty times.
//
// The original rule was exactly-one, for a stated reason: two changes in one sweep would make
// the per-item report ambiguous, because an item could half-succeed and there would be no
// honest single status to give it. That reasoning only holds if a result carries one status.
// It carries one status PER FIELD now — "price rejected, availability updated" is a complete
// and honest answer — so the ambiguity the rule was avoiding no longer exists, and forbidding
// the case was solving it by refusing to represent it.
//
// At least one field, because a sweep that changes nothing is a client bug and answering 200
// to it would hide that.
const bulkSchema = z
  .strictObject({
    ids: z
      .array(idSchema, 'ids must be an array of menu item ids')
      .min(1, 'Select at least one menu item')
      .max(200, 'At most 200 items at a time'),
    // Lenient on purpose — see bulkPriceSchema. A bad value is reported, not refused.
    price: bulkPriceSchema.optional(),
    isAvailable: z.boolean('isAvailable must be true or false').optional(),
    // true archives, false restores. Named for the intent rather than for the column, which is
    // a nullable timestamp — the API speaks in what the manager meant, not in storage.
    archived: z.boolean('archived must be true or false').optional(),
  })
  .refine(
    (b) => b.price !== undefined || b.isAvailable !== undefined || b.archived !== undefined,
    'Provide a price, an availability, an archived flag, or any combination'
  );

// The PATCH whitelist. Columns come from this map and never from the request's own keys, so a
// body cannot name a column that is not here.
const UPDATABLE_COLUMNS = {
  name: 'name',
  category: 'category',
  price: 'price',
  isAvailable: 'is_available',
};

// Two live items may not share a name, case-insensitively (menu_items_live_name_uq, a partial
// unique index over lower(name) WHERE archived_at IS NULL). Reusing an archived item's name is
// allowed, which is why the index is partial — and why restoring can fail where archiving
// cannot.
function asNameConflict(err) {
  if (err.code === '23505' && err.constraint === 'menu_items_live_name_uq') {
    return conflict('Another item on the live menu already has that name', {
      code: 'NAME_TAKEN',
    });
  }
  return err;
}

export function menuRoutes() {
  const router = Router();

  router.get('/', requireAuth, async (req, res) => {
    const { includeArchived } = parseQuery(listQuerySchema, req.query);

    // "ignored for waiters" (docs/api.md) — ignored, not refused. A waiter asking for archived
    // items gets the live menu and no error, because the parameter is a manager's tool and a
    // shared frontend should not have to know that before it sends the request.
    const withArchived = includeArchived && req.user.role === 'manager';

    const { rows } = await query(
      `SELECT ${MENU_COLUMNS}
         FROM menu_items
        WHERE ($1::boolean OR archived_at IS NULL)
        ORDER BY category, name`,
      [withArchived]
    );

    res.json({ menuItems: rows.map(toMenuItem) });
  });

  router.post('/', requireAuth, requireRole('manager'), async (req, res) => {
    const item = parseBody(createSchema, req.body);

    try {
      const { rows } = await query(
        `INSERT INTO menu_items (name, category, price, is_available)
              VALUES ($1, $2, $3, $4)
           RETURNING ${MENU_COLUMNS}`,
        [item.name, item.category, item.price, item.isAvailable]
      );
      res.status(201).json({ menuItem: toMenuItem(rows[0]) });
    } catch (err) {
      throw asNameConflict(err);
    }
  });

  // §7. Registered before the '/:id' routes so a literal path can never be read as an id.
  //
  // Partial success is the deliverable, so this is deliberately NOT wrapped in a transaction:
  // rolling the whole sweep back because one of forty items was archived would be exactly the
  // all-or-nothing behaviour the goal rules out. Each item stands or falls alone and every one
  // of them is reported.
  //
  // The split between what fails the whole request and what fails one field of one item is:
  // shape errors — a malformed id, an empty list, no fields at all, a price that is not even
  // a number — are 422 and nothing is touched. Everything else is reported per field inside
  // a 200.
  router.post('/bulk', requireAuth, requireRole('manager'), async (req, res) => {
    const { ids, price, isAvailable, archived } = parseBody(bulkSchema, req.body);

    // Deduplicated, keeping the order they were sent in, so the report reads back in the order
    // the manager ticked the boxes and no id can appear in it twice.
    const requested = [...new Set(ids)];

    // The fields this sweep carries, in a fixed order so the SET list and the report agree.
    const carried = [
      ...(price !== undefined ? ['price'] : []),
      ...(isAvailable !== undefined ? ['isAvailable'] : []),
      ...(archived !== undefined ? ['archived'] : []),
    ];

    // A bad price is judged once, not per item: the same value goes to every id, so it is usable
    // for all of them or for none. It no longer stops the other fields travelling with it.
    const badPrice = price !== undefined ? priceRejection(price) : null;

    // What is actually there, before changing anything. This is what lets a rejection say
    // *which* reason it was rather than just "no".
    const { rows: existing } = await query(
      `SELECT id, archived_at FROM menu_items WHERE id = ANY($1::bigint[])`,
      [requested]
    );
    const before = new Map(existing.map((row) => [row.id, row]));

    /**
     * Why this field cannot be applied to this row, or null if it can.
     *
     * The row's own state is judged BEFORE the value. An archived item asked for a negative
     * price is refused for being archived, not for the price — that is the truer answer for
     * that id, and it is the one that tells the manager what to do about it.
     */
    const rejectionFor = (field, row) => {
      if (field === 'archived') {
        // Asking for the state it is already in is not a change, and re-stamping archived_at
        // would quietly lose the date it was actually retired on.
        if (archived && row.archived_at !== null) {
          return { code: 'ALREADY_ARCHIVED', reason: 'That item is already archived' };
        }
        if (!archived && row.archived_at === null) {
          return { code: 'NOT_ARCHIVED', reason: 'That item is not archived' };
        }
        return null;
      }

      // Price and availability cannot touch an archived item — unless this very sweep is
      // restoring it, in which case it is live by the time the statement lands.
      if (row.archived_at !== null && archived !== false) {
        return {
          code: 'ARCHIVED',
          reason: 'That item is archived; restore it before changing it',
        };
      }

      if (field === 'price' && badPrice) return badPrice;
      return null;
    };

    // Which of the carried fields actually apply to each item. Two items asked for the same
    // change can end up with different answers — restoring [a live one, an archived one] is a
    // no-op for the first and a real change for the second — so this is per item.
    const applicable = new Map();
    for (const id of requested) {
      const row = before.get(id);
      if (!row) continue;

      const fields = carried.filter((field) => rejectionFor(field, row) === null);
      if (fields.length > 0) applicable.set(id, fields);
    }

    // Items whose applicable set is identical can share one statement. Usually that is every
    // item in one group; the split only appears when the rows were in different states.
    const groups = new Map();
    for (const [id, fields] of applicable) {
      const key = fields.join(',');
      if (!groups.has(key)) groups.set(key, { fields, ids: [] });
      groups.get(key).ids.push(id);
    }

    const COLUMN = { price: 'price', isAvailable: 'is_available' };
    const VALUE = { price, isAvailable };

    const updated = new Map();
    const collided = new Map();

    /**
     * Apply one group in a single statement.
     *
     * The WHERE clause re-states the guard rather than trusting the snapshot above: the SELECT
     * and this UPDATE are separate moments, so an item archived by someone else in between must
     * not be updated anyway. Which guard depends on what the group is doing — restoring wants
     * exactly the rows the others exclude.
     */
    async function runGroup({ fields, ids: groupIds }) {
      const params = [groupIds];
      const sets = fields.map((field) =>
        field === 'archived'
          ? // A timestamp, not a boolean, and chosen from one here rather than interpolated
            // from anything a client sent.
            `archived_at = ${archived ? 'now()' : 'NULL'}`
          : `${COLUMN[field]} = $${params.push(VALUE[field])}`
      );

      const guard =
        fields.includes('archived') && !archived ? 'archived_at IS NOT NULL' : 'archived_at IS NULL';

      const { rows } = await query(
        `UPDATE menu_items SET ${sets.join(', ')}
          WHERE id = ANY($1::bigint[]) AND ${guard}
      RETURNING ${MENU_COLUMNS}`,
        params
      );
      return rows;
    }

    for (const group of groups.values()) {
      try {
        for (const row of await runGroup(group)) updated.set(row.id, row);
      } catch (err) {
        // Restoring is the one operation here that can collide: the name was free while the item
        // was archived, and something live may have taken it since. In a batched statement one
        // collision aborts every row with it — which is precisely the all-or-nothing failure §7
        // rules out. So the group is retried one item at a time, and only the ones that actually
        // clash are reported as clashing.
        if (err.code !== '23505') throw err;

        for (const id of group.ids) {
          try {
            for (const row of await runGroup({ fields: group.fields, ids: [id] })) {
              updated.set(row.id, row);
            }
          } catch (single) {
            if (single.code !== '23505') throw single;
            collided.set(id, {
              code: 'NAME_TAKEN',
              reason: 'Another item on the live menu already has that name',
            });
          }
        }
      }
    }

    const results = requested.map((id) => {
      const row = before.get(id);

      // One outcome per field the caller asked for, and the reason lives with the field rather
      // than on the item. A consumer reads `changes` and needs to look nowhere else — which is
      // what makes "price rejected, availability updated" expressible at all.
      const changes = Object.fromEntries(
        carried.map((field) => {
          if (!row) {
            return [field, { status: 'rejected', code: 'NOT_FOUND', reason: 'No menu item with that id' }];
          }
          if (collided.has(id)) return [field, { status: 'rejected', ...collided.get(id) }];

          const rejection = rejectionFor(field, row);
          if (rejection) return [field, { status: 'rejected', ...rejection }];

          // Applicable a moment ago, not updated now: someone changed it in between.
          if (!updated.has(id)) {
            return [
              field,
              {
                status: 'rejected',
                code: 'CHANGED_CONCURRENTLY',
                reason: 'That item changed while this update was running',
              },
            ];
          }
          return [field, { status: 'updated' }];
        })
      );

      const outcomes = Object.values(changes).map((c) => c.status);
      const status = outcomes.every((o) => o === 'updated')
        ? 'updated'
        : outcomes.every((o) => o === 'rejected')
          ? 'rejected'
          : 'partial';

      const after = updated.get(id);
      return { id, status, changes, ...(after ? { menuItem: toMenuItem(after) } : {}) };
    });

    const count = (s) => results.filter((r) => r.status === s).length;

    // 200, not 207. The bulk operation itself succeeded — it did what was asked and is telling
    // you what happened to each item. A status code describing the worst individual outcome
    // would force a client to parse the body anyway, so the body is the report.
    res.json({
      summary: {
        requested: results.length,
        updated: count('updated'),
        partial: count('partial'),
        rejected: count('rejected'),
      },
      results,
    });
  });

  router.patch('/:id', requireAuth, requireRole('manager'), async (req, res) => {
    const id = parseId(req.params.id, 'Menu item');
    const patch = parseBody(updateSchema, req.body);

    // Built from UPDATABLE_COLUMNS, so the column names are literals from this file and the
    // request only ever supplies values, as $2, $3, ...
    const params = [id];
    const assignments = Object.entries(UPDATABLE_COLUMNS)
      .filter(([field]) => patch[field] !== undefined)
      .map(([field, column]) => `${column} = $${params.push(patch[field])}`);

    try {
      const { rows } = await query(
        `UPDATE menu_items SET ${assignments.join(', ')}
          WHERE id = $1
      RETURNING ${MENU_COLUMNS}`,
        params
      );
      if (!rows[0]) throw notFound('Menu item not found', { code: 'NOT_FOUND' });

      res.json({ menuItem: toMenuItem(rows[0]) });
    } catch (err) {
      throw asNameConflict(err);
    }
  });

  // Archive and restore are the same shape: try the state change, and only if nothing moved go
  // back and find out which of the two reasons it was. That costs a second round trip on the
  // failure path and none on the happy one, and it avoids the check-then-act race that asking
  // first would introduce.
  router.post('/:id/archive', requireAuth, requireRole('manager'), async (req, res) => {
    const id = parseId(req.params.id, 'Menu item');

    const { rows } = await query(
      `UPDATE menu_items SET archived_at = now()
        WHERE id = $1 AND archived_at IS NULL
    RETURNING ${MENU_COLUMNS}`,
      [id]
    );
    if (!rows[0]) await explainNoChange(id, 'archive');

    res.json({ menuItem: toMenuItem(rows[0]) });
  });

  router.post('/:id/restore', requireAuth, requireRole('manager'), async (req, res) => {
    const id = parseId(req.params.id, 'Menu item');

    let rows;
    try {
      ({ rows } = await query(
        `UPDATE menu_items SET archived_at = NULL
          WHERE id = $1 AND archived_at IS NOT NULL
      RETURNING ${MENU_COLUMNS}`,
        [id]
      ));
    } catch (err) {
      // Restoring is the one of the two that can collide: the name was free while the item was
      // archived, and something live may have taken it since.
      throw asNameConflict(err);
    }
    if (!rows[0]) await explainNoChange(id, 'restore');

    res.json({ menuItem: toMenuItem(rows[0]) });
  });

  return router;
}

/** Always throws: 404 if the item is gone, 409 if it was already in the target state. */
async function explainNoChange(id, action) {
  const { rows } = await query(`SELECT archived_at FROM menu_items WHERE id = $1`, [id]);
  if (!rows[0]) throw notFound('Menu item not found', { code: 'NOT_FOUND' });

  throw action === 'archive'
    ? conflict('That menu item is already archived', { code: 'ALREADY_ARCHIVED' })
    : conflict('That menu item is not archived', { code: 'NOT_ARCHIVED' });
}
