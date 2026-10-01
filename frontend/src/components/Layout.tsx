import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { IconArchive } from './Icons';

export function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/" className="brand">
          <IconArchive width={22} height={22} /> Web-Archivierer
        </Link>
        <nav className="topnav">
          <NavLink to="/" end>
            Dashboard
          </NavLink>
          {user?.role === 'admin' && <NavLink to="/admin/users">Benutzer</NavLink>}
          <NavLink to="/account">{user?.displayName}</NavLink>
          <button
            className="btn ghost"
            onClick={async () => {
              await logout();
              navigate('/login');
            }}
          >
            Abmelden
          </button>
        </nav>
      </header>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
