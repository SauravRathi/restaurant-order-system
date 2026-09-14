// The route table.

import { Navigate, Route, Routes } from 'react-router-dom';
import AlertsPage from './alerts/AlertsPage.jsx';
import LoginPage from './auth/LoginPage.jsx';
import { RequireAuth } from './auth/RequireAuth.jsx';
import MenuPage from './menu/MenuPage.jsx';
import OrderDetailPage from './orders/OrderDetailPage.jsx';
import OrdersPage from './orders/OrdersPage.jsx';
import Layout from './ui/Layout.jsx';

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
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/orders" replace />} />
    </Routes>
  );
}
