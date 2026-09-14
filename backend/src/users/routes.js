// GET /users and POST /users.
//
// There is no self-registration route and there will not be one (docs/api.md): an open sign-up
// carrying a role picker would let anyone mint a manager, which defeats §1 entirely. Accounts
// come from a manager calling POST /users, or from the seed.

import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { hashPassword } from '../auth/password.js';
import { query } from '../db.js';
import { conflict } from '../http/errors.js';
import { parseBody, parseQuery } from '../http/validate.js';
import { toUser, userColumns } from './serialize.js';

const ROLES = ['manager', 'waiter'];

// strict here too, so `?Role=waiter` is a 422 rather than a silently unfiltered list. A filter
// that is quietly ignored is worse than one that is refused: the caller gets a plausible
// answer to a question they did not ask.
const listQuerySchema = z.strictObject({
  role: z.enum(ROLES, 'Role must be manager or waiter').optional(),
});

const createUserSchema = z.strictObject({
  // Lowercased on the way in, which is the one place it belongs: normalise at the point of
  // storage so every row looks the same, and let CITEXT handle comparison at the point of
  // lookup. That is why POST /auth/login does NOT lowercase — it does not need to, and a
  // second copy of the rule could only drift from this one.
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email('Must be a valid email address').max(320)),

  // Length only, no composition rules. A minimum length is what actually costs an attacker
  // work; requiring one of each character class mostly produces Password@1 and rules out
  // longer passphrases. 200 is an upper bound for sanity — bcrypt itself stops reading at 72
  // bytes, so anything past that is neither more nor less secure.
  password: z.string().min(8, 'Password must be at least 8 characters').max(200),

  displayName: z.string().trim().min(1, 'Display name is required').max(120),

  // Set at creation and never in the token-bearing client's gift to choose for itself: this is
  // a manager naming someone else's role, which is exactly the case the rule allows.
  role: z.enum(ROLES, 'Role must be manager or waiter'),

  // Optional. Absent, null and blank all mean the same thing and all store NULL.
  phone: z.string().trim().max(30).nullish().transform((v) => v || null),
});

export function userRoutes() {
  const router = Router();

  // Both roles may list users — §5 needs a waiter picker to add a collaborator — but a waiter
  // sees three columns and a manager sees the record. See serialize.js.
  router.get('/', requireAuth, async (req, res) => {
    const { role } = parseQuery(listQuerySchema, req.query);

    const { rows } = await query(
      `SELECT ${userColumns(req.user.role)}
         FROM users
        WHERE ($1::user_role IS NULL OR role = $1)
        ORDER BY display_name`,
      [role ?? null]
    );

    res.json({ users: rows.map(toUser) });
  });

  router.post('/', requireAuth, requireRole('manager'), async (req, res) => {
    const { email, password, displayName, role, phone } = parseBody(createUserSchema, req.body);

    // Hash before the INSERT, not inside a retry: bcrypt is the slow part (~65 ms) and doing it
    // once keeps the transaction the database sees as short as possible.
    const passwordHash = await hashPassword(password);

    try {
      const { rows } = await query(
        `INSERT INTO users (email, password_hash, display_name, role, phone)
              VALUES ($1, $2, $3, $4, $5)
           RETURNING ${userColumns('manager')}`,
        [email, passwordHash, displayName, role, phone]
      );
      res.status(201).json({ user: toUser(rows[0]) });
    } catch (err) {
      // Let the unique index answer "is this email taken?" rather than asking first. A
      // SELECT-then-INSERT would be wrong under concurrency — two managers adding the same
      // address at the same moment both see it free — and the index is case-insensitive
      // because email is CITEXT, so Manager@Demo.Test collides with manager@demo.test here
      // just as it does at login.
      //
      // 409 and not 422: the payload is well formed, the world disagrees with it.
      if (err.code === '23505' && err.constraint === 'users_email_key') {
        throw conflict('That email address is already registered', { code: 'EMAIL_TAKEN' });
      }
      throw err;
    }
  });

  return router;
}
