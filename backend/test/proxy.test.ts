import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, register, startSampleSite, type Session, type SampleSite, type TestApp } from './helpers.js';

describe('Live-Proxy', () => {
  let t: TestApp;
  let site: SampleSite;
  let session: Session;
  let prefix: string; // /proxy/<token>/

  beforeAll(async () => {
    site = await startSampleSite();
    t = await createTestApp();
    session = await register(t.app, 'alice');
    const res = await t.app.inject({ method: 'POST', url: '/api/v1/proxy/links', headers: session.auth, payload: { url: site.origin } });
    expect(res.statusCode).toBe(200);
    const link = res.json();
    expect(link.targetUrl).toBe(`${site.origin}/`);
    prefix = link.proxyUrl.slice(0, link.proxyUrl.indexOf('/http'));
  });
  afterAll(async () => {
    await t.cleanup();
    await site.close();
  });

  const hostPath = () => `http/${site.origin.replace('http://', '')}`;
  const get = (p: string, headers: Record<string, string> = {}) => t.app.inject({ method: 'GET', url: `${prefix}/${hostPath()}${p}`, headers });

  it('liefert HTML mit umgeschriebenen URLs, Shim und Sandbox-Headern', async () => {
    const res = await get('/');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(res.headers['content-security-policy']).toMatch(/^sandbox allow-scripts/);
    expect(res.headers['content-security-policy']).not.toContain('allow-same-origin');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    const html = res.body;
    const base = `${prefix}/${hostPath()}`;
    expect(html).toContain(`href="${base}/style.css"`);
    expect(html).toContain(`src="${base}/app.js"`);
    expect(html).toContain(`src="${base}/img/logo.png"`);
    expect(html).toContain(`${base}/img/logo@2x.png 2x`);
    expect(html).toContain(`<a id="a1" href="${base}/about" target="_self">`);
    expect(html).toContain(`<a id="a2" href="${base.replace(hostPath(), '')}https/external.example/x"`);
    expect(html).toContain('<a id="a3" href="#top">');
    expect(html).toContain(`action="${base}/echo"`);
    expect(html).toContain(`<iframe src="${base}/frame.html">`);
    expect(html).toContain(`url("${base}/img/bg.png")`);
    expect(html).not.toContain('integrity');
    expect(html).not.toContain('<base');
    expect(html).not.toContain('preconnect');
    expect(html).toContain('window.__WEB_ARCHIVER__');
    expect(html.indexOf('__WEB_ARCHIVER__')).toBeLessThan(html.indexOf('app.js'));
  });

  it('schreibt CSS rekursiv um und leitet Binärdaten samt Cache-Header durch', async () => {
    const css = await get('/style.css');
    expect(css.headers['content-type']).toBe('text/css; charset=utf-8');
    const base = `${prefix}/${hostPath()}`;
    expect(css.body).toContain(`@import "${base}/extra.css"`);
    expect(css.body).toContain(`url("${base}/fonts/f.woff2")`);
    expect(css.body).toContain('url(data:image/png;base64,AAAA)');
    const img = await get('/img/logo.png');
    expect(img.headers['content-type']).toBe('image/png');
    expect(img.headers['cache-control']).toBe('private, max-age=60');
    expect(img.rawPayload.length).toBeGreaterThan(30);
  });

  it('übersetzt Weiterleitungen in Proxy-URLs und reicht Fehlerstatus durch', async () => {
    const r = await get('/redirect');
    expect(r.statusCode).toBe(302);
    expect(r.headers.location).toBe(`${prefix}/${hostPath()}/about?from=redirect`);
    const nf = await get('/gibts-nicht');
    expect(nf.statusCode).toBe(404);
    expect(nf.body).toContain('404');
  });

  it('dekodiert Nicht-UTF-8-Seiten korrekt', async () => {
    const res = await get('/latin1');
    expect(res.body).toContain('äöü');
    expect(res.body).toContain('<title>Käse</title>');
  });

  it('leitet POST-Formulare weiter, aber keine Cookies', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: `${prefix}/${hostPath()}/echo`,
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: 'session=geheim' },
      payload: 'q=hallo',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ method: 'POST', body: 'q=hallo', ct: 'application/x-www-form-urlencoded', cookie: null });
  });

  it('unterstützt Range-Requests (Medien)', async () => {
    const res = await get('/video.mp4', { range: 'bytes=2-5' });
    expect(res.statusCode).toBe(206);
    expect(res.headers['content-range']).toBe('bytes 2-9/10'.replace('2-9', '2-5'));
    expect(res.body).toBe('2345');
  });

  it('beantwortet CORS-Preflights selbst', async () => {
    const res = await t.app.inject({
      method: 'OPTIONS',
      url: `${prefix}/${hostPath()}/echo`,
      headers: { origin: 'null', 'access-control-request-method': 'POST', 'access-control-request-headers': 'x-test' },
    });
    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('null');
    expect(res.headers['access-control-allow-headers']).toBe('x-test');
  });

  it('lehnt ungültige/abgelaufene Tokens ab', async () => {
    const res = await t.app.inject({ method: 'GET', url: `/proxy/abc.def.ghi/${hostPath()}/` });
    expect(res.statusCode).toBe(401);
    expect(res.headers['content-type']).toContain('text/html');
    // Access-Tokens sind keine Content-Tokens
    const res2 = await t.app.inject({ method: 'GET', url: `/proxy/${session.accessToken}/${hostPath()}/` });
    expect(res2.statusCode).toBe(401);
  });

  it('meldet nicht erreichbare Ziele als lesbare Fehlerseite', async () => {
    const res = await t.app.inject({ method: 'GET', url: `${prefix}/http/127.0.0.1:1/` });
    expect(res.statusCode).toBe(502);
    expect(res.body).toContain('HTTP 502');
  });
});

