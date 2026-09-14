// The small shared pieces. Everything here is presentational.

import { cloneElement, isValidElement, useId } from 'react';
import { statusLabel } from './format.js';

export const Spinner = ({ large }) => <span className={large ? 'spinner lg' : 'spinner'} />;

export const Loading = ({ label = 'Loading…' }) => (
  <div className="loading">
    <Spinner large />
    <span>{label}</span>
  </div>
);

/**
 * One error, rendered the way the API described it.
 *
 * The 422 `details` list is shown as bullets, because the backend reports every problem at
 * once and collapsing that into a single line throws away the part that says which field.
 */
export function ErrorNotice({ error, children }) {
  if (!error) return null;

  const details = typeof error.fieldErrors === 'function' ? (error.details ?? []) : [];

  return (
    <div className="notice error" role="alert">
      <strong>{error.message}</strong>
      {details.length > 0 && (
        <ul>
          {details.map((d, i) => (
            <li key={`${d.field}-${i}`}>
              <span className="mono">{d.field}</span> — {d.message}
            </li>
          ))}
        </ul>
      )}
      {children}
    </div>
  );
}

export const StatusBadge = ({ status }) => (
  <span className={`badge ${status}`}>{statusLabel(status)}</span>
);

export const EmptyState = ({ title, children }) => (
  <div className="empty">
    <h3>{title}</h3>
    {children && <p>{children}</p>}
  </div>
);

/**
 * A labelled control that can carry a server-side message from a 422's `details`.
 *
 * The wrapper is a <div> with a separate <label htmlFor>, NOT a <label> wrapped around the
 * control. That distinction is load-bearing and cost a real bug: a <select> nested inside its
 * own <label> has the label's activation behaviour forwarded back to it, so the dropdown opens
 * and closes again in the same gesture and the value can never be changed. Availability was
 * stuck on "Available to order" for exactly this reason.
 *
 * Associating by id keeps everything a wrapping label bought — clicking the text still focuses
 * the control, and screen readers still announce it — without the control being a descendant
 * of the thing forwarding clicks to it.
 */
export function Field({ label, error, children, hint }) {
  // useId gives a value stable across renders and unique per instance, which is what makes
  // htmlFor safe in a component rendered more than once on a page.
  const id = useId();

  return (
    <div className={`field${error ? ' invalid' : ''}`}>
      {label && <label htmlFor={id}>{label}</label>}
      {isValidElement(children) ? cloneElement(children, { id }) : children}
      {hint && !error && <span className="hint">{hint}</span>}
      {error && <span className="err">{error}</span>}
    </div>
  );
}
