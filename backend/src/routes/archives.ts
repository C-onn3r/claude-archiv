import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';
import archiver from 'archiver';
import { HttpError } from '../util/errors.js';
import { toPublicArchive, type ArchiveRow } from '../repos/archives.js';
import { ArchiveSchema, errorResponses } from './schemas.js';

const Id = Type.Object({ id: Type.String({ minLength: 36, maxLength: 36 }) });

const archiveRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const { services } = app;
  const { archives, archiveService } = services;
  const security = [{ bearerAuth: [] }];
  const auth = { onRequest: app.authenticate };

  const owned = (id: string, userId: string): ArchiveRow => {
    const row = archives.findOwned(id, userId);
    if (!row) throw HttpError.notFound('Archiv nicht gefunden.');
    return row;
  };

  app.post(
    '',
    {
      ...auth,
      schema: {
        tags: ['archives'],
        security,
        summary: 'Archivierung starten (asynchron)',
        description: 'Legt den Auftrag an und antwortet sofort mit 202. Fortschritt über `GET /archives/{id}` (status: pending → running → done | failed).',
        body: Type.Object({
          url: Type.String({ minLength: 1, maxLength: 4096 }),
          title: Type.Optional(Type.String({ maxLength: 300 })),
          includeScripts: Type.Optional(Type.Boolean({ default: true, description: 'JavaScript mitarchivieren. false = statischer Schnappschuss ohne Skripte.' })),
          tags: Type.Optional(Type.Array(Type.String({ maxLength: 40 }), { maxItems: 20 })),
        }),
        response: { 202: ArchiveSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const { url, title, includeScripts, tags } = request.body;
      const row = await archiveService.create(request.user!.id, url, { includeScripts: includeScripts ?? true });
      const updated = title || tags ? archives.update(row.id, { title: title?.trim() || undefined, tags: tags?.map((t) => t.trim()).filter(Boolean) }) : row;
      return reply.code(202).send(toPublicArchive(updated ?? row));
    },
  );

  app.get(
    '',
    {
      ...auth,
      schema: {
        tags: ['archives'],
        security,
        summary: 'Eigene Archive auflisten (neueste zuerst)',
        querystring: Type.Object({
          q: Type.Optional(Type.String({ maxLength: 200 })),
          status: Type.Optional(Type.Union([Type.Literal('pending'), Type.Literal('running'), Type.Literal('done'), Type.Literal('failed')])),
          tag: Type.Optional(Type.String({ maxLength: 40 })),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 25 })),
          offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
        }),
        response: {
          200: Type.Object({ items: Type.Array(ArchiveSchema), total: Type.Integer(), limit: Type.Integer(), offset: Type.Integer() }),
          ...errorResponses,
        },
      },
    },
    async (request) => {
      const { q, status, tag, limit = 25, offset = 0 } = request.query;
      const { items, total } = archives.list({ userId: request.user!.id, q, status, tag, limit, offset });
      return { items: items.map(toPublicArchive), total, limit, offset };
    },
  );

  app.get(
    '/:id',
    { ...auth, schema: { tags: ['archives'], security, params: Id, response: { 200: ArchiveSchema, ...errorResponses } } },
    async (request) => toPublicArchive(owned(request.params.id, request.user!.id)),
  );

  app.patch(
    '/:id',
    {
      ...auth,
      schema: {
        tags: ['archives'],
        security,
        params: Id,
        body: Type.Object({
          title: Type.Optional(Type.String({ minLength: 1, maxLength: 300 })),
          description: Type.Optional(Type.String({ maxLength: 2000 })),
          tags: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 40 }), { maxItems: 20 })),
        }),
        response: { 200: ArchiveSchema, ...errorResponses },
      },
    },
    async (request) => {
      owned(request.params.id, request.user!.id);
      const { title, description, tags } = request.body;
      const updated = archives.update(request.params.id, {
        title: title?.trim(),
        description: description?.trim(),
        tags: tags ? [...new Set(tags.map((t) => t.trim()).filter(Boolean))] : undefined,
      });
      return toPublicArchive(updated!);
    },
  );

  app.delete(
    '/:id',
    { ...auth, schema: { tags: ['archives'], security, params: Id, response: { 204: Type.Null(), ...errorResponses } } },
    async (request, reply) => {
      owned(request.params.id, request.user!.id);
      await archiveService.remove(request.params.id);
      return reply.code(204).send(null);
    },
  );

  app.post(
    '/:id/retry',
    { ...auth, schema: { tags: ['archives'], security, summary: 'Fehlgeschlagene Archivierung erneut starten', params: Id, response: { 202: ArchiveSchema, ...errorResponses } } },
    async (request, reply) => {
      const row = archiveService.retry(owned(request.params.id, request.user!.id));
      return reply.code(202).send(toPublicArchive(row));
    },
  );

  app.get(
    '/:id/resources',
    {
      ...auth,
      schema: {
        tags: ['archives'],
        security,
        summary: 'Alle erfassten (und fehlgeschlagenen) Ressourcen eines Archivs',
        params: Id,
        response: {
          200: Type.Array(
            Type.Object({
              url: Type.String(),
              path: Type.Union([Type.String(), Type.Null()]),
              mime: Type.Union([Type.String(), Type.Null()]),
              size: Type.Integer(),
              status: Type.Union([Type.Literal('stored'), Type.Literal('failed'), Type.Literal('skipped')]),
              error: Type.Union([Type.String(), Type.Null()]),
            }),
          ),
          ...errorResponses,
        },
      },
    },
    async (request) => {
      owned(request.params.id, request.user!.id);
      return archives.listResources(request.params.id).map((r) => ({ url: r.url, path: r.local_path, mime: r.mime, size: r.size, status: r.status, error: r.error }));
    },
  );

  app.get(
    '/:id/view',
    {
      ...auth,
      schema: {
        tags: ['archives'],
        security,
        summary: 'Offline-Ansicht eines Archivs',
        description: 'Liefert einen serverrelativen Pfad (`viewUrl`) für iframe/WebView: `GET {serverBase}{viewUrl}`. Das Token ist im Pfad enthalten und läuft ab (`expiresAt`).',
        params: Id,
        response: { 200: Type.Object({ viewUrl: Type.String(), expiresAt: Type.String() }), ...errorResponses },
      },
    },
    async (request) => {
      const row = owned(request.params.id, request.user!.id);
      if (row.status !== 'done') throw HttpError.conflict('Das Archiv ist noch nicht fertig.', 'not_ready');
      const content = await services.tokens.signContent(request.user!);
      return { viewUrl: `/archive/${content.token}/${row.id}/${row.entry_path}`, expiresAt: content.expiresAt };
    },
  );

  app.get(
    '/:id/download',
    {
      ...auth,
      schema: {
        tags: ['archives'],
        security,
        summary: 'Archiv als ZIP herunterladen (für lokale Offline-Nutzung, z. B. in der Android-App)',
        params: Id,
      },
    },
    async (request, reply) => {
      const row = owned(request.params.id, request.user!.id);
      if (row.status !== 'done') throw HttpError.conflict('Das Archiv ist noch nicht fertig.', 'not_ready');
      const dir = services.archiveService.storageDir(row.id);
      const zip = archiver('zip', { zlib: { level: 6 } });
      zip.on('error', (err) => request.log.error({ err }, 'zip failed'));
      zip.directory(dir, false);
      zip.append(JSON.stringify({ ...toPublicArchive(row), entryPath: row.entry_path }, null, 2), { name: 'archive.json' });
      void zip.finalize();
      const safeName = (row.title || 'archive').replace(/[^\w.-]+/g, '_').slice(0, 60) || 'archive';
      return reply
        .header('content-type', 'application/zip')
        .header('content-disposition', `attachment; filename="${safeName}.zip"`)
        .send(zip);
    },
  );
};

export default archiveRoutes;
