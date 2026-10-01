import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, register, type TestApp } from './helpers.js';

describe('Authentifizierung & Benutzerverwaltung', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({ allowRegistration: false });
  });
  afterAll(() => t.cleanup());

  it('erster Benutzer wird Admin, weitere Registrierung ist gesperrt', async () => {
    const meta1 = (await t.app.inject({ method: 'GET', url: '/api/v1/meta' })).json();
    expect(meta1.needsSetup).toBe(true);
    const admin = await register(t.app, 'alice');
    expect(admin.user.role).toBe('admin');
    const second = await t.app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { username: 'bob', password: 'passwort123' } });
    expect(second.statusCode).toBe(403);
    expect(second.json().error.code).toBe('registration_disabled');
    expect((await t.app.inject({ method: 'GET', url: '/api/v1/meta' })).json().registrationOpen).toBe(false);
  });

  it('Login: richtige/falsche Zugangsdaten, Validierung', async () => {
    const bad = await t.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'alice', password: 'falsch' } });
    expect(bad.statusCode).toBe(401);
    expect(bad.json().error.code).toBe('invalid_credentials');
    const unknown = await t.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'nobody', password: 'x' } });
    expect(unknown.statusCode).toBe(401);
    const invalid = await t.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'alice' } });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe('validation_error');
    const ok = await t.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'ALICE', password: 'passwort123' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().tokenType).toBe('Bearer');
  });

  it('geschützte Routen verlangen ein gültiges Access-Token', async () => {
    expect((await t.app.inject({ method: 'GET', url: '/api/v1/archives' })).statusCode).toBe(401);
    expect((await t.app.inject({ method: 'GET', url: '/api/v1/archives', headers: { authorization: 'Bearer abc.def.ghi' } })).statusCode).toBe(401);
    const login = (await t.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'alice', password: 'passwort123' } })).json();
    const me = await t.app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { authorization: `Bearer ${login.accessToken}` } });
    expect(me.statusCode).toBe(200);
    expect(me.json().username).toBe('alice');
    // Ein Content-Token darf nicht als Access-Token funktionieren.
    const link = (await t.app.inject({ method: 'POST', url: '/api/v1/proxy/links', headers: { authorization: `Bearer ${login.accessToken}` }, payload: { url: 'http://127.0.0.1:1/' } })).json();
    const contentToken = link.proxyUrl.split('/')[2];
    expect((await t.app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { authorization: `Bearer ${contentToken}` } })).statusCode).toBe(401);
  });

  it('Refresh-Rotation und Wiederverwendungserkennung', async () => {
    const login = (await t.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'alice', password: 'passwort123' } })).json();
    const r1 = await t.app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken: login.refreshToken } });
    expect(r1.statusCode).toBe(200);
    const fresh = r1.json();
    expect(fresh.refreshToken).not.toBe(login.refreshToken);
    // altes Token erneut → Diebstahlverdacht, alle Sitzungen widerrufen
    const reuse = await t.app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken: login.refreshToken } });
    expect(reuse.statusCode).toBe(401);
    expect(reuse.json().error.code).toBe('token_reused');
    const afterRevoke = await t.app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken: fresh.refreshToken } });
    expect(afterRevoke.statusCode).toBe(401);
  });

  it('Logout widerruft das Refresh-Token', async () => {
    const login = (await t.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'alice', password: 'passwort123' } })).json();
    const out = await t.app.inject({ method: 'POST', url: '/api/v1/auth/logout', payload: { refreshToken: login.refreshToken } });
    expect(out.statusCode).toBe(204);
    expect((await t.app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken: login.refreshToken } })).statusCode).toBe(401);
  });

  it('Passwortwechsel invalidiert alte Tokens und liefert neue', async () => {
    const login = (await t.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'alice', password: 'passwort123' } })).json();
    const auth = { authorization: `Bearer ${login.accessToken}` };
    const wrong = await t.app.inject({ method: 'PATCH', url: '/api/v1/auth/me', headers: auth, payload: { currentPassword: 'nope', newPassword: 'neuesPasswort1' } });
    expect(wrong.statusCode).toBe(403);
    const res = await t.app.inject({ method: 'PATCH', url: '/api/v1/auth/me', headers: auth, payload: { currentPassword: 'passwort123', newPassword: 'neuesPasswort1' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().tokens.accessToken).toBeTruthy();
    expect((await t.app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: auth })).statusCode).toBe(401);
    expect((await t.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'alice', password: 'neuesPasswort1' } })).statusCode).toBe(200);
  });

  it('Admin verwaltet Benutzer; normale Benutzer haben keinen Zugriff; letzter Admin ist geschützt', async () => {
    const admin = (await t.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'alice', password: 'neuesPasswort1' } })).json();
    const aAuth = { authorization: `Bearer ${admin.accessToken}` };
    const created = await t.app.inject({ method: 'POST', url: '/api/v1/users', headers: aAuth, payload: { username: 'bob', password: 'passwort123', displayName: 'Bob' } });
    expect(created.statusCode).toBe(201);
    expect(created.json().role).toBe('user');
    const dup = await t.app.inject({ method: 'POST', url: '/api/v1/users', headers: aAuth, payload: { username: 'BOB', password: 'passwort123' } });
    expect(dup.statusCode).toBe(409);

    const bob = (await t.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'bob', password: 'passwort123' } })).json();
    expect((await t.app.inject({ method: 'GET', url: '/api/v1/users', headers: { authorization: `Bearer ${bob.accessToken}` } })).statusCode).toBe(403);

    expect((await t.app.inject({ method: 'GET', url: '/api/v1/users', headers: aAuth })).json()).toHaveLength(2);
    const demote = await t.app.inject({ method: 'PATCH', url: `/api/v1/users/${admin.user.id}`, headers: aAuth, payload: { role: 'user' } });
    expect(demote.statusCode).toBe(409);
    const selfDelete = await t.app.inject({ method: 'DELETE', url: `/api/v1/users/${admin.user.id}`, headers: aAuth });
    expect(selfDelete.statusCode).toBe(409);

    const del = await t.app.inject({ method: 'DELETE', url: `/api/v1/users/${bob.user.id}`, headers: aAuth });
    expect(del.statusCode).toBe(204);
    // Tokens gelöschter Benutzer sind sofort ungültig
    expect((await t.app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { authorization: `Bearer ${bob.accessToken}` } })).statusCode).toBe(401);
  });
});
