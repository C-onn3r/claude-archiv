import { existsSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PNG, createTestApp, register, startSampleSite, waitForArchive, type SampleSite, type Session, type TestApp } from './helpers.js';

describe('Archivierungs-Engine', () => {
  let t: TestApp;
  let site: SampleSite;
  let alice: Session;
  let archive: Record<string, any>;
  let viewPrefix: string; // /archive/<token>/<id>

  beforeAll(async () => {
    site = await startSampleSite();
    t = await createTestApp();
    alice = await register(t.app, 'alice');
    const res = await t.app.inject({ method: 'POST', url: '/api/v1/archives', headers: alice.auth, payload: { url: site.origin, tags: ['demo'] } });
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe('pending');
    archive = await waitForArchive(t.app, alice, res.json().id);
    const view = await t.app.inject({ method: 'GET', url: `/api/v1/archives/${archive.id}/view`, headers: alice.auth });
    expect(view.statusCode).toBe(200);
    viewPrefix = view.json().viewUrl.replace(/\/index\.html$/, '');
  });
  afterAll(async () => {
    await t.cleanup();
    await site.close();
  });

  const file = (p: string, headers: Record<string, string> = {}) => t.app.inject({ method: 'GET', url: `${viewPrefix}/${p}`, headers });

  it('schließt erfolgreich ab und erfasst Metadaten', () => {
    expect(archive.status).toBe('done');
    expect(archive.title).toBe('Beispiel Seite');
    expect(archive.description).toBe('Eine Testseite');
    expect(archive.tags).toEqual(['demo']);
    expect(archive.assetCount).toBeGreaterThanOrEqual(8);
    expect(archive.failedCount).toBe(2); // missing.png + f.woff
    expect(archive.totalBytes).toBeGreaterThan(0);
  });

  it('schreibt das Haupt-HTML auf relative lokale Pfade um', async () => {
    const res = await file('index.html');
    expect(res.statusCode).toBe(200);
    const html = res.body;
    expect(html).toMatch(/<link rel="stylesheet" href="assets\/[0-9a-f]{10}-style\.css">/);
    expect(html).toMatch(/<script src="assets\/[0-9a-f]{10}-app\.js">/);
    expect(html).toMatch(/<img src="assets\/[0-9a-f]{10}-logo\.png" srcset="assets\/[0-9a-f]{10}-logo\.png 1x, assets\/[0-9a-f]{10}-logo-2x\.png 2x"/);
    expect(html).toMatch(/<link rel="icon" href="assets\/[0-9a-f]{10}-logo\.png">/);
    expect(html).toMatch(/\.hero\{background:url\("assets\/[0-9a-f]{10}-bg\.png"\)\}/);
    expect(html).toMatch(/style="background-image:url\(&quot;assets\/|style="background-image:url\("assets\//);
    expect(html).toMatch(/<iframe src="pages\/[0-9a-f]{10}-frame\.html">/);
    expect(html).not.toContain('integrity');
    expect(html).not.toContain('preconnect');
    expect(html).not.toContain('<base');
    expect(html).toContain('memoryStorage'); // Storage-Ersatz für Sandbox-Betrieb
    // fehlgeschlagenes Asset bleibt als absolute URL erhalten
    expect(html).toContain(`src="${site.origin}/img/missing.png"`);
    // Links: extern → neuer Tab, Anker bleiben Anker, Selbstverweis wird Anker
    expect(html).toContain('<a id="a2" href="https://external.example/x" target="_blank" rel="noopener noreferrer">');
    expect(html).toContain('<a id="a3" href="#top">');
    expect(html).toContain('<a id="a4" href="#section">');
    expect(html).toContain(`<a id="a1" href="${site.origin}/about"`);
    expect(html).toContain(`name="web-archiver:source" content="${site.origin}/"`);
  });

  it('archiviert CSS rekursiv (inkl. Import-Zyklus, Fonts, Hintergrundbilder)', async () => {
    const html = (await file('index.html')).body;
    const cssPath = /href="(assets\/[0-9a-f]{10}-style\.css)"/.exec(html)![1]!;
    const css = await file(cssPath);
    expect(css.headers['content-type']).toBe('text/css; charset=utf-8');
    // @import auf extra.css → liegt im selben Ordner → nur Dateiname
    const importMatch = /@import "([^"]+)"/.exec(css.body)!;
    expect(importMatch[1]).toMatch(/^[0-9a-f]{10}-extra\.css$/);
    expect(css.body).toMatch(/url\("[0-9a-f]{10}-f\.woff2"\)/);
    expect(css.body).toContain('url(data:image/png;base64,AAAA)');
    expect(css.body).toContain('/* url(ignored.png) */');
    expect(css.body).toMatch(/url\("[0-9a-f]{10}-bg\.png"\)/);
    // fehlender Font (404) bleibt absolut
    expect(css.body).toContain(`url("${site.origin}/fonts/f.woff")`);

    const extra = await file(`assets/${importMatch[1]}`);
    expect(extra.statusCode).toBe(200);
    // Zyklus: extra.css importiert style.css zurück → relativer Verweis auf die archivierte Datei
    expect(extra.body).toContain(`@import url("${cssPath.replace('assets/', '')}")`);
    expect(extra.body).toMatch(/url\("[0-9a-f]{10}-logo\.png"\)/);
  });

  it('liefert Assets mit korrektem MIME-Typ und hermetischer CSP', async () => {
    const html = (await file('index.html')).body;
    const png = /<img src="(assets\/[^"]+\.png)"/.exec(html)![1]!;
    const res = await file(png);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(Buffer.compare(res.rawPayload, PNG)).toBe(0);
    const csp = String(res.headers['content-security-policy']);
    expect(csp).toContain('sandbox allow-scripts');
    expect(csp).not.toContain('allow-same-origin');
    expect(csp).toContain("connect-src 'self'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    const js = await file(/src="(assets\/[^"]+\.js)"/.exec(html)![1]!);
    expect(js.headers['content-type']).toMatch(/javascript/);
    expect(js.body).toBe('window.__loaded = true;');
  });

  it('archiviert gleiche-Origin-iframes als eigene Seite mit korrekten relativen Pfaden', async () => {
    const html = (await file('index.html')).body;
    const frame = /<iframe src="(pages\/[^"]+)"/.exec(html)![1]!;
    const res = await file(frame);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatch(/<img src="\.\.\/assets\/[0-9a-f]{10}-logo\.png">/);
  });

  it('unterstützt Range-Requests und HEAD', async () => {
    const html = (await file('index.html')).body;
    const png = /<img src="(assets\/[^"]+\.png)"/.exec(html)![1]!;
    const part = await file(png, { range: 'bytes=0-3' });
    expect(part.statusCode).toBe(206);
    expect(part.rawPayload.length).toBe(4);
    expect(part.headers['content-range']).toBe(`bytes 0-3/${PNG.length}`);
    expect((await file(png, { range: 'bytes=9999-' })).statusCode).toBe(416);
    const head = await t.app.inject({ method: 'HEAD', url: `${viewPrefix}/${png}` });
    expect(head.statusCode).toBe(200);
    expect(head.headers['content-length']).toBe(String(PNG.length));
  });

  it('verhindert Path Traversal und liefert nur erfasste Dateien', async () => {
    for (const p of ['../../jwt-secret.key', '..%2F..%2Fjwt-secret.key', '%2e%2e/%2e%2e/archiv.db', 'assets/../../x', 'assets/nicht-vorhanden.png', '%00']) {
      const res = await file(p);
      expect([400, 404], p).toContain(res.statusCode);
    }
  });

  it('zeigt Ressourcenliste inkl. Fehlern und liefert ZIP-Export', async () => {
    const res = await t.app.inject({ method: 'GET', url: `/api/v1/archives/${archive.id}/resources`, headers: alice.auth });
    const list = res.json() as { url: string; status: string; path: string | null }[];
    expect(list.filter((r) => r.status === 'failed').map((r) => r.url).sort()).toEqual([`${site.origin}/fonts/f.woff`, `${site.origin}/img/missing.png`]);
    expect(list.find((r) => r.url === `${site.origin}/`)?.path).toBe('index.html');

    const zip = await t.app.inject({ method: 'GET', url: `/api/v1/archives/${archive.id}/download`, headers: alice.auth });
    expect(zip.statusCode).toBe(200);
    expect(zip.headers['content-type']).toBe('application/zip');
    expect(zip.rawPayload.subarray(0, 2).toString()).toBe('PK');
    expect(zip.rawPayload.includes(Buffer.from('index.html'))).toBe(true);
    expect(zip.rawPayload.includes(Buffer.from('archive.json'))).toBe(true);
  });

  it('isoliert Benutzer voneinander', async () => {
    const adminAuth = alice.auth;
    const created = await t.app.inject({ method: 'POST', url: '/api/v1/users', headers: adminAuth, payload: { username: 'bob', password: 'passwort123' } });
    expect(created.statusCode).toBe(201);
    const login = (await t.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'bob', password: 'passwort123' } })).json();
    const bob = { authorization: `Bearer ${login.accessToken}` };
    expect((await t.app.inject({ method: 'GET', url: `/api/v1/archives/${archive.id}`, headers: bob })).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'DELETE', url: `/api/v1/archives/${archive.id}`, headers: bob })).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'GET', url: '/api/v1/archives', headers: bob })).json().total).toBe(0);
    // Bobs Content-Token schaltet Alices Archiv nicht frei
    const { token } = await t.app.services.tokens.signContent(t.app.services.users.findById(login.user.id)!);
    const res = await t.app.inject({ method: 'GET', url: `/archive/${token}/${archive.id}/index.html` });
    expect(res.statusCode).toBe(404);
  });

  it('Listing mit Suche, Filter und Paginierung; PATCH ändert Metadaten', async () => {
    const list = (await t.app.inject({ method: 'GET', url: '/api/v1/archives?q=beispiel&status=done&tag=demo&limit=1', headers: alice.auth })).json();
    expect(list.total).toBe(1);
    expect(list.items[0].id).toBe(archive.id);
    expect((await t.app.inject({ method: 'GET', url: '/api/v1/archives?q=gibtsnicht', headers: alice.auth })).json().total).toBe(0);
    expect((await t.app.inject({ method: 'GET', url: '/api/v1/archives?q=%25', headers: alice.auth })).json().total).toBe(0); // LIKE-Wildcards sind escaped
    const patched = await t.app.inject({ method: 'PATCH', url: `/api/v1/archives/${archive.id}`, headers: alice.auth, payload: { title: 'Neuer Titel', tags: ['a', 'a', 'b'] } });
    expect(patched.json().title).toBe('Neuer Titel');
    expect(patched.json().tags).toEqual(['a', 'b']);
  });

  it('Löschen entfernt Datenbankeintrag und Dateien', async () => {
    const dir = path.join(t.config.archivesDir, archive.id);
    expect(existsSync(dir)).toBe(true);
    const del = await t.app.inject({ method: 'DELETE', url: `/api/v1/archives/${archive.id}`, headers: alice.auth });
    expect(del.statusCode).toBe(204);
    expect(existsSync(dir)).toBe(false);
    expect((await t.app.inject({ method: 'GET', url: `/api/v1/archives/${archive.id}`, headers: alice.auth })).statusCode).toBe(404);
    expect((await file('index.html')).statusCode).toBe(404);
  });
});

