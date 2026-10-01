import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api/client';
import type { Role, User } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { ErrorBanner } from '../components/Common';
import { IconTrash } from '../components/Icons';
import { errorMessage, formatDateTime } from '../util';

export function AdminUsers() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('user');

  const load = () => api.listUsers().then(setUsers).catch((e) => setError(errorMessage(e)));
  useEffect(() => {
    void load();
  }, []);

  const guard = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const create = (e: FormEvent) => {
    e.preventDefault();
    void guard(async () => {
      await api.createUser({ username, password, role });
      setUsername('');
      setPassword('');
      setRole('user');
    });
  };

  return (
    <>
      <section className="card">
        <h2>Benutzer</h2>
        {error && <ErrorBanner>{error}</ErrorBanner>}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Benutzername</th>
                <th>Name</th>
                <th>Rolle</th>
                <th>Angelegt</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.username}</td>
                  <td>{u.displayName}</td>
                  <td>
                    <select value={u.role} onChange={(e) => void guard(() => api.updateUser(u.id, { role: e.target.value as Role }))} aria-label={`Rolle von ${u.username}`}>
                      <option value="user">Benutzer</option>
                      <option value="admin">Administrator</option>
                    </select>
                  </td>
                  <td>{formatDateTime(u.createdAt)}</td>
                  <td className="actions">
                    <button
                      className="btn ghost"
                      onClick={() => {
                        const pw = window.prompt(`Neues Passwort für ${u.username} (mind. 8 Zeichen)`);
                        if (pw) void guard(() => api.updateUser(u.id, { password: pw }));
                      }}
                    >
                      Passwort setzen
                    </button>
                    <button
                      className="icon-btn danger"
                      title="Löschen"
                      disabled={u.id === me?.id}
                      onClick={() => {
                        if (window.confirm(`Benutzer „${u.username}“ inklusive aller Archive löschen?`)) void guard(() => api.deleteUser(u.id));
                      }}
                    >
                      <IconTrash />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <form className="card narrow" onSubmit={create}>
        <h3>Benutzer anlegen</h3>
        <label>
          Benutzername
          <input value={username} onChange={(e) => setUsername(e.target.value)} required minLength={3} maxLength={32} pattern="[a-zA-Z0-9._\-]+" />
        </label>
        <label>
          Passwort
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete="new-password" />
        </label>
        <label>
          Rolle
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="user">Benutzer</option>
            <option value="admin">Administrator</option>
          </select>
        </label>
        <button className="btn primary">Anlegen</button>
      </form>
    </>
  );
}
