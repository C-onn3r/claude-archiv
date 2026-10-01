import type { FastifyReply, FastifyRequest } from 'fastify';
import { Readable } from 'node:stream';
import type { Element } from 'domhandler';
import type { Services } from '../app-types.js';
import { userFromContentToken } from '../auth/plugin.js';
import { HttpError } from '../util/errors.js';
import { isHttpUrl, parseTargetUrl } from '../net/url-utils.js';
import { readBodyLimited } from '../net/safe-fetch.js';
import { rewriteHtml } from '../rewrite/html.js';
import { rewriteCss } from '../rewrite/css.js';
import { decodeText, stripCssCharset } from '../rewrite/charset.js';
import { buildProxyShim } from '../rewrite/shim.js';
import { applyProxyHeaders, errorPage } from './content-headers.js';

const PROXY_URL_RE = /^\/proxy\/([^/?#]+)\/(https?)\/([^/?#]+)([^#]*)/;

/** Baut den Pfad-Präfix, unter dem eine Proxy-Sitzung erreichbar ist. */
export const proxyPrefix = (token: string): string => `/proxy/${token}/`;

/** Wandelt eine echte URL in eine Proxy-URL (nur Pfad, same-origin zum Server). */
export function toProxyUrl(token: string, url: URL): string {
  return `${proxyPrefix(token)}${url.protocol.slice(0, -1)}/${url.host}${url.pathname}${url.search}${url.hash}`;
}

/** Zerlegt eine eingehende Proxy-Request-URL in Token und Ziel-URL. */
export function parseProxyRequest(rawUrl: string): { token: string; target: URL } | null {
  const m = PROXY_URL_RE.exec(rawUrl);
  if (!m) return null;
  const [, token, scheme, host, rest] = m as unknown as [string, string, string, string, string];
  const tail = rest === '' ? '/' : rest.startsWith('?') ? `/${rest}` : rest;
  try {
    const target = new URL(`${scheme}://${host}${tail}`);
    if (!isHttpUrl(target) || target.username || target.password) return null;
    return { token, target };
  } catch {
    return null;
  }
}

const REWRITTEN_HTML = /^(?:text\/html|application\/xhtml\+xml)\b/i;
const REWRITTEN_CSS = /^text\/css\b/i;

const FORWARD_REQUEST_HEADERS = ['accept', 'accept-language', 'range', 'if-none-match', 'if-modified-since', 'content-type'];
const FORWARD_RESPONSE_HEADERS = [
  'content-type',
  'content-range',
  'accept-ranges',
  'etag',
  'last-modified',
  'content-disposition',
  'expires',
  'content-language',
];

function sendError(reply: FastifyReply, status: number, title: string, message: string) {
  return reply.code(status).header('content-type', 'text/html; charset=utf-8').header('cache-control', 'no-store').send(errorPage(status, title, message));
}

/** Liefert eine Seite über den Proxy aus; wird für alle HTTP-Methoden und alle Pfade unter /proxy/ verwendet. */
export async function handleProxyRequest(services: Services, request: FastifyRequest, reply: FastifyReply) {
  const origin = request.headers.origin;
  applyProxyHeaders(reply, typeof origin === 'string' ? origin : undefined);

  // CORS-Preflight beantwortet der Proxy selbst (Ziele kennen unseren Origin nicht).
  if (request.method === 'OPTIONS' && request.headers['access-control-request-method']) {
    const reqHeaders = request.headers['access-control-request-headers'];
    return reply
      .code(204)
      .header('access-control-allow-methods', 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS')
      .header('access-control-allow-headers', typeof reqHeaders === 'string' ? reqHeaders : '*')
      .header('access-control-max-age', '600')
      .send();
  }

  const parsed = parseProxyRequest(request.raw.url ?? '');
  if (!parsed) return sendError(reply, 400, 'Ungültige Proxy-URL', 'Die angeforderte Adresse konnte nicht gelesen werden.');
  const { token, target } = parsed;

  const user = await userFromContentToken(services, token);
  if (!user) {
    return sendError(reply, 401, 'Sitzung abgelaufen', 'Der Zugriffslink ist abgelaufen. Bitte die Seite in der App erneut öffnen.');
  }

  const { config, proxyFetcher } = services;
  const method = request.method.toUpperCase();
  if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(method)) {
    return sendError(reply, 405, 'Methode nicht erlaubt', `${method} wird vom Proxy nicht unterstützt.`);
  }

  const headers: Record<string, string> = {
    'user-agent': (request.headers['user-agent'] as string | undefined) ?? config.userAgent,
    referer: `${target.origin}/`,
  };
  for (const name of FORWARD_REQUEST_HEADERS) {
    const v = request.headers[name];
    if (typeof v === 'string') headers[name] = v;
  }
  const hasBody = method !== 'GET' && method !== 'HEAD';
  if (hasBody) headers.origin = target.origin;

  let body: Buffer | undefined;
  if (hasBody && Buffer.isBuffer(request.body) && request.body.length > 0) body = request.body;

  const abort = new AbortController();
  reply.raw.on('close', () => abort.abort());

  let upstream;
  try {
    upstream = await proxyFetcher.request(target, { method, headers, body }, abort.signal);
  } catch (err) {
    if (err instanceof HttpError) return sendError(reply, err.statusCode, 'Seite nicht erreichbar', err.message);
    throw err;
  }

  const status = upstream.status;
  const contentType = upstream.headers.get('content-type') ?? '';
  reply.header('cache-control', 'private, no-cache');

  // Redirects: Ziel in Proxy-URL übersetzen, Statuscode beibehalten.
  const location = upstream.headers.get('location');
  if (status >= 300 && status < 400 && location) {
    void upstream.body?.cancel().catch(() => undefined);
    let next: URL | null = null;
    try {
      next = new URL(location, target);
    } catch {
      /* ungültige Location */
    }
    if (!next || !isHttpUrl(next)) return sendError(reply, 502, 'Ungültige Weiterleitung', `Das Ziel antwortete mit einer nicht unterstützten Weiterleitung (${location}).`);
    return reply.code(status).header('location', toProxyUrl(token, next)).send();
  }

  const isHtml = REWRITTEN_HTML.test(contentType);
  const isCss = REWRITTEN_CSS.test(contentType);

  if ((isHtml || isCss) && method !== 'HEAD') {
    let raw: Buffer;
    try {
      raw = await readBodyLimited(upstream, config.proxy.maxBufferedBytes);
    } catch (err) {
      if (err instanceof HttpError) return sendError(reply, err.statusCode, 'Seite nicht darstellbar', err.message);
      throw err;
    }
    const finalStatus = status === 304 ? 200 : status;
    if (isHtml) {
      const prefix = proxyPrefix(token);
      const rewritten = await rewriteHtml(decodeText(raw, contentType, 'html'), {
        documentUrl: target,
        mapUrl: ({ url }) => toProxyUrl(token, url),
        onElement: (el: Element) => {
          const tag = el.tagName.toLowerCase();
          if ((tag === 'a' || tag === 'area' || tag === 'form') && el.attribs.target && el.attribs.target !== '_self') {
            el.attribs.target = '_self';
          }
        },
        headPrepend: buildProxyShim(prefix, target.href),
      });
      return reply.code(finalStatus).header('content-type', 'text/html; charset=utf-8').send(rewritten.html);
    }
    const css = stripCssCharset(decodeText(raw, contentType, 'css'));
    const out = await rewriteCss(css, (value) => {
      try {
        const u = new URL(value, target);
        return isHttpUrl(u) ? toProxyUrl(token, u) : null;
      } catch {
        return null;
      }
    });
    return reply.code(finalStatus).header('content-type', 'text/css; charset=utf-8').send(out);
  }

  // Alles andere (Bilder, Skripte, Fonts, Medien, JSON …) wird unverändert durchgeleitet.
  for (const name of FORWARD_RESPONSE_HEADERS) {
    const v = upstream.headers.get(name);
    if (v) reply.header(name, v);
  }
  const cacheControl = upstream.headers.get('cache-control');
  if (cacheControl) reply.header('cache-control', cacheControl.replace(/\bpublic\b/gi, 'private'));
  // undici dekodiert Content-Encoding bereits; die Originallänge wäre dann falsch.
  if (!upstream.headers.get('content-encoding')) {
    const len = upstream.headers.get('content-length');
    if (len) reply.header('content-length', len);
  }
  if (method === 'HEAD' || !upstream.body || status === 204 || status === 304) {
    void upstream.body?.cancel().catch(() => undefined);
    return reply.code(status).send();
  }
  return reply.code(status).send(Readable.fromWeb(upstream.body as never));
}

/** Parser-Hilfe für den API-Endpunkt, der Proxy-Links erzeugt. */
export async function createProxyLink(services: Services, token: string, input: string) {
  const target = parseTargetUrl(input);
  await services.proxyFetcher.assertAllowed(target);
  return { targetUrl: target.href, proxyUrl: toProxyUrl(token, target) };
}
