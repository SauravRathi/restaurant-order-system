// The only page that is reachable signed out.

import { useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { ApiError } from '../api/client.js';
import { ErrorNotice, Field, Spinner } from '../ui/components.jsx';
import { useAuth } from './AuthContext.jsx';

// Throwaway accounts from seed/001_demo.sql, offered as buttons because a reviewer opening this
// cold should not have to go and find them. They would not be here in a real deployment.
const DEMO = [
  { label: 'Manager', email: 'manager@demo.test', password: 'Manager@123' },
  { label: 'Waiter', email: 'arjun@demo.test', password: 'Waiter@123' },
];

export default function LoginPage() {
  const { user, signIn } = useAuth();
  const location = useLocation();

  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  // Already signed in — go where they were headed before RequireAuth sent them here, or to the
  // board. `replace` so the back button does not land on a login page that will bounce again.
  if (user) return <Navigate to={location.state?.from ?? '/orders'} replace />;

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(form.email, form.password);
      // No navigate() — signing in populates the auth context, this component re-renders, and
      // the redirect above handles it. One place decides where a signed-in user goes.
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  // Named signInAs, not useDemo: a function whose name starts with "use" is read as a hook by
  // the rules-of-hooks lint, and calling it from an onClick is then reported as calling a hook
  // inside a callback. It is a plain handler.
  async function signInAs(account) {
    setForm({ email: account.email, password: account.password });
    setBusy(true);
    setError(null);
    try {
      await signIn(account.email, account.password);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  // A 422 says the email is not an email or the password field is empty; a 401 says the
  // credentials are wrong. The first belongs next to the input, the second above the form —
  // it is about the pair, and the API deliberately does not say which half was wrong.
  const fields = error instanceof ApiError && error.status === 422 ? error.fieldErrors() : {};
  const formError = error && !(error instanceof ApiError && error.status === 422) ? error : null;

  return (
    <div className="login-shell">
      <div className="card login-card">
        <h1>Orders</h1>
        <p>Sign in to the floor.</p>

        <ErrorNotice error={formError} />

        <form onSubmit={onSubmit} noValidate>
          <Field label="Email" error={fields.email}>
            <input
              type="email"
              name="email"
              value={form.email}
              onChange={set('email')}
              autoComplete="username"
              autoFocus
              required
            />
          </Field>

          <Field label="Password" error={fields.password}>
            <input
              type="password"
              name="password"
              value={form.password}
              onChange={set('password')}
              autoComplete="current-password"
              required
            />
          </Field>

          <button type="submit" className="primary" disabled={busy} style={{ width: '100%' }}>
            {busy && <Spinner />}
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <div className="demo-creds">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span>Demo accounts</span>
            <span className="row">
              {DEMO.map((account) => (
                <button key={account.email} type="button" disabled={busy} onClick={() => signInAs(account)}>
                  {account.label}
                </button>
              ))}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
