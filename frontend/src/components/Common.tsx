import type { ReactNode } from 'react';
import type { ArchiveStatus } from '../api/types';

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="spinner-wrap" role="status">
      <span className="spinner" aria-hidden="true" />
      {label && <span>{label}</span>}
    </span>
  );
}

const STATUS_LABEL: Record<ArchiveStatus, string> = {
  pending: 'Wartet',
  running: 'Läuft',
  done: 'Fertig',
  failed: 'Fehlgeschlagen',
};

export function StatusBadge({ status }: { status: ArchiveStatus }) {
  return (
    <span className={`badge ${status}`}>
      {(status === 'running' || status === 'pending') && <span className="spinner small" aria-hidden="true" />}
      {STATUS_LABEL[status]}
    </span>
  );
}

export function ErrorBanner({ children }: { children: ReactNode }) {
  return (
    <div className="banner error" role="alert">
      {children}
    </div>
  );
}
