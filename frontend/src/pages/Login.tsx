import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type { Meta } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { ErrorBanner, Spinner } from '../components/Common';
import { IconArchive } from '../components/Icons';
import { errorMessage } from '../util';

export function Login() {
  const { user, login, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .meta()
      .then((m) => {
        setMeta(m);
        if (m.needsSetup) setMode('register');
      })
      .catch((e) => setError(errorMessage(e)));
  }, []);

  if (user) return <Navigate to={(location.state as { from?: string } | null)?.from ?? '/'} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') await login(username, password);
      else await register(username, password, displayName || undefined);
      navigate((location.state as { from?: string } | null)?.from ?? '/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const setup = meta?.needsSetup === true;
  return (
    <div className="login-page">
      <form className="card login-card" onSubmit={submit}>
        <div className="login-brand">
          <IconArchive width={32} height={32} />
          <h1>Web-Archivierer</h1>
          <p className="muted">{setup ? 'Willkommen! Lege den ersten Administrator an.' : mode === 'login' ? 'Melde dich an, um fortzufahren.' : 'Neues Konto erstellen.'}</p>
        </div>
        {error && <ErrorBanner>{error}</ErrorBanner>}
        <label>
          Benutzername
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required minLength={3} maxLength={32} autoFocus />
        </label>
        {mode === 'register' && (
          <label>
            Anzeigename <span className="muted">(optional)</span>
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={80} />
          </label>
        )}
        <label>
          Passwort
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            required
            minLength={mode === 'register' ? 8 : 1}
          />
          {mode === 'register' && <small className="muted">Mindestens 8 Zeichen.</small>}
        </label>
        <button className="btn primary" disabled={busy}>
          {busy ? <Spinner /> : mode === 'login' ? 'Anmelden' : setup ? 'Administrator anlegen' : 'Registrieren'}
        </button>
        {meta?.registrationOpen && !setup && (
          <button type="button" className="btn link" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
            {mode === 'login' ? 'Noch kein Konto? Registrieren' : 'Bereits registriert? Anmelden'}
          </button>
        )}
      </form>
    </div>
  );
}
