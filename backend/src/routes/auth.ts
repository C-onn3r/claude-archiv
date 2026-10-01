import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';
import { hashPassword, verifyPassword, DUMMY_HASH } from '../auth/passwords.js';
import { HttpError } from '../util/errors.js';
import { randomToken, sha256Hex } from '../util/ids.js';
import { toPublicUser, type UserRow } from '../repos/users.js';
import { TokenPairSchema, UserSchema, errorResponses, password, username } from './schemas.js';
import type { Services } from '../app-types.js';

export async function issueTokenPair(services: Services, user: UserRow, userAgent?: string) {
  const refreshToken = randomToken(48);
  const expires = new Date(Date.now() + services.config.refreshTokenTtlSec * 1000);
  services.refreshTokens.create(user.id, sha256Hex(refreshToken), expires, userAgent);
  return {
    accessToken: await services.tokens.signAccess(user),
    refreshToken,
    tokenType: 'Bearer' as const,
    expiresIn: services.config.accessTokenTtlSec,
    user: toPublicUser(user),
  };
}

const isUniqueViolation = (err: unknown) => (err as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE';

const authRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const { services } = app;
  const limit = { rateLimit: { max: services.config.rateLimit.auth, timeWindow: '1 minute' } };

  app.post(
    '/register',
    {
      config: limit,
      schema: {
        tags: ['auth'],
        summary: 'Konto anlegen. Der erste Benutzer wird Administrator; danach nur wenn ALLOW_REGISTRATION=true.',
        body: Type.Object({ username, password, displayName: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })) }),
        response: { 201: TokenPairSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const first = services.users.count() === 0;
      if (!first && !services.config.allowRegistration) {
        throw HttpError.forbidden('Die Selbstregistrierung ist deaktiviert.', 'registration_disabled');
      }
      const { username: name, password: pw, displayName } = request.body;
      try {
        const user = services.users.create({
          username: name,
          displayName: displayName?.trim() || name,
          passwordHash: await hashPassword(pw),
          role: first ? 'admin' : 'user',
        });
        reply.code(201);
        return await issueTokenPair(services, user, request.headers['user-agent']);
      } catch (err) {
        if (isUniqueViolation(err)) throw HttpError.conflict('Benutzername ist bereits vergeben.', 'username_taken');
        throw err;
      }
    },
  );

  app.post(
    '/login',
    {
      config: limit,
      schema: {
        tags: ['auth'],
        summary: 'Anmelden – liefert Access- und Refresh-Token',
        body: Type.Object({ username: Type.String({ maxLength: 64 }), password: Type.String({ maxLength: 128 }) }),
        response: { 200: TokenPairSchema, ...errorResponses },
      },
    },
    async (request) => {
      const user = services.users.findByUsername(request.body.username);
      const ok = await verifyPassword(request.body.password, user?.password_hash ?? DUMMY_HASH);
      if (!user || !ok) throw HttpError.unauthorized('Benutzername oder Passwort falsch.', 'invalid_credentials');
      return issueTokenPair(services, user, request.headers['user-agent']);
    },
  );

  app.post(
    '/refresh',
    {
      config: limit,
      schema: {
        tags: ['auth'],
        summary: 'Neues Token-Paar gegen ein Refresh-Token tauschen (Rotation; Wiederverwendung widerruft alle Sitzungen)',
        body: Type.Object({ refreshToken: Type.String({ minLength: 10, maxLength: 200 }) }),
        response: { 200: TokenPairSchema, ...errorResponses },
      },
    },
    async (request) => {
      const row = services.refreshTokens.findByHash(sha256Hex(request.body.refreshToken));
      if (!row) throw HttpError.unauthorized('Refresh-Token ungültig.', 'token_invalid');
      if (row.revoked_at) {
        // Ein bereits benutztes Token taucht erneut auf: Diebstahl nicht ausgeschlossen → alle Sitzungen beenden.
        services.refreshTokens.revokeAllForUser(row.user_id);
        throw HttpError.unauthorized('Refresh-Token wurde bereits verwendet.', 'token_reused');
      }
      if (new Date(row.expires_at).getTime() < Date.now()) throw HttpError.unauthorized('Refresh-Token abgelaufen.', 'token_expired');
      const user = services.users.findById(row.user_id);
      if (!user) throw HttpError.unauthorized('Refresh-Token ungültig.', 'token_invalid');
      services.refreshTokens.revoke(row.id);
      return issueTokenPair(services, user, request.headers['user-agent']);
    },
  );

  app.post(
    '/logout',
    {
      schema: {
        tags: ['auth'],
        summary: 'Refresh-Token widerrufen',
        body: Type.Object({ refreshToken: Type.String({ maxLength: 200 }) }),
        response: { 204: Type.Null(), ...errorResponses },
      },
    },
    async (request, reply) => {
      const row = services.refreshTokens.findByHash(sha256Hex(request.body.refreshToken));
      if (row) services.refreshTokens.revoke(row.id);
      return reply.code(204).send(null);
    },
  );

  app.get(
    '/me',
    {
      onRequest: app.authenticate,
      schema: { tags: ['auth'], security: [{ bearerAuth: [] }], summary: 'Aktueller Benutzer', response: { 200: UserSchema, ...errorResponses } },
    },
    async (request) => toPublicUser(request.user!),
  );

  app.patch(
    '/me',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['auth'],
        security: [{ bearerAuth: [] }],
        summary: 'Profil ändern. Bei Passwortwechsel werden alle anderen Sitzungen beendet und ein neues Token-Paar geliefert.',
        body: Type.Object({
          displayName: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
          currentPassword: Type.Optional(Type.String({ maxLength: 128 })),
          newPassword: Type.Optional(password),
        }),
        response: { 200: Type.Object({ user: UserSchema, tokens: Type.Optional(TokenPairSchema) }), ...errorResponses },
      },
    },
    async (request) => {
      const me = request.user!;
      const { displayName, currentPassword, newPassword } = request.body;
      if (displayName) services.users.update(me.id, { displayName: displayName.trim() });
      let tokens;
      if (newPassword) {
        if (!currentPassword || !(await verifyPassword(currentPassword, me.password_hash))) {
          throw HttpError.forbidden('Aktuelles Passwort ist falsch.', 'invalid_credentials');
        }
        services.users.setPassword(me.id, await hashPassword(newPassword));
        services.refreshTokens.revokeAllForUser(me.id);
        tokens = await issueTokenPair(services, services.users.findById(me.id)!, request.headers['user-agent']);
      }
      return { user: toPublicUser(services.users.findById(me.id)!), tokens };
    },
  );
};

export default authRoutes;
