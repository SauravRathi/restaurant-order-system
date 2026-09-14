// Where the token lives.
//
// The API issues a bearer token in a JSON body and reads it back from `Authorization`. It sets
// no cookies anywhere, so the httpOnly-cookie option is not on the table without changing the
// backend: a cross-origin cookie would need SameSite=None and Secure, `credentials: 'include'`
// on every request, and an `Access-Control-Allow-Credentials` the hand-written CORS does not
// send. That is a backend change bought for a frontend convenience.
//
// So: memory, sessionStorage, or localStorage.
//
//   memory          lost on every reload, which would make GET /auth/me pointless — that route
//                   exists precisely so a session can be restored from the token alone.
//   sessionStorage  survives reload, dies per tab. A second tab means logging in again.
//   localStorage    survives both.
//
// localStorage, because the token lasts 12 h and neither F5 nor a second tab should cost a
// login. The honest cost: an XSS can read it. But an XSS can also just issue requests from the
// page as the signed-in user no matter where the token is held, so what actually limits the
// damage is the 12 h expiry, not the storage choice. There is no revocation — signing out is
// discarding this value, which is what `docs/api.md` says it is.

const KEY = 'busy.token';

// Every access is guarded. Storage throws outright in a Safari private window and in a browser
// set to block site data, and a login screen that white-screens instead of working is a worse
// failure than one that forgets you on reload.
const read = () => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};

// The in-memory copy is the source of truth for the running tab; localStorage is the copy that
// survives a reload. That way a browser which refuses to persist still gives a working session
// until the tab closes.
let current = read();

const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn(current));

export const getToken = () => current;

export function setToken(token) {
  current = token;
  try {
    if (token === null) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, token);
  } catch {
    // Ignored on purpose — see above. The session still works, it just will not outlive the tab.
  }
  notify();
}

export const clearToken = () => setToken(null);

/**
 * Watch the token. Returns an unsubscribe function.
 *
 * This exists so a 401 from *any* request — including one fired by a background poll while the
 * user is reading a different page — can drop the session and have the UI notice, without the
 * client needing a reference to React state.
 */
export function subscribeToToken(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
