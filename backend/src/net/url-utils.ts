import { HttpError } from '../util/errors.js';

const MAX_URL_LENGTH = 4096;

/**
 * Normalisiert Benutzereingaben ("example.com/foo") zu einer absoluten http(s)-URL.
 * Wirft HttpError(400) bei ungültigen Eingaben.
 */
export function parseTargetUrl(input: string): URL {
  const raw = input.trim();
  if (!raw) throw HttpError.badRequest('Keine URL angegeben.', 'invalid_url');
  if (raw.length > MAX_URL_LENGTH) throw HttpError.badRequest('URL ist zu lang.', 'invalid_url');
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^[^/]*:\d+(\/|$)/.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw HttpError.badRequest('Ungültige URL.', 'invalid_url');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw HttpError.badRequest('Nur http- und https-URLs werden unterstützt.', 'unsupported_scheme');
  }
  if (url.username || url.password) {
    throw HttpError.badRequest('URLs mit Zugangsdaten werden nicht unterstützt.', 'invalid_url');
  }
  if (!url.hostname) throw HttpError.badRequest('Ungültige URL.', 'invalid_url');
  return url;
}

/** Versucht eine (ggf. relative) URL aufzulösen; gibt null zurück statt zu werfen. */
export function tryResolve(ref: string, base: string | URL): URL | null {
  try {
    return new URL(ref, base);
  } catch {
    return null;
  }
}

export const isHttpUrl = (u: URL): boolean => u.protocol === 'http:' || u.protocol === 'https:';

/** URL ohne Fragment – Schlüssel für Deduplizierung. */
export function stripHash(u: URL): string {
  const c = new URL(u.href);
  c.hash = '';
  return c.href;
}
