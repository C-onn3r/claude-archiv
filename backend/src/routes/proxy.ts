import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';
import { createProxyLink } from '../proxy/proxy-service.js';
import { errorResponses } from './schemas.js';

/**
 * Proxy-API: erzeugt eine Proxy-URL für ein Ziel. Die eigentliche Auslieferung passiert unter /proxy/… (siehe routes/content.ts),
 * weil iframes/WebViews keine Authorization-Header senden können – das Content-Token steckt deshalb im Pfad.
 */
const proxyRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const { services } = app;

  app.post(
    '/links',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['proxy'],
        security: [{ bearerAuth: [] }],
        summary: 'Proxy-URL für eine Ziel-URL erzeugen',
        description:
          'Gibt einen serverrelativen Pfad zurück (`proxyUrl`), der im iframe bzw. in der Android-WebView geladen wird: ' +
          '`GET {serverBase}{proxyUrl}`. Alle Links/Assets der Seite werden serverseitig umgeschrieben, sodass die Navigation im Proxy bleibt.',
        body: Type.Object({ url: Type.String({ minLength: 1, maxLength: 4096 }) }),
        response: {
          200: Type.Object({ targetUrl: Type.String(), proxyUrl: Type.String(), expiresAt: Type.String() }),
          ...errorResponses,
        },
      },
    },
    async (request) => {
      const content = await services.tokens.signContent(request.user!);
      const link = await createProxyLink(services, content.token, request.body.url);
      return { ...link, expiresAt: content.expiresAt };
    },
  );
};

export default proxyRoutes;
