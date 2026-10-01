import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type { Archive, ArchiveStatus } from '../api/types';
import { ErrorBanner, Spinner, StatusBadge } from '../components/Common';
import { IconArchive, IconDownload, IconEdit, IconGlobe, IconRetry, IconTrash } from '../components/Icons';
import { errorMessage, formatBytes, formatRelative, hostOf } from '../util';

const PAGE = 20;

export function Dashboard() {
  const navigate = useNavigate();
  const [input, setInput] = useState('');
  const [includeScripts, setIncludeScripts] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [items, setItems] = useState<Archive[]>([]);
  const [total, setTotal] = useState(0);
  const [limit, setLimit] = useState(PAGE);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [status, setStatus] = useState<ArchiveStatus | ''>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const reqId = useRef(0);
  const load = useCallback(
    async (silent = false) => {
      const id = ++reqId.current;
      if (!silent) setLoading(true);
      try {
        const page = await api.listArchives({ q: debouncedQuery || undefined, status: status || undefined, limit, offset: 0 });
        if (id !== reqId.current) return; // veraltete Antwort
        setItems(page.items);
        setTotal(page.total);
        setError(null);
      } catch (e) {
        if (id === reqId.current) setError(errorMessage(e));
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    },
    [debouncedQuery, status, limit],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Laufende Archivierungen: Liste automatisch aktualisieren.
  const active = items.some((a) => a.status === 'pending' || a.status === 'running');
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => void load(true), 1500);
    return () => clearInterval(t);
  }, [active, load]);

  const openLive = (e: FormEvent) => {
    e.preventDefault();
    if (input.trim()) navigate(`/view/live?url=${encodeURIComponent(input.trim())}`);
  };

  const archive = async () => {
    if (!input.trim()) return;
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const a = await api.createArchive(input.trim(), includeScripts);
      setNotice(`Archivierung von ${hostOf(a.url)} gestartet.`);
      setInput('');
      void load(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (a: Archive) => {
    if (!window.confirm(`„${a.title}“ endgültig löschen?`)) return;
    try {
      await api.deleteArchive(a.id);
      setItems((cur) => cur.filter((x) => x.id !== a.id));
      setTotal((t) => t - 1);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const rename = async (a: Archive) => {
    const title = window.prompt('Neuer Titel', a.title)?.trim();
    if (!title || title === a.title) return;
    try {
      const updated = await api.updateArchive(a.id, { title });
      setItems((cur) => cur.map((x) => (x.id === a.id ? updated : x)));
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const retry = async (a: Archive) => {
    try {
      const updated = await api.retryArchive(a.id);
      setItems((cur) => cur.map((x) => (x.id === a.id ? updated : x)));
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <>
      <section className="card hero">
        <h2>Webseite öffnen oder archivieren</h2>
        <form onSubmit={openLive} className="url-form">
          <input
            type="text"
            inputMode="url"
            placeholder="https://beispiel.de/artikel"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            aria-label="Ziel-URL"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <button className="btn primary" type="submit" disabled={!input.trim()}>
            <IconGlobe /> Live öffnen
          </button>
          <button className="btn" type="button" onClick={() => void archive()} disabled={!input.trim() || submitting}>
            {submitting ? <Spinner /> : <IconArchive />} Archivieren
          </button>
        </form>
        <label className="check">
          <input type="checkbox" checked={includeScripts} onChange={(e) => setIncludeScripts(e.target.checked)} />
          JavaScript mitarchivieren <span className="muted">(aus = statischer Schnappschuss ohne Skripte)</span>
        </label>
        {notice && <div className="banner ok">{notice}</div>}
      </section>

      {error && <ErrorBanner>{error}</ErrorBanner>}

      <section className="list-head">
        <h2>
          Archivierte Seiten <span className="muted">({total})</span>
        </h2>
        <div className="filters">
          <input type="search" placeholder="Suchen …" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Archive durchsuchen" />
          <select value={status} onChange={(e) => setStatus(e.target.value as ArchiveStatus | '')} aria-label="Statusfilter">
            <option value="">Alle</option>
            <option value="done">Fertig</option>
            <option value="running">Läuft</option>
            <option value="pending">Wartet</option>
            <option value="failed">Fehlgeschlagen</option>
          </select>
        </div>
      </section>

      {loading && items.length === 0 ? (
        <div className="empty">
          <Spinner label="Lade …" />
        </div>
      ) : items.length === 0 ? (
        <div className="empty card">
          <p>{debouncedQuery || status ? 'Keine Treffer.' : 'Noch keine Archive. Gib oben eine URL ein und klicke auf „Archivieren“.'}</p>
        </div>
      ) : (
        <ul className="archive-list">
          {items.map((a) => (
            <li key={a.id} className="card archive-item">
              <div className="archive-main">
                <div className="archive-title">
                  {a.status === 'done' ? (
                    <Link to={`/view/archive/${a.id}`}>{a.title || a.url}</Link>
                  ) : (
                    <span>{a.title || a.url}</span>
                  )}
                </div>
                <div className="archive-meta muted">
                  <span title={a.url}>{hostOf(a.url)}</span>
                  <span>{formatRelative(a.createdAt)}</span>
                  {a.status === 'done' && (
                    <span>
                      {formatBytes(a.totalBytes)} · {a.assetCount} Dateien{a.failedCount > 0 ? ` · ${a.failedCount} fehlend` : ''}
                    </span>
                  )}
                  {a.status === 'running' && a.assetCount > 0 && <span>{a.assetCount} Dateien geladen</span>}
                  {a.tags.map((t) => (
                    <span key={t} className="tag">
                      {t}
                    </span>
                  ))}
                </div>
                {a.error && <div className="archive-error">{a.error}</div>}
              </div>
              <StatusBadge status={a.status} />
              <div className="actions">
                {a.status === 'done' && (
                  <button className="icon-btn" title="ZIP herunterladen" onClick={() => api.downloadArchive(a.id, a.title).catch((e) => setError(errorMessage(e)))}>
                    <IconDownload />
                  </button>
                )}
                {a.status === 'failed' && (
                  <button className="icon-btn" title="Erneut versuchen" onClick={() => void retry(a)}>
                    <IconRetry />
                  </button>
                )}
                <button className="icon-btn" title="Umbenennen" onClick={() => void rename(a)}>
                  <IconEdit />
                </button>
                <button className="icon-btn danger" title="Löschen" onClick={() => void remove(a)}>
                  <IconTrash />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {items.length < total && (
        <div className="more">
          <button className="btn" onClick={() => setLimit((l) => l + PAGE)}>
            Mehr laden ({total - items.length})
          </button>
        </div>
      )}
    </>
  );
}
