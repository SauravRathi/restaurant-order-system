// The route table.

import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import AlertsPage from './alerts/AlertsPage.jsx';
import LoginPage from './auth/LoginPage.jsx';
import { RequireAuth } from './auth/RequireAuth.jsx';
import MenuPage from './menu/MenuPage.jsx';
import OrderDetailPage from './orders/OrderDetailPage.jsx';
import OrdersPage from './orders/OrdersPage.jsx';
import { Loading } from './ui/components.jsx';
import Layout from './ui/Layout.jsx';

// The dashboard is the only page that imports Recharts, and Recharts is roughly two thirds of
// the bundle. Loading it eagerly means the login screen — and the order board a waiter lives on
// for an entire shift — pays to download a charting library neither of them draws with.
//
// So it is split out. It is the right page to pick: it is the one screen nobody opens first, it
// is visited occasionally rather than constantly, and the extra request happens once and is
// then cached. Everything else stays in the main bundle, because splitting a 4 kB page costs a
// round trip to save nothing.
const DashboardPage = lazy(() => import('./dashboard/DashboardPage.jsx'));

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      {/* Everything below this line requires a session. RequireAuth renders an <Outlet>, so
          the guard runs once for the whole tree rather than being repeated per route. */}
      <Route element={<RequireAuth />}>
        <Route element={<Layout />}>
          <Route index element={<Navigate to="/orders" replace />} />
          <Route path="/orders" element={<OrdersPage />} />
          <Route path="/orders/:id" element={<OrderDetailPage />} />
          <Route path="/menu" element={<MenuPage />} />
          <Route path="/alerts" element={<AlertsPage />} />
          {/* Suspense only around the split route. A boundary higher up would blank the whole
              shell — nav bar included — while the chunk downloads. */}
          <Route
            path="/dashboard"
            element={
              <Suspense fallback={<Loading label="Loading the dashboard…" />}>
                <DashboardPage />
              </Suspense>
            }
          />
        </Route>
      </Route>

      {/* No 404 page. Every path that is not a route is a typo or a stale link, and the board
          is where someone who mistyped one actually wanted to be.

          There is no RequireManager wrapper in this table, deliberately: nothing in the app is
          a manager-only *page*. The menu is browsable by both roles and hides its write
          controls; the dashboard is restaurant-wide by design. The one manager-only capability
          — the CSV export — is a button, not a route. */}
      <Route path="*" element={<Navigate to="/orders" replace />} />
    </Routes>
  );
}
