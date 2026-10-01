import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import fastifyStatic from '@fastify/static';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { existsSync } from 'node:fs';
import path from 'node:path';
import './app-types.js';
import authPlugin from './auth/plugin.js';
import { loadConfig, type Config } from './config.js';
import { createServices } from './services.js';
import { HttpError } from './util/errors.js';
import authRoutes from './routes/auth.js';
import archiveRoutes from './routes/archives.js';
import contentRoutes from './routes/content.js';
import metaRoutes, { API_VERSION } from './routes/meta.js';
import proxyRoutes from './routes/proxy.js';
import userRoutes from './routes/users.js';
import { ErrorResponse } from './routes/schemas.js';

/** Token-Anteile aus Content-URLs nicht in Logs schreiben. */
const redactUrl = (url: string): string => url.replace(/^(\/(?:proxy|archive)\/)[^/?#]+/, '$1:token');

export async function buildApp(config: Config = loadConfig()): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      config.env === 'test'
        ? false
        : {
            level: process.env.LOG_LEVEL ?? 'info',
            serializers: {
              req: (req) => ({ method: req.method, url: redactUrl(req.url ?? ''), remoteAddress: req.socket?.remoteAddress }),
            },
          },
    trustProxy: config.trustProxy,
    bodyLimit: 1024 * 1024,
    routerOptions: { maxParamLength: 512 },
  }).withTypeProvider<TypeBoxTypeProvider>();

  const services = createServices(config, app.log);
  app.decorate('services', services);

  app.setErrorHandler((err: Error & { statusCode?: number; validation?: unknown; code?: string }, request, reply) => {
    if (err instanceof HttpError) return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } });
    if (err.validation) return reply.code(400).send({ error: { code: 'validation_error', message: err.message } });
    const status = err.statusCode ?? 500;
    if (status === 429) return reply.code(429).send({ error: { code: 'rate_limited', message: 'Zu viele Anfragen. Bitte später erneut versuchen.' } });
    if (status >= 400 && status < 500) return reply.code(status).send({ error: { code: err.code ?? 'bad_request', message: err.message } });
    request.log.error({ err }, 'unhandled error');
    return reply.code(500).send({ error: { code: 'internal_error', message: 'Interner Serverfehler.' } });
  });

  app.setNotFoundHandler((request, reply) => {
    const url = request.raw.url ?? '/';
    const wantsHtml = request.method === 'GET' && (request.headers.accept ?? '').includes('text/html');
    const spaIndex = config.frontendDir && path.join(config.frontendDir, 'index.html');
    if (wantsHtml && !url.startsWith('/api/') && spaIndex && existsSync(spaIndex)) {
      return reply.header('cache-control', 'no-cache').type('text/html; charset=utf-8').sendFile('index.html', config.frontendDir!);
    }
    return reply.code(404).send({ error: { code: 'not_found', message: 'Nicht gefunden.' } });
  });

  // --- Web-Scope: API, Dokumentation, Frontend (mit Helmet, CORS, Rate-Limit) --------------------------
  await app.register(async (web) => {
    web.addSchema(ErrorResponse);

    await web.register(helmet, {
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          frameSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          frameAncestors: ["'self'"],
          upgradeInsecureRequests: null,
        },
      },
    });
    await web.register(cors, {
      origin: config.corsOrigins.length > 0 ? config.corsOrigins : false,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['authorization', 'content-type'],
    });
    await web.register(rateLimit, { global: true, max: config.rateLimit.global, timeWindow: '1 minute' });

    await web.register(swagger, {
      openapi: {
        openapi: '3.0.3',
        info: {
          title: 'Web-Archivierer & Proxy API',
          version: API_VERSION,
          description:
            'REST-API für Authentifizierung, Proxy-Links, Archivierung und Archiv-Abruf. ' +
            'Authentifizierung per `Authorization: Bearer <accessToken>`; Tokens per `/auth/login` bzw. `/auth/refresh`.',
        },
        components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
        tags: [
          { name: 'meta' },
          { name: 'auth', description: 'Anmeldung & Profil' },
          { name: 'users', description: 'Benutzerverwaltung (Admin)' },
          { name: 'proxy', description: 'Live-Proxy' },
          { name: 'archives', description: 'Archive' },
        ],
      },
    });
    await web.register(swaggerUi, { routePrefix: '/api/docs', staticCSP: true });

    await web.register(authPlugin);
    await web.register(
      async (api) => {
        await api.register(metaRoutes);
        await api.register(authRoutes, { prefix: '/auth' });
        await api.register(userRoutes, { prefix: '/users' });
        await api.register(proxyRoutes, { prefix: '/proxy' });
        await api.register(archiveRoutes, { prefix: '/archives' });
      },
      { prefix: '/api/v1' },
    );

    if (config.frontendDir && existsSync(config.frontendDir)) {
      await web.register(fastifyStatic, {
        root: config.frontendDir,
        wildcard: true,
        index: ['index.html'],
        setHeaders: (res, filePath) => {
          res.header('cache-control', filePath.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
        },
      });
    }
  });

  // --- Content-Scope: Proxy & Archive (eigene Header, eigener Error-Handler) ---------------------------
  await app.register(contentRoutes);

  app.addHook('onReady', async () => {
    services.archiveService.start();
  });
  app.addHook('onClose', async () => {
    await services.archiveService.shutdown();
    await services.proxyFetcher.close();
    services.db.close();
  });
  return app;
}
