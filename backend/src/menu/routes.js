// Menu routes. Browsing is open to both roles; every write is manager-only (§1).
//
// Nothing here is ever hard-deleted. Archiving is a timestamp, because old order lines still
// point at the item and a deleted row would take a served order's history with it.

import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { query } from '../db.js';
import { conflict, notFound } from '../http/errors.js';
import { parseBody, parseId, parseQuery } from '../http/validate.js';
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
