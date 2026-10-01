import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';

export const API_VERSION = '1.0.0';

const metaRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const { services } = app;

  app.get('/health', { schema: { tags: ['meta'], response: { 200: Type.Object({ status: Type.Literal('ok') }) } } }, async () => ({
    status: 'ok' as const,
  }));

  app.get(
    '/meta',
    {
      schema: {
        tags: ['meta'],
        summary: 'Server-Fähigkeiten (für Clients, z. B. Android-App, beim Verbindungsaufbau)',
        response: {
          200: Type.Object({
            name: Type.String(),
            apiVersion: Type.String(),
            registrationOpen: Type.Boolean(),
            needsSetup: Type.Boolean({ description: 'true, solange noch kein Benutzer existiert (erster Benutzer wird Admin).' }),
            accessTokenTtlSec: Type.Integer(),
            contentTokenTtlSec: Type.Integer(),
            pdfExport: Type.Boolean({ description: 'true, wenn der Server PDFs erzeugen kann (Chromium vorhanden).' }),
          }),
        },
      },
    },
    async () => {
      const needsSetup = services.users.count() === 0;
      return {
        name: 'Web-Archivierer',
        apiVersion: API_VERSION,
        registrationOpen: needsSetup || services.config.allowRegistration,
        needsSetup,
        accessTokenTtlSec: services.config.accessTokenTtlSec,
        contentTokenTtlSec: services.config.contentTokenTtlSec,
        pdfExport: services.pdf.available,
      };
    },
  );
};

export default metaRoutes;
