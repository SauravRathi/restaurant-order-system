// The small shared pieces. Everything here is presentational.

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

/** A labelled input that can carry a server-side message from a 422's `details`. */
export function Field({ label, error, children, hint }) {
  return (
    <label className={`field${error ? ' invalid' : ''}`}>
      {label && <span>{label}</span>}
      {children}
      {hint && !error && <span className="hint">{hint}</span>}
      {error && <span className="err">{error}</span>}
    </label>
  );
}
