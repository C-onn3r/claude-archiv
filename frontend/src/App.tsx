import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { Spinner } from './components/Common';
import { Layout } from './components/Layout';
import { Account } from './pages/Account';
import { AdminUsers } from './pages/AdminUsers';
import { ArchiveViewer } from './pages/ArchiveViewer';
import { Dashboard } from './pages/Dashboard';
import { LiveViewer } from './pages/LiveViewer';
import { Login } from './pages/Login';

function RequireAuth({ admin = false, children }: { admin?: boolean; children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div className="empty">
        <Spinner label="Lade …" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (admin && user.role !== 'admin') return <Navigate to="/" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route path="/" element={<Dashboard />} />
        <Route path="/account" element={<Account />} />
        <Route
          path="/admin/users"
          element={
            <RequireAuth admin>
              <AdminUsers />
            </RequireAuth>
          }
        />
      </Route>
      {/* Viewer nutzen die volle Fensterhöhe und brauchen deshalb kein Layout. */}
      <Route
        path="/view/live"
        element={
          <RequireAuth>
            <LiveViewer />
          </RequireAuth>
        }
      />
      <Route
        path="/view/archive/:id"
        element={
          <RequireAuth>
            <ArchiveViewer />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
