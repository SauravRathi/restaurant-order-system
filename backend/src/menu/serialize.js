// The menu item row, as the API shows it.
//
// Unlike users, there is no per-role narrowing here: a menu item has no private fields, so
// both roles get the same shape. What differs between roles is which ROWS they can see, not
// which columns — see the archived filter in routes.js.

export const MENU_COLUMNS =
  'id, name, category, price, is_available, archived_at, created_at, updated_at';

/**
 * `price` stays a string all the way to the client, on purpose.
 *
 * The column is NUMERIC(10,2) and src/db.js pins NUMERIC to a string precisely so money never
 * passes through a float. Turning it into a JS number here would undo that in the last three
 * feet — 0.1 + 0.2 arithmetic on a bill, and a CSV export (§7) that disagrees with the screen.
 * The frontend formats it; it does not do arithmetic on it.
 */
export function toMenuItem(row) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    price: row.price,
    isAvailable: row.is_available,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
