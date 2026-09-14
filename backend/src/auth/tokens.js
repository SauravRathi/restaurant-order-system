// Signing and verifying session tokens. The only file in the app that imports jsonwebtoken.
//
// Stateless HS256 (Decision 8): there is no session table, so a token is valid until it
// expires and signing out is a client-side discard. The trade-off accepted with that is that
// a token cannot be revoked early; the mitigation is a short life (JWT_EXPIRES_IN, 12h — one
// shift) rather than a revocation list this project does not need.

import jwt from 'jsonwebtoken';

const ALGORITHM = 'HS256';

// Read lazily, the same way src/db.js reads DATABASE_URL: importing this file must not throw
// just because the environment has not been loaded yet, and a missing secret should print the
// line that fixes it rather than a stack trace out of node_modules.
function secret() {
  const s = process.env.JWT_SECRET;
  if (!s) {
    throw new Error(
      'JWT_SECRET is not set. Generate one with:\n' +
        '  node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"'
    );
  }
  return s;
}

/**
 * Sign a token for a user row.
 *
 * The payload carries only what every request needs: who (`sub`), what they may do (`role`),
 * and a display name so the UI does not need a second round trip to render a header. It
 * deliberately does not carry anything that can go stale in a way that matters — a role change
 * takes effect at the user's next sign-in, and nothing here is trusted for authorization
 * beyond `role`, which requireRole re-reads from the token on every request.
 *
 * `sub` is a string because that is what the JWT spec says and what jsonwebtoken enforces.
 * User ids arrive from pg as strings already (src/db.js pins INT8), so this is a no-op today
 * and a guard if that ever changes.
 */
export function signToken(user) {
  return jwt.sign(
    { role: user.role, name: user.display_name },
    secret(),
    {
      algorithm: ALGORITHM,
      subject: String(user.id),
      expiresIn: process.env.JWT_EXPIRES_IN || '12h',
    }
  );
}

/**
 * Verify and decode a token. Throws jsonwebtoken's own errors — `TokenExpiredError`,
 * `JsonWebTokenError` — which the caller turns into a 401.
 *
 * `algorithms` is pinned on purpose, and it is the single most important line in this file.
 * Without it jsonwebtoken honours whatever the token's own header asks for, so an attacker
 * could hand us a token saying `alg: none` (no signature at all) or swap HS256 for RS256 and
 * get our public material treated as a verification key. Pinning means the header is not a
 * vote: a token signed any other way fails before the payload is read.
 */
export function verifyToken(token) {
  return jwt.verify(token, secret(), { algorithms: [ALGORITHM] });
}
