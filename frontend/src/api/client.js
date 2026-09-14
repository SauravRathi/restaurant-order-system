// The one place that knows how to talk to the API.
//
// Deliberately NOT a Vite dev proxy. A proxy would make every request same-origin in
// development, which means CORS is never exercised until the day it is deployed — and the
// backend's CORS is hand-written and fails closed when CORS_ORIGINS is unset in production.
// Talking cross-origin to http://localhost:4000 in development runs exactly the code path
// production will run, preflight included, so a CORS mistake surfaces here and not there.

import { clearToken, getToken } from './token.js';

// Set VITE_API_URL at build time for the deployed frontend. The default is the dev API, which
// backend/src/http/cors.js already allows on both spellings of localhost.
export const API_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');

/**
 * A failure the API described. Every error response has the same envelope —
 * `{ error, code, details? }` — so there is one error class rather than one per route.
 *
 * `status` is what happened, `code` is why, in the backend's own words:
 *   401 unauthenticated · 403 role lacks the capability · 404 not yours or absent ·
 *   409 a state rule · 422 the payload parsed but is wrong · 400 the body was not JSON.
 */
export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error || `Request failed (${status})`);
    this.name = 'ApiError';
    this.status = status;
    this.code = body?.code ?? null;
    this.details = body?.details ?? null;
  }

  /**
   * The 422 `details` array as a field → message object, for putting a message next to the
   * input that caused it. The backend reports every problem at once, so a form can show all of
   * them in one pass instead of playing whack-a-mole one submit at a time.
   */
  fieldErrors() {
    const out = {};
    for (const d of this.details ?? []) if (!(d.field in out)) out[d.field] = d.message;
    return out;
  }
}

/** The network itself failed — no response, so no status and no code to report. */
export class NetworkError extends Error {
  constructor(cause) {
    super('Could not reach the server. Check that the API is running.');
    this.name = 'NetworkError';
    this.status = 0;
    this.code = 'NETWORK';
    this.cause = cause;
  }
}

const buildUrl = (path, params) => {
  const url = new URL(API_URL + path);
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === undefined || value === null || value === '') continue;
    // Repeatable parameters — `?status=placed&status=ready` — are arrays here. append, not set.
    if (Array.isArray(value)) value.forEach((v) => url.searchParams.append(key, v));
    else url.searchParams.append(key, value);
  }
  return url;
};

/**
 * One request. Returns the parsed JSON body, or throws ApiError / NetworkError.
 *
 * `body` is serialised only when present: fetch refuses to send a body on a GET, and the
 * backend's Content-Type is only meaningful when there is something to type.
 */
export async function request(path, { method = 'GET', body, params, signal, raw = false } = {}) {
  const token = getToken();
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(buildUrl(path, params), {
      method,
      headers,
      signal,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (err) {
    // AbortError is React or TanStack Query cancelling a request that no longer matters. It is
    // not a failure to report, so it is rethrown untouched for the caller to ignore.
    if (err.name === 'AbortError') throw err;
    throw new NetworkError(err);
  }

  if (res.ok) return raw ? res : res.json();

  // A 401 means the token we sent is missing, malformed or expired — there is no refresh, so
  // the only correct response is to drop it and let the app fall back to the login screen.
  // Guarded on `token` because a failed login is also a 401 and there is nothing to clear:
  // clearing there would fire a spurious "you were signed out" for someone who never was.
  if (res.status === 401 && token) clearToken();

  // Every error the API raises is JSON. A 502 from a proxy in front of it is not, so parsing
  // is allowed to fail and the status alone becomes the message.
  let payload = null;
  try {
    payload = await res.json();
  } catch {
    /* not JSON — ApiError falls back to a message built from the status */
  }
  throw new ApiError(res.status, payload);
}

export const get = (path, params, opts) => request(path, { ...opts, params });
export const post = (path, body, opts) => request(path, { ...opts, method: 'POST', body });
export const patch = (path, body, opts) => request(path, { ...opts, method: 'PATCH', body });

/**
 * GET /orders/export — the one route that does not return JSON.
 *
 * The filename comes from Content-Disposition, which cross-origin JavaScript can only read
 * because backend/src/http/cors.js names it in Access-Control-Expose-Headers. Without that the
 * bytes would arrive and the name would not.
 */
export async function download(path, fallbackName) {
  const res = await request(path, { raw: true });
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const match = /filename="([^"]+)"/.exec(disposition);

  return { blob: await res.blob(), filename: match?.[1] ?? fallbackName };
}
