import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';
import { hashPassword } from '../auth/passwords.js';
import { HttpError } from '../util/errors.js';
import { toPublicUser } from '../repos/users.js';
import { UserSchema, errorResponses, password, username } from './schemas.js';

const Role = Type.Union([Type.Literal('admin'), Type.Literal('user')]);

/** Benutzerverwaltung (nur Administratoren). */
const userRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const { services } = app;
  const security = [{ bearerAuth: [] }];

  app.get(
    '',
    { onRequest: app.requireAdmin, schema: { tags: ['users'], security, response: { 200: Type.Array(UserSchema), ...errorResponses } } },
    async () => services.users.list().map(toPublicUser),
  );

  app.post(
    '',
    {
      onRequest: app.requireAdmin,
      schema: {
        tags: ['users'],
        security,
        body: Type.Object({ username, password, displayName: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })), role: Type.Optional(Role) }),
        response: { 201: UserSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const { username: name, password: pw, displayName, role } = request.body;
      if (services.users.findByUsername(name)) throw HttpError.conflict('Benutzername ist bereits vergeben.', 'username_taken');
      const user = services.users.create({
        username: name,
        displayName: displayName?.trim() || name,
        passwordHash: await hashPassword(pw),
        role: role ?? 'user',
      });
      return reply.code(201).send(toPublicUser(user));
    },
  );

  app.patch(
    '/:id',
    {
      onRequest: app.requireAdmin,
      schema: {
        tags: ['users'],
        security,
        params: Type.Object({ id: Type.String() }),
        body: Type.Object({ displayName: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })), role: Type.Optional(Role), password: Type.Optional(password) }),
        response: { 200: UserSchema, ...errorResponses },
      },
    },
    async (request) => {
      const target = services.users.findById(request.params.id);
      if (!target) throw HttpError.notFound('Benutzer nicht gefunden.');
      const { displayName, role, password: pw } = request.body;
      if (role && role !== target.role && target.role === 'admin' && services.users.countAdmins() <= 1) {
        throw HttpError.conflict('Der letzte Administrator kann nicht herabgestuft werden.', 'last_admin');
      }
      services.users.update(target.id, { displayName: displayName?.trim(), role });
      if (pw) {
        services.users.setPassword(target.id, await hashPassword(pw));
        services.refreshTokens.revokeAllForUser(target.id);
      }
      return toPublicUser(services.users.findById(target.id)!);
    },
  );

  app.delete(
    '/:id',
    {
      onRequest: app.requireAdmin,
      schema: { tags: ['users'], security, params: Type.Object({ id: Type.String() }), response: { 204: Type.Null(), ...errorResponses } },
    },
    async (request, reply) => {
      const target = services.users.findById(request.params.id);
      if (!target) throw HttpError.notFound('Benutzer nicht gefunden.');
      if (target.id === request.user!.id) throw HttpError.conflict('Das eigene Konto kann nicht gelöscht werden.', 'self_delete');
      if (target.role === 'admin' && services.users.countAdmins() <= 1) {
        throw HttpError.conflict('Der letzte Administrator kann nicht gelöscht werden.', 'last_admin');
      }
      await services.archiveService.removeAllForUser(target.id);
      services.users.delete(target.id);
      return reply.code(204).send(null);
    },
  );
};

export default userRoutes;
