// Route guards. These decide what to render; the API decides what is allowed.
//
// Nothing here is a security control — a waiter who edits the bundle to show the manager's
// buttons gets a 403 from the server, which is where the rule actually lives. The point of
// these is not to offer an action that is going to be refused.

import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { EmptyState, Loading } from '../ui/components.jsx';
import { useAuth } from './AuthContext.jsx';

export function RequireAuth() {
  const { user, isLoading, isBroken, signOut } = useAuth();
  const location = useLocation();

  // A token is being checked. Rendering the login page here would flash it at someone who is
  // already signed in, every single reload.
  if (isLoading) return <Loading label="Restoring your session…" />;

  // There is a token, and /auth/me failed for something other than 401 — the API is down or it
  // errored. "Sign in again" is the wrong advice: the credential is probably fine.
  if (isBroken) {
    return (
      <div className="page">
        <div className="card">
          <EmptyState title="Cannot reach the server">
            Your session could not be checked. The API may be starting up — free hosting sleeps
            after inactivity and takes up to a minute to wake.
            <div className="row" style={{ justifyContent: 'center', marginTop: 14 }}>
              <button className="primary" onClick={() => window.location.reload()}>
                Try again
              </button>
              <button onClick={signOut}>Sign out</button>
            </div>
          </EmptyState>
        </div>
      </div>
    );
  }

  // Remember where they were going, so signing in resumes it instead of dumping them on the
  // board. Someone following a link to one order should land on that order.
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }

  return <Outlet />;
}

// There is no RequireManager guard here, and that is not an omission.
//
// Nothing in this app is a manager-only *page*. The menu is browsable by both roles and hides
// its write controls; the dashboard is restaurant-wide by design. The one manager-only
// capability is the CSV export, which is a button. A guard component with no route to guard
// would be dead code that looks like a policy.