describe('Archivierung: Sonderfälle', () => {
  let t: TestApp;
  let site: SampleSite;
  let alice: Session;
  beforeAll(async () => {
    site = await startSampleSite();
    t = await createTestApp();
    alice = await register(t.app, 'alice');
  });
  afterAll(async () => {
    await t.cleanup();
    await site.close();
  });

  it('includeScripts=false entfernt Skripte und Event-Handler', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/api/v1/archives', headers: alice.auth, payload: { url: site.origin, includeScripts: false } });
    const done = await waitForArchive(t.app, alice, res.json().id);
    expect(done.status).toBe('done');
    const { viewUrl } = (await t.app.inject({ method: 'GET', url: `/api/v1/archives/${done.id}/view`, headers: alice.auth })).json();
    const html = (await t.app.inject({ method: 'GET', url: viewUrl })).body;
    expect(html).not.toContain('<script');
    const resources = (await t.app.inject({ method: 'GET', url: `/api/v1/archives/${done.id}/resources`, headers: alice.auth })).json();
    expect(resources.some((r: { url: string }) => r.url.endsWith('/app.js'))).toBe(false);
  });

  it('folgt Weiterleitungen und speichert die End-URL', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/api/v1/archives', headers: alice.auth, payload: { url: `${site.origin}/redirect` } });
    const done = await waitForArchive(t.app, alice, res.json().id);
    expect(done.status).toBe('done');
    expect(done.finalUrl).toBe(`${site.origin}/about?from=redirect`);
    expect(done.title).toBe('Über');
  });

  it('meldet HTTP-Fehler als fehlgeschlagen und erlaubt Retry', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/api/v1/archives', headers: alice.auth, payload: { url: `${site.origin}/gibts-nicht` } });
    const failed = await waitForArchive(t.app, alice, res.json().id);
    expect(failed.status).toBe('failed');
    expect(failed.error).toContain('HTTP 404');
    expect((await t.app.inject({ method: 'GET', url: `/api/v1/archives/${failed.id}/view`, headers: alice.auth })).statusCode).toBe(409);
    const retry = await t.app.inject({ method: 'POST', url: `/api/v1/archives/${failed.id}/retry`, headers: alice.auth });
    expect(retry.statusCode).toBe(202);
    const again = await waitForArchive(t.app, alice, failed.id);
    expect(again.status).toBe('failed');
  });

  it('archiviert Nicht-HTML-Ziele (Bild) unverändert', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/api/v1/archives', headers: alice.auth, payload: { url: `${site.origin}/img/logo.png` } });
    const done = await waitForArchive(t.app, alice, res.json().id);
    expect(done.status).toBe('done');
    const { viewUrl } = (await t.app.inject({ method: 'GET', url: `/api/v1/archives/${done.id}/view`, headers: alice.auth })).json();
    expect(viewUrl).toMatch(/index\.png$/);
    const file = await t.app.inject({ method: 'GET', url: viewUrl });
    expect(file.headers['content-type']).toBe('image/png');
  });

  it('respektiert das Ressourcen-Limit', async () => {
    const small = await createTestApp({ archive: { ...t.config.archive, maxAssets: 3 } });
    const s = await register(small.app, 'alice');
    const res = await small.app.inject({ method: 'POST', url: '/api/v1/archives', headers: s.auth, payload: { url: site.origin } });
    const done = await waitForArchive(small.app, s, res.json().id);
    expect(done.status).toBe('done');
    expect(done.assetCount).toBeLessThanOrEqual(4); // 3 Ressourcen + Hauptdokument
    expect(done.failedCount).toBeGreaterThan(0);
    await small.cleanup();
  });
});
