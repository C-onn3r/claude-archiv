import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { open } from 'node:fs/promises';
import { Readable } from 'node:stream';
import type { Services } from '../app-types.js';
import { userFromContentToken } from '../auth/plugin.js';
import { handleProxyRequest } from '../proxy/proxy-service.js';
import { applyArchiveHeaders, errorPage } from '../proxy/content-headers.js';
import { HttpError } from '../util/errors.js';

const ARCHIVE_URL_RE = /^\/archive\/([^/?#]+)\/([0-9a-f-]{36})\/?([^?#]*)/i;

function htmlError(reply: FastifyReply, status: number, title: string, message: string) {
  return reply.code(status).header('content-type', 'text/html; charset=utf-8').header('cache-control', 'no-store').send(errorPage(status, title, message));
}

/** Parst "bytes=a-b" für einen Datei der Größe `size`. Gibt null bei ungültigem/nicht erfüllbarem Range zurück. */
function parseRange(header: string, size: number): { start: number; end: number } | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start: number;
  let end: number;
  if (m[1] === '') {
    const suffix = Number(m[2]);
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  return start <= end && start < size ? { start, end } : null;
}

/**
 * Auslieferung von Fremdinhalten: Live-Proxy (/proxy/…) und lokale Archive (/archive/…).
 * Diese Routen leben in einem eigenen Plugin-Scope ohne Helmet/CORS/Rate-Limit der API, setzen aber eigene,
 * strengere Header (siehe content-headers.ts) und authentifizieren über das Content-Token im Pfad.
 */
const contentRoutes: FastifyPluginAsync = async (app) => {
  const services: Services = app.services;

  // Beliebige Request-Bodies (Formulare, JSON, Binärdaten) unverändert an das Ziel durchreichen.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: 10 * 1024 * 1024 }, (_req, body, done) => done(null, body));

  app.setErrorHandler((err: Error, request, reply) => {
    const status = err instanceof HttpError ? err.statusCode : ((err as { statusCode?: number }).statusCode ?? 500);
    if (status >= 500) request.log.error({ err }, 'content route failed');
    return htmlError(reply, status, 'Fehler', status >= 500 && !(err instanceof HttpError) ? 'Interner Fehler.' : err.message);
  });

  // --- Live-Proxy ---------------------------------------------------------------------------------
  app.route({
    method: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    url: '/proxy/*',
    handler: (request, reply) => handleProxyRequest(services, request, reply),
  });

  // --- Archive ------------------------------------------------------------------------------------
  app.route({
    method: ['GET', 'HEAD'],
    url: '/archive/*',
    handler: async (request, reply) => {
      applyArchiveHeaders(reply);
      const m = ARCHIVE_URL_RE.exec(request.raw.url ?? '');
      if (!m) return htmlError(reply, 400, 'Ungültige Adresse', 'Die Archiv-Adresse konnte nicht gelesen werden.');
      const [, token, id, rawPath] = m as unknown as [string, string, string, string, string];

      const user = await userFromContentToken(services, token);
      if (!user) return htmlError(reply, 401, 'Sitzung abgelaufen', 'Der Zugriffslink ist abgelaufen. Bitte das Archiv in der App erneut öffnen.');
      const archive = services.archives.findOwned(id, user.id);
      if (!archive || archive.status !== 'done') return htmlError(reply, 404, 'Archiv nicht gefunden', 'Dieses Archiv existiert nicht oder ist noch nicht fertig.');

      let relPath: string;
      try {
        relPath = decodeURIComponent(rawPath);
      } catch {
        return htmlError(reply, 400, 'Ungültige Adresse', 'Der Pfad ist nicht korrekt kodiert.');
      }
      if (relPath === '') relPath = archive.entry_path;

      const resource = services.archives.findResourceByPath(id, relPath);
      const full = resource && services.archiveStorage.resolve(id, relPath);
      const stat = full ? await services.archiveStorage.statFile(full) : null;
      if (!resource || !full || !stat) return htmlError(reply, 404, 'Datei nicht im Archiv', `„${relPath}“ wurde bei der Archivierung nicht erfasst.`);

      reply.header('content-type', resource.mime ?? 'application/octet-stream');
      reply.header('last-modified', stat.mtime.toUTCString());
      reply.header('cache-control', 'private, max-age=3600');
      reply.header('accept-ranges', 'bytes');

      const rangeHeader = request.headers.range;
      if (rangeHeader) {
        const range = parseRange(rangeHeader, stat.size);
        if (!range) return reply.code(416).header('content-range', `bytes */${stat.size}`).send();
        reply.code(206).header('content-range', `bytes ${range.start}-${range.end}/${stat.size}`).header('content-length', range.end - range.start + 1);
        if (request.method === 'HEAD') return reply.send();
        const handle = await open(full);
        return reply.send(Readable.from(handle.createReadStream({ start: range.start, end: range.end })));
      }
      reply.header('content-length', stat.size);
      if (request.method === 'HEAD') return reply.send();
      return reply.send(services.archiveStorage.openRead(full));
    },
  });
};

export default contentRoutes;
