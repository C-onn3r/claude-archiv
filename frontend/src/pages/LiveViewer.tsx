import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, contentUrl } from '../api/client';
import { Spinner } from '../components/Common';
import { IconArchive, IconBack, IconForward, IconReload } from '../components/Icons';
import { errorMessage } from '../util';

/** Sandbox ohne allow-same-origin: Fremdinhalte laufen in einem isolierten Origin und erreichen weder Tokens noch API. */
export const FRAME_SANDBOX = 'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads';

interface LocationMessage {
  source: 'web-archiver';
  type: 'location';
  url: string;
  title: string;
}

const isLocationMessage = (d: unknown): d is LocationMessage =>
  typeof d === 'object' && d !== null && (d as LocationMessage).source === 'web-archiver' && (d as LocationMessage).type === 'location';

export function LiveViewer() {
  const [params] = useSearchParams();
  const initial = params.get('url') ?? '';
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [frameSrc, setFrameSrc] = useState<string | null>(null);
  const [address, setAddress] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const open = useCallback(async (url: string) => {
    setLoading(true);
    setError(null);
    try {
      const link = await api.proxyLink(url);
      setAddress(link.targetUrl);
      setDraft(link.targetUrl);
      setFrameSrc(contentUrl(link.proxyUrl));
    } catch (e) {
      setError(errorMessage(e));
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initial) void open(initial);
  }, [initial, open]);

  // Die geproxte Seite meldet ihre echte URL (Shim) – so zeigt die Adressleiste immer das reale Ziel.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frameRef.current?.contentWindow || !isLocationMessage(e.data)) return;
      setAddress(e.data.url);
      setDraft(e.data.url);
      setTitle(e.data.title);
      document.title = e.data.title ? `${e.data.title} – Web-Archivierer` : 'Web-Archivierer';
      window.history.replaceState(window.history.state, '', `/view/live?url=${encodeURIComponent(e.data.url)}`);
    };
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      document.title = 'Web-Archivierer';
    };
  }, []);

  const command = (cmd: 'back' | 'forward') => frameRef.current?.contentWindow?.postMessage({ source: 'web-archiver-host', cmd }, '*');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (draft.trim()) void open(draft.trim());
  };

  const archive = async () => {
    setNotice(null);
    try {
      const a = await api.createArchive(address, true);
      setNotice(`Archivierung gestartet (${a.id.slice(0, 8)}) – Fortschritt im Dashboard.`);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <div className="viewer">
      <div className="viewer-bar">
        <Link to="/" className="btn ghost" title="Zurück zum Dashboard">
          ← Dashboard
        </Link>
        <button className="icon-btn" title="Zurück" onClick={() => command('back')}>
          <IconBack />
        </button>
        <button className="icon-btn" title="Vorwärts" onClick={() => command('forward')}>
          <IconForward />
        </button>
        <button className="icon-btn" title="Neu laden" onClick={() => void open(address || draft)}>
          <IconReload />
        </button>
        <form className="address" onSubmit={submit}>
          <input value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Adresse" spellCheck={false} autoCapitalize="off" />
        </form>
        <button className="btn" onClick={() => void archive()} disabled={!address}>
          <IconArchive /> Archivieren
        </button>
      </div>
      {(error || notice) && (
        <div className={`banner ${error ? 'error' : 'ok'} viewer-banner`} role={error ? 'alert' : 'status'}>
          {error ?? notice}
          <button className="btn link" onClick={() => (setError(null), setNotice(null))}>
            Schließen
          </button>
        </div>
      )}
      <div className="frame-wrap">
        {loading && (
          <div className="frame-loading">
            <Spinner label={title || 'Lade …'} />
          </div>
        )}
        {frameSrc ? (
          <iframe
            ref={frameRef}
            key={frameSrc}
            title={title || 'Geproxte Seite'}
            src={frameSrc}
            sandbox={FRAME_SANDBOX}
            referrerPolicy="no-referrer"
            onLoad={() => setLoading(false)}
          />
        ) : (
          !loading && !error && <div className="empty">Gib oben eine Adresse ein.</div>
        )}
      </div>
    </div>
  );
}
