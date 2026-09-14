// The shell every signed-in page renders inside.

import { Link, NavLink, Outlet } from 'react-router-dom';
import { useAlertCount } from '../alerts/queries.js';
import { useAuth } from '../auth/AuthContext.jsx';

export default function Layout() {
  const { user, signOut } = useAuth();
  const { data: alertCount } = useAlertCount();

  return (
    <div className="app">
      <header className="topbar">
        <Link to="/orders" className="brand">
          Orders
        </Link>

        <nav>
          <NavLink to="/orders">Orders</NavLink>
          <NavLink to="/menu">Menu</NavLink>
          <NavLink to="/alerts">
            Alerts
            {/* Only when there are any. A zero badge is a permanent piece of furniture that
                stops meaning anything, which is the opposite of what an alert is for. */}
            {alertCount > 0 && <span className="count-badge">{alertCount}</span>}
          </NavLink>
          <NavLink to="/dashboard">Dashboard</NavLink>
        </nav>

        <div className="whoami">
          <span>
            {user.displayName} · <span className="faint">{user.role}</span>
          </span>
          <button className="ghost small" onClick={signOut}>
            Sign out
          </button>
        </div>
      </header>

      <Outlet />
    </div>
  );
}
