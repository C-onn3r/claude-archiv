import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, contentUrl } from '../api/client';
import type { Archive } from '../api/types';
import { ErrorBanner, Spinner, StatusBadge } from '../components/Common';
import { IconDownload, IconExternal, IconTrash } from '../components/Icons';
import { errorMessage, formatBytes, formatDateTime } from '../util';
import { FRAME_SANDBOX } from './LiveViewer';

export function ArchiveViewer() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [archive, setArchive] = useState<Archive | null>(null);
  const [frameSrc, setFrameSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const a = await api.getArchive(id);
      setArchive(a);
      if (a.status === 'done') setFrameSrc(contentUrl((await api.archiveView(id)).viewUrl));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Noch nicht fertig? Bis zum Abschluss pollen.
  useEffect(() => {
    if (!archive || archive.status === 'done' || archive.status === 'failed') return;
    const t = setTimeout(() => void load(), 1500);
    return () => clearTimeout(t);
  }, [archive, load]);

  const remove = async () => {
    if (!archive || !window.confirm(`„${archive.title}“ endgültig löschen?`)) return;
    try {
      await api.deleteArchive(archive.id);
      navigate('/');
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <div className="viewer">
      <div className="viewer-bar">
        <Link to="/" className="btn ghost">
          ← Dashboard
        </Link>
        <div className="viewer-title">
          <strong>{archive?.title ?? 'Archiv'}</strong>
          {archive && (
            <span className="muted">
              {formatDateTime(archive.createdAt)} · {formatBytes(archive.totalBytes)} · {archive.assetCount} Dateien
              {archive.failedCount > 0 ? ` · ${archive.failedCount} fehlend` : ''}
            </span>
          )}
        </div>
        {archive && <StatusBadge status={archive.status} />}
        {archive && (
          <>
            <a className="icon-btn" href={archive.finalUrl ?? archive.url} target="_blank" rel="noopener noreferrer" title="Originalseite öffnen">
              <IconExternal />
            </a>
            {archive.status === 'done' && (
              <button className="icon-btn" title="ZIP herunterladen" onClick={() => api.downloadArchive(archive.id, archive.title).catch((e) => setError(errorMessage(e)))}>
                <IconDownload />
              </button>
            )}
            <button className="icon-btn danger" title="Löschen" onClick={() => void remove()}>
              <IconTrash />
            </button>
          </>
        )}
      </div>
      {error && <ErrorBanner>{error}</ErrorBanner>}
      <div className="frame-wrap">
        {frameSrc ? (
          <iframe key={frameSrc} title={archive?.title ?? 'Archiv'} src={frameSrc} sandbox={FRAME_SANDBOX} referrerPolicy="no-referrer" />
        ) : archive?.status === 'failed' ? (
          <div className="empty">
            <ErrorBanner>{archive.error ?? 'Archivierung fehlgeschlagen.'}</ErrorBanner>
          </div>
        ) : (
          !error && (
            <div className="empty">
              <Spinner label="Archiv wird erstellt …" />
            </div>
          )
        )}
      </div>
    </div>
  );
}
