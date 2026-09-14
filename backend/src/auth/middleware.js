// Turning a token into an identity, and an identity into a capability check.
//
// This is where "the client sends intent, the server supplies context" is enforced. After
// requireAuth runs, `req.user` is the only identity in the request, and it came from a signed
// token. Nothing downstream may take an actor id from req.body — that is what makes the
// timeline's actor_id trustworthy (§9): the append-only trigger stops history being edited,
// and this stops it being forged in the first place.

import { forbidden, unauthorized } from '../http/errors.js';
import { verifyToken } from './tokens.js';

/**
 * Require a valid bearer token. Sets `req.user = { id, role, name }`.
 *
 * Every failure is a plain 401 with the same shape. The message differs (expired vs invalid)
 * because that difference is useful to an honest client deciding whether to re-login and
 * reveals nothing — it is a fact about the token the caller already holds, not about any
 * account.
 */
export function requireAuth(req, _res, next) {
  const header = req.get('authorization') ?? '';
  const [scheme, token] = header.split(' ');

  if (!token || scheme?.toLowerCase() !== 'bearer') {
    throw unauthorized('Authentication required', { code: 'NO_TOKEN' });
  }

  let claims;
  try {
    claims = verifyToken(token);
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw unauthorized('Session expired, please sign in again', { code: 'TOKEN_EXPIRED' });
    }
    throw unauthorized('Invalid token', { code: 'BAD_TOKEN' });
  }

  // Frozen so a later middleware cannot quietly reassign the actor mid-request. It does not
  // stop anyone reading req.body.userId — nothing can, except not writing that line — but it
  // does mean the identity a route sees is the identity requireAuth set.
  req.user = Object.freeze({ id: claims.sub, role: claims.role, name: claims.name });
  next();
}

/**
 * Require one of `roles`. Capability check only — 403, never 404, because the caller already
 * knows the route exists and hiding it would only confuse an honest waiter.
 *
 * Object-level access (is this order yours?) is a different question with a different answer,
 * and lives in auth/visibility.js.
 */
export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) throw unauthorized('Authentication required', { code: 'NO_TOKEN' });
    if (!roles.includes(req.user.role)) {
      throw forbidden(`This action is restricted to: ${roles.join(', ')}`, {
        code: 'ROLE_REQUIRED',
      });
    }
    next();
  };
}
