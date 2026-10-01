import type { Archive, ArchiveView, Meta, Page, ProxyLink, TokenPair, User, ArchiveStatus, Role } from './types';

/** Leer = gleiche Origin (Produktion + Vite-Proxy). Für getrennte Deployments per VITE_API_BASE setzen. */
export const BASE: string = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';
const API = `${BASE}/api/v1`;

const ACCESS_KEY = 'wa.access';
const REFRESH_KEY = 'wa.refresh';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const storage = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string | null) => {
    try {
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch {
      /* Speicher nicht verfügbar */
    }
  },
};

export const tokenStore = {
  hasSession: () => storage.get(REFRESH_KEY) !== null,
  save(pair: Pick<TokenPair, 'accessToken' | 'refreshToken'>) {
    storage.set(ACCESS_KEY, pair.accessToken);
    storage.set(REFRESH_KEY, pair.refreshToken);
  },
  clear() {
    storage.set(ACCESS_KEY, null);
    storage.set(REFRESH_KEY, null);
  },
};

/** Wird aufgerufen, wenn die Sitzung endgültig abgelaufen ist (Refresh fehlgeschlagen). */
let onSessionExpired: () => void = () => undefined;
export const setSessionExpiredHandler = (fn: () => void) => {
  onSessionExpired = fn;
};

let refreshing: Promise<boolean> | null = null;

/** Erneuert die Tokens; parallele Aufrufe teilen sich eine Anfrage (Refresh-Tokens sind Einmal-Token). */
function refreshTokens(): Promise<boolean> {
  refreshing ??= (async () => {
    const refreshToken = storage.get(REFRESH_KEY);
    if (!refreshToken) return false;
    try {
      const res = await fetch(`${API}/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) return false;
      tokenStore.save((await res.json()) as TokenPair);
      return true;
    } catch {
      return false;
    } finally {
      setTimeout(() => (refreshing = null), 0);
    }
  })();
  return refreshing;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  auth?: boolean;
  query?: Record<string, string | number | undefined>;
}

async function rawRequest(path: string, opts: RequestOptions, retried = false): Promise<Response> {
  const url = new URL(`${API}${path}`, window.location.origin);
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const access = storage.get(ACCESS_KEY);
  if (opts.auth !== false && access) headers.authorization = `Bearer ${access}`;

  const res = await fetch(url, { method: opts.method ?? 'GET', headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  if (res.status === 401 && opts.auth !== false && !retried) {
    if (await refreshTokens()) return rawRequest(path, opts, true);
    tokenStore.clear();
    onSessionExpired();
  }
  return res;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  let res: Response;
  try {
    res = await rawRequest(path, opts);
  } catch {
    throw new ApiError(0, 'network', 'Server nicht erreichbar.');
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : undefined;
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string } } | undefined)?.error;
    throw new ApiError(res.status, err?.code ?? 'error', err?.message ?? `Fehler ${res.status}`);
  }
  return data as T;
}

export const api = {
  meta: () => request<Meta>('/meta', { auth: false }),

  async login(username: string, password: string): Promise<User> {
    const pair = await request<TokenPair>('/auth/login', { method: 'POST', body: { username, password }, auth: false });
    tokenStore.save(pair);
    return pair.user;
  },
  async register(username: string, password: string, displayName?: string): Promise<User> {
    const pair = await request<TokenPair>('/auth/register', { method: 'POST', body: { username, password, displayName }, auth: false });
    tokenStore.save(pair);
    return pair.user;
  },
  async logout(): Promise<void> {
    const refreshToken = storage.get(REFRESH_KEY);
    tokenStore.clear();
    if (refreshToken) await request('/auth/logout', { method: 'POST', body: { refreshToken }, auth: false }).catch(() => undefined);
  },
  me: () => request<User>('/auth/me'),
  async updateMe(body: { displayName?: string; currentPassword?: string; newPassword?: string }): Promise<User> {
    const res = await request<{ user: User; tokens?: TokenPair }>('/auth/me', { method: 'PATCH', body });
    if (res.tokens) tokenStore.save(res.tokens);
    return res.user;
  },

  listUsers: () => request<User[]>('/users'),
  createUser: (body: { username: string; password: string; displayName?: string; role?: Role }) => request<User>('/users', { method: 'POST', body }),
  updateUser: (id: string, body: { displayName?: string; role?: Role; password?: string }) => request<User>(`/users/${id}`, { method: 'PATCH', body }),
  deleteUser: (id: string) => request<void>(`/users/${id}`, { method: 'DELETE' }),

  proxyLink: (url: string) => request<ProxyLink>('/proxy/links', { method: 'POST', body: { url } }),

  listArchives: (q: { q?: string; status?: ArchiveStatus; limit?: number; offset?: number }) => request<Page<Archive>>('/archives', { query: q }),
  getArchive: (id: string) => request<Archive>(`/archives/${id}`),
  createArchive: (url: string, includeScripts: boolean) => request<Archive>('/archives', { method: 'POST', body: { url, includeScripts } }),
  updateArchive: (id: string, body: { title?: string; description?: string; tags?: string[] }) => request<Archive>(`/archives/${id}`, { method: 'PATCH', body }),
  deleteArchive: (id: string) => request<void>(`/archives/${id}`, { method: 'DELETE' }),
  retryArchive: (id: string) => request<Archive>(`/archives/${id}/retry`, { method: 'POST' }),
  archiveView: (id: string) => request<ArchiveView>(`/archives/${id}/view`),

  /** ZIP-Export: authentifizierter Download über fetch → Blob → Datei speichern. */
  async downloadArchive(id: string, title: string): Promise<void> {
    const res = await rawRequest(`/archives/${id}/download`, {});
    if (!res.ok) throw new ApiError(res.status, 'download', 'Download fehlgeschlagen.');
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${title.replace(/[^\w.-]+/g, '_').slice(0, 60) || 'archiv'}.zip`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  },
};

/** Content-URLs (iframe/WebView) bestehen aus Server-Basis + serverrelativem Pfad. */
export const contentUrl = (path: string): string => `${BASE}${path}`;
