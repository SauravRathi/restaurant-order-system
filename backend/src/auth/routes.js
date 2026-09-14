// POST /auth/login and GET /auth/me.
//
// JSON is camelCase throughout the API while SQL stays snake_case, so the boundary between the
// two is exactly here — in the shape helper below and nowhere else.

import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { unauthorized } from '../http/errors.js';
import { parseBody } from '../http/validate.js';
import { toUser } from '../users/serialize.js';
import { requireAuth } from './middleware.js';
import { verifyPassword } from './password.js';
import { signToken } from './tokens.js';

// strictObject, not object: zod's default is to strip unknown keys silently, and silence is
// the wrong answer to a body carrying `role` or `userId`. The server supplies identity and
// role from the token; a client that tries to send them should be told it is not how this
// works, not quietly ignored.
const loginSchema = z.strictObject({
  // No .toLowerCase() — users.email is CITEXT, so the database compares case-insensitively
  // and normalising here would be a second, divergent copy of that rule. 320 is the maximum
  // length of an email address per RFC 3696 erratum (64 local + @ + 255 domain).
  email: z.string().trim().pipe(z.email('Must be a valid email address').max(320)),

  // Shape only. Login never enforces password policy: that belongs on the route that creates
  // an account, and applying it here would reject a legitimate old password with 422 instead
  // of the 401 it deserves.
  password: z.string().min(1, 'Password is required').max(200),
});

export function authRoutes() {
  const router = Router();

  router.post('/login', async (req, res) => {
    const { email, password } = parseBody(loginSchema, req.body);

    const { rows } = await query(
      `SELECT id, email, display_name, role, password_hash
         FROM users
        WHERE email = $1`,
      [email]
    );
    const user = rows[0];

    // One failure, one message, for both "no such account" and "wrong password". The rest of
    // the defence is in verifyPassword, which spends the same ~65 ms either way — an identical
    // 401 that arrives in 1 ms instead of 65 still answers "does this email exist?".
    if (!(await verifyPassword(password, user?.password_hash))) {
      throw unauthorized('Invalid email or password', { code: 'INVALID_CREDENTIALS' });
    }

    res.json({ token: signToken(user), user: toUser(user) });
  });

  // The end-to-end proof: token in, identity out. It re-reads the row rather than echoing the
  // token's claims, which costs one primary-key lookup and buys two things — the frontend can
  // restore a session on reload from the token alone, and a token whose user has since been
  // removed stops working instead of describing a user that is not there.
  //
  // The column narrowing in users/serialize.js does not apply here: this is the caller's own
  // record, so a waiter seeing their own email and phone number is the point, not a leak.
  router.get('/me', requireAuth, async (req, res) => {
    const { rows } = await query(
      `SELECT id, email, display_name, role, phone, created_at FROM users WHERE id = $1`,
      [req.user.id]
    );
    if (!rows[0]) throw unauthorized('Account no longer exists', { code: 'USER_GONE' });

    res.json({ user: toUser(rows[0]) });
  });

  return router;
}
