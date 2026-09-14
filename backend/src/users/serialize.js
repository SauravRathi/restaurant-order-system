// The user row, as the API shows it. SQL is snake_case, JSON is camelCase, and this is the
// only place the two meet.

/**
 * Which columns a caller of `role` is allowed to read.
 *
 * docs/api.md narrows the field list rather than the row list: everyone may list users —
 * §5 needs a waiter picker — but only a manager sees the full record.
 *
 * The narrowing is done here, in the SELECT, and not by deleting keys after the fact. A
 * waiter's request therefore never pulls a colleague's email or phone number out of the
 * database at all, so a later logging line or an accidental `res.json(row)` cannot leak what
 * was never fetched.
 *
 * Interpolating this into SQL is safe because the return value is one of two literals chosen
 * by role — no caller input reaches it. It is the one place in the codebase that builds SQL
 * by concatenation, which is why it says so.
 */
export const userColumns = (role) =>
  role === 'manager'
    ? 'id, email, display_name, role, phone, created_at'
    : 'id, display_name, role';

/**
 * Rename a row to the API's shape. Keys absent from the row stay absent from the response, so
 * this one function serves both column sets above without needing to know which it was given.
 *
 * `phone` is deliberately tested against undefined and not falsiness: it is nullable in the
 * schema, and a manager looking at a colleague with no phone number should see `"phone": null`
 * — the field exists and is empty — rather than a response that silently omits it.
 */
export function toUser(row) {
  return {
    id: row.id,
    ...(row.email !== undefined ? { email: row.email } : {}),
    displayName: row.display_name,
    role: row.role,
    ...(row.phone !== undefined ? { phone: row.phone } : {}),
    ...(row.created_at !== undefined ? { createdAt: row.created_at } : {}),
  };
}
