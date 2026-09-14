// The route table.

import { Navigate, Route, Routes } from 'react-router-dom';
import LoginPage from './auth/LoginPage.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
