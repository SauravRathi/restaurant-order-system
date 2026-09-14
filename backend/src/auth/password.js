// Password hashing and verification. The only file in the app that imports bcrypt.
//
// Why bcryptjs and not bcrypt: bcryptjs is pure JavaScript, so `npm install` on Render's free
// tier has no native module to compile against a toolchain that may not be there. The cost is
// speed — it is roughly 3-4x slower than the native binding — which is why the cost factor
// below is 10 and not 12.
//
// The hash format is the portable bcrypt one, so hashes written by pgcrypto's
// crypt(pw, gen_salt('bf', 10)) in seed/001_demo.sql verify here without re-hashing. That is
// what lets the seed stay readable SQL instead of a list of pasted $2a$ strings.

import bcrypt from 'bcryptjs';

// Matches gen_salt('bf', 10) in the seed, so a seeded account and an API-created account are
// the same strength. 2^10 rounds is ~60-100 ms in pure JS on a small instance: slow enough to
// make offline cracking expensive, fast enough that a login is not a visible pause.
const COST = 10;

/** Hash a plaintext password. Returns a $2b$ string; never log or return it. */
export function hashPassword(plain) {
  return bcrypt.hash(plain, COST);
}

// A real hash of a value nobody can supply, computed once at module load. See verifyPassword.
const DUMMY_HASH = bcrypt.hashSync('unmatchable placeholder password', COST);

/**
 * Check a plaintext password against a stored hash.
 *
 * `hash` may be null or undefined — that is the "no such user" case, and it still costs a
 * full bcrypt comparison against DUMMY_HASH before returning false. Without that, an unknown
 * email would answer in under a millisecond while a wrong password took ~80 ms, and the
 * response time would enumerate accounts even though both return an identical 401.
 */
export async function verifyPassword(plain, hash) {
  if (!hash) {
    await bcrypt.compare(plain, DUMMY_HASH);
    return false;
  }
  return bcrypt.compare(plain, hash);
}
