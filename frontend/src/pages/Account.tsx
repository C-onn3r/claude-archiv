import { useState, type FormEvent } from 'react';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { ErrorBanner } from '../components/Common';
import { errorMessage } from '../util';

export function Account() {
  const { user, setUser } = useAuth();
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setMsg(null);
    setError(null);
    if (next && next !== confirm) return setError('Die neuen Passwörter stimmen nicht überein.');
    try {
      const updated = await api.updateMe({
        displayName: displayName.trim() || undefined,
        currentPassword: next ? current : undefined,
        newPassword: next || undefined,
      });
      setUser(updated);
      setCurrent('');
      setNext('');
      setConfirm('');
      setMsg('Gespeichert.');
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <form className="card narrow" onSubmit={submit}>
      <h2>Konto</h2>
      <p className="muted">
        Angemeldet als <strong>{user?.username}</strong> ({user?.role === 'admin' ? 'Administrator' : 'Benutzer'})
      </p>
      {error && <ErrorBanner>{error}</ErrorBanner>}
      {msg && <div className="banner ok">{msg}</div>}
      <label>
        Anzeigename
        <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={80} required />
      </label>
      <h3>Passwort ändern</h3>
      <label>
        Aktuelles Passwort
        <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required={!!next} />
      </label>
      <label>
        Neues Passwort
        <input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={8} />
      </label>
      <label>
        Neues Passwort wiederholen
        <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required={!!next} />
      </label>
      <button className="btn primary">Speichern</button>
    </form>
  );
}
