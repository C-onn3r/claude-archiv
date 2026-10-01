import fp from 'fastify-plugin';
import type { FastifyRequest } from 'fastify';
import type { Services } from '../app-types.js';
import { HttpError } from '../util/errors.js';
import type { UserRow } from '../repos/users.js';

/** Löst ein Content-Token (aus Proxy-/Archiv-URLs) in einen gültigen Benutzer auf. */
export async function userFromContentToken(services: Services, token: string): Promise<UserRow | null> {
  const claims = await services.tokens.verify(token, 'content');
  if (!claims) return null;
  const user = services.users.findById(claims.sub);
  return user && user.token_version === claims.tv ? user : null;
}

export default fp(async (app) => {
  const { services } = app;
  app.decorateRequest('user', null);

  app.decorate('authenticate', async (request: FastifyRequest) => {
    const header = request.headers.authorization;
    const match = header ? /^Bearer\s+(.+)$/i.exec(header) : null;
    if (!match) throw HttpError.unauthorized();
    const claims = await services.tokens.verify(match[1]!, 'access');
    if (!claims) throw HttpError.unauthorized('Token ungültig oder abgelaufen.', 'token_invalid');
    const user = services.users.findById(claims.sub);
    if (!user || user.token_version !== claims.tv) {
      throw HttpError.unauthorized('Token ungültig oder abgelaufen.', 'token_invalid');
    }
    request.user = user;
  });

  app.decorate('requireAdmin', async (request: FastifyRequest) => {
    await app.authenticate(request);
    if (request.user?.role !== 'admin') throw HttpError.forbidden('Nur für Administratoren.');
  });
});
