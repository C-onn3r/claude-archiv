import type { FastifyReply } from 'fastify';

/**
 * Sicherheits-Header für Fremdinhalte (Proxy + Archive).
 *
 * `sandbox` ohne `allow-same-origin` zwingt jedes Dokument in einen undurchsichtigen Origin – auch wenn die URL
 * direkt (top-level) geöffnet wird. Fremde Skripte können dadurch weder auf localStorage/Tokens der App
 * zugreifen noch authentifizierte Same-Origin-Requests gegen die API absetzen.
 */
const SANDBOX = 'sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads';

export function applyProxyHeaders(reply: FastifyReply, requestOrigin?: string): void {
  reply.header('content-security-policy', `${SANDBOX}; frame-ancestors 'self'`);
  reply.header('referrer-policy', 'no-referrer');
  reply.header('x-content-type-options', 'nosniff');
  reply.header('cross-origin-resource-policy', 'cross-origin');
  // Sandbox-Dokumente haben den Origin "null"; der Proxy verhält sich wie "same-origin" zur geproxten Seite.
  if (requestOrigin) {
    reply.header('access-control-allow-origin', requestOrigin);
    reply.header('access-control-allow-credentials', 'true');
    reply.header('vary', 'Origin');
  } else {
    reply.header('access-control-allow-origin', '*');
  }
  reply.header('access-control-expose-headers', '*');
}

/**
 * Archive sind zusätzlich "hermetisch": Alle Unterressourcen müssen vom eigenen Server kommen, sodass
 * ein archivierter Seiteninhalt weder nachlädt noch Tracking-Requests ins Internet absetzen kann.
 */
export function applyArchiveHeaders(reply: FastifyReply): void {
  const csp = [
    SANDBOX,
    "frame-ancestors 'self'",
    "default-src 'self' data: blob:",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: data:",
    "style-src 'self' 'unsafe-inline' data:",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "media-src 'self' data: blob:",
    "connect-src 'self' data: blob:",
    "frame-src 'self' data: blob:",
    "object-src 'none'",
    "form-action 'none'",
  ].join('; ');
  reply.header('content-security-policy', csp);
  reply.header('referrer-policy', 'no-referrer');
  reply.header('x-content-type-options', 'nosniff');
  reply.header('access-control-allow-origin', '*');
  reply.header('cross-origin-resource-policy', 'cross-origin');
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Kleine, eigenständige Fehlerseite – wird im iframe des Viewers angezeigt. */
export function errorPage(status: number, title: string, message: string): string {
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root{color-scheme:light dark}
  body{font:16px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px;box-sizing:border-box;background:Canvas;color:CanvasText}
  main{max-width:34rem}
  h1{font-size:1.25rem;margin:0 0 .5rem}
  p{margin:.25rem 0;opacity:.8}
  code{opacity:.6;font-size:.85rem}
</style></head><body><main>
<h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><p><code>HTTP ${status}</code></p>
</main></body></html>`;
}