describe('SSRF-Schutz', () => {
  let t: TestApp;
  let site: SampleSite;
  let session: Session;
  beforeAll(async () => {
    site = await startSampleSite();
    t = await createTestApp({ allowPrivateNetworks: false });
    session = await register(t.app, 'alice');
  });
  afterAll(async () => {
    await t.cleanup();
    await site.close();
  });

  it.each([
    ['Loopback-IP', () => site.origin],
    ['localhost', () => 'http://localhost:9999/'],
    ['Cloud-Metadaten', () => 'http://169.254.169.254/latest/meta-data/'],
    ['IPv6-Loopback', () => 'http://[::1]:8080/'],
    ['IPv4-mapped', () => 'http://[::ffff:127.0.0.1]:8080/'],
  ])('blockiert Proxy-Links auf %s', async (_n, url) => {
    const res = await t.app.inject({ method: 'POST', url: '/api/v1/proxy/links', headers: session.auth, payload: { url: url() } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('blocked_target');
  });

  it('blockiert auch direkte Proxy-Aufrufe und Archivierung interner Ziele', async () => {
    const { token } = await t.app.services.tokens.signContent(t.app.services.users.findById(session.user.id)!);
    const res = await t.app.inject({ method: 'GET', url: `/proxy/${token}/http/${site.origin.replace('http://', '')}/` });
    expect(res.statusCode).toBe(403);
    expect(site.hits).toHaveLength(0);
    const arch = await t.app.inject({ method: 'POST', url: '/api/v1/archives', headers: session.auth, payload: { url: site.origin } });
    expect(arch.statusCode).toBe(403);
    expect(site.hits).toHaveLength(0);
  });

  it('prüft aufgelöste Adressen unmittelbar beim Verbindungsaufbau (DNS-Rebinding-Schutz)', async () => {
    const port = new URL(site.origin).port;
    // Umgeht assertAllowed bewusst: der Hostname "localhost" wird erst beim connect aufgelöst und dort geblockt.
    await expect(t.app.services.proxyFetcher.request(new URL(`http://localhost:${port}/`))).rejects.toMatchObject({ code: 'blocked_target' });
    expect(site.hits).toHaveLength(0);
  });

  it('weist ungültige Schemata ab', async () => {
    for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'ftp://example.com']) {
      const res = await t.app.inject({ method: 'POST', url: '/api/v1/proxy/links', headers: session.auth, payload: { url } });
      expect(res.statusCode, url).toBe(400);
    }
  });
});
