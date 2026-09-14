// One way to fail. Every route throws ApiError; errorHandler is the only place that decides
// what the client sees.
//
// The codes and the rule behind them are settled in docs/api.md:
//
//   401  no token, bad token, expired token
//   403  your ROLE lacks this capability      — leaks nothing, you already know the route exists
//   404  this OBJECT is not yours (or absent) — order ids are sequential, so 403 here would
//                                               confirm which ids exist and let a waiter
//                                               enumerate the restaurant's orders
//   409  state rule violated
//   422  we parsed your payload and the values are wrong
//
// 400 is the one case api.md does not list, added here for the gap it leaves: a body that is
// not valid JSON at all. 422 says "understood, unacceptable", which presumes we understood it.

export class ApiError extends Error {
  constructor(status, message, { code, details } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message, opts) => new ApiError(400, message, opts);
export const unauthorized = (message = 'Authentication required', opts) =>
  new ApiError(401, message, opts);
export const forbidden = (message = 'Your role does not permit this', opts) =>
  new ApiError(403, message, opts);
export const notFound = (message = 'Not found', opts) => new ApiError(404, message, opts);
export const conflict = (message, opts) => new ApiError(409, message, opts);
export const unprocessable = (message = 'Invalid payload', opts) =>
  new ApiError(422, message, opts);

/**
 * Express 5 error middleware. Must keep all four parameters — Express identifies error
 * handlers by arity, and a three-parameter version is silently registered as an ordinary
 * middleware that never runs.
 */
export function errorHandler(err, _req, res, _next) {
  // express.json() rejects unparseable bodies with its own SyntaxError carrying a status.
  // Catching it here keeps the HTML stack-trace page Express would otherwise render out of a
  // JSON API.
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Request body is not valid JSON', code: 'MALFORMED_JSON' });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body is too large', code: 'BODY_TOO_LARGE' });
  }

  if (err instanceof ApiError) {
    return res.status(err.status).json({
      error: err.message,
      ...(err.code ? { code: err.code } : {}),
      ...(err.details ? { details: err.details } : {}),
    });
  }

  // Anything reaching here is a bug or a database failure, so the message is ours and not the
  // error's: pg puts host, port and role into some of them, and this API is public.
  console.error('[error]', err);
  res.status(500).json({ error: 'Internal server error' });
}
