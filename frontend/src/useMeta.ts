import { useEffect, useState } from 'react';
import { api } from './api/client';
import type { Meta } from './api/types';

let cached: Promise<Meta> | null = null;

/** Server-Fähigkeiten (z. B. PDF-Export verfügbar?) – einmal laden, dann wiederverwenden. */
export function useMeta(): Meta | null {
  const [meta, setMeta] = useState<Meta | null>(null);
  useEffect(() => {
    cached ??= api.meta();
    cached.then(setMeta).catch(() => {
      cached = null;
    });
  }, []);
  return meta;
}
