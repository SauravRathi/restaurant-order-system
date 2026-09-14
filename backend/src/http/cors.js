// Cross-origin access for the browser frontend.
//
// What this is actually doing: the frontend is served from a different origin than the API, and
// the browser refuses to hand a cross-origin response to JavaScript unless the server says it
// may. So this adds response headers granting that permission. It is not a security control —
// curl, Postman and the API's own test scripts ignore all of it, and a request from a
// disallowed origin still reaches the route and still runs. What the browser withholds is the
// *response*, from the page that asked for it. Authorization is requireAuth's job; this only
// decides which web pages are allowed to read an answer.
//
// Hand-written rather than the `cors` package for the same reason as the CSV writer: it is
// short enough to read in one sitting and every line can be accounted for.

// Vite's dev server, on both spellings of localhost — they are different origins to a browser.
const DEV_DEFAULTS = ['http://localhost:5173', 'http://127.0.0.1:5173'];

// Only what this API actually uses. There are no PUT or DELETE routes: menu items and orders
// are archived, never deleted.
const ALLOWED_METHODS = 'GET, POST, PATCH, OPTIONS';

// The two headers the frontend sends. Listing them rather than echoing whatever the preflight
// asks for keeps the grant to what we meant to grant.
const ALLOWED_HEADERS = 'Authorization, Content-Type';

// GET /orders/export puts the filename in Content-Disposition. Cross-origin JavaScript can
// read only a handful of response headers unless the server names the others here — without
// this the download works but the frontend cannot recover 'orders-2026-09-13.csv'.
const EXPOSED_HEADERS = 'Content-Disposition';

// Ten minutes of preflight caching. Every authenticated call carries an Authorization header,
// which makes it a "non-simple" request, which means the browser sends an OPTIONS first — so
// without this, a dashboard firing four requests pays for four extra round trips to Mumbai.
// Browsers cap this themselves; the value is a request, not a promise.
const MAX_AGE_SECONDS = '600';

/**
 * Origins allowed to read responses, from CORS_ORIGINS as a comma-separated list.
 *
 * Unset in development means Vite; unset in production means nothing at all, so a deployment
 * that forgets the variable fails closed and visibly rather than quietly accepting everyone.
 * CORS_ORIGINS='*' disables the allowlist — usable for a demo whose frontend URL is not known
 * yet, at the cost of any origin being able to read authenticated responses from a token it
 * has somehow obtained.
 */
export function allowedOrigins() {
  const configured = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  if (configured.length > 0) return configured;
  return process.env.NODE_ENV === 'production' ? [] : DEV_DEFAULTS;
}

export function cors() {
  return (req, res, next) => {
    const origin = req.get('origin');

    // No Origin header: a same-origin request, or something that is not a browser. Nothing to
    // grant, and adding the headers anyway would only mislead whoever reads them.
    if (!origin) return next();

    const allowed = allowedOrigins();
    const permitted = allowed.includes('*') || allowed.includes(origin);

    if (permitted) {
      // The specific origin is echoed back rather than '*', so the grant stays a statement
      // about one site and keeps working if anything ever uses credentials.
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Access-Control-Expose-Headers', EXPOSED_HEADERS);
    }

    // Vary regardless of the outcome. The response body is identical for every origin but the
    // headers are not, so any cache between here and the browser must key on Origin — or it
    // will hand one site's permission to another site, or to nobody.
    res.vary('Origin');

    // A preflight: OPTIONS carrying Access-Control-Request-Method. It is answered here and
    // goes no further, which matters because a preflight carries no Authorization header — if
    // it reached requireAuth it would 401, and every write in the app would fail.
    if (req.method === 'OPTIONS' && req.get('access-control-request-method')) {
      if (permitted) {
        res.set('Access-Control-Allow-Methods', ALLOWED_METHODS);
        res.set('Access-Control-Allow-Headers', ALLOWED_HEADERS);
        res.set('Access-Control-Max-Age', MAX_AGE_SECONDS);
      }
      // 204 either way. A disallowed origin is refused by the absence of the grant, not by a
      // status code — the browser is the one enforcing this, and it reads the headers.
      return res.status(204).end();
    }

    next();
  };
}
