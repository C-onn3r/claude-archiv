import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { createTestApp, register, startSampleSite, waitForArchive, type SampleSite, type Session, type TestApp } from './helpers.js';

// Chromium ist optional: ohne Binary wird nur der "nicht verfügbar"-Pfad getestet.
const chromium = [process.env.CHROMIUM_PATH, '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']
  .concat(['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'])
  .find((p): p is string => !!p && existsSync(p));

describe('PDF-Export ohne Chromium', () => {
  let t: TestApp;
  let site: SampleSite;
  let alice: Session;
  beforeAll(async () => {
    site = await startSampleSite();
    t = await createTestApp({ pdf: { chromiumPath: null, noSandbox: false, timeoutMs: 5000 } });
    alice = await register(t.app, 'alice');
  });
  afterAll(async () => {
    await t.cleanup();
    await site.close();
  });

  it('meldet 501 pdf_unavailable und /meta pdfExport=false', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/api/v1/archives', headers: alice.auth, payload: { url: site.origin } });
    const done = await waitForArchive(t.app, alice, res.json().id);
    expect((await t.app.inject({ method: 'GET', url: '/api/v1/meta' })).json().pdfExport).toBe(false);
    const pdf = await t.app.inject({ method: 'GET', url: `/api/v1/archives/${done.id}/pdf`, headers: alice.auth });
    expect(pdf.statusCode).toBe(501);
    expect(pdf.json().error.code).toBe('pdf_unavailable');
  });
});

describe.skipIf(!chromium)('PDF-Export mit Chromium', () => {
  let t: TestApp;
  let site: SampleSite;
  let alice: Session;
  beforeAll(async () => {
    site = await startSampleSite();
    t = await createTestApp({ pdf: { chromiumPath: chromium!, noSandbox: true, timeoutMs: 30_000 } });
    alice = await register(t.app, 'alice');
  });
  afterAll(async () => {
    await t.cleanup();
    await site.close();
  });

  it('erzeugt ein PDF offline aus dem Archiv (Seite wurde danach abgeschaltet)', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/api/v1/archives', headers: alice.auth, payload: { url: site.origin } });
    const done = await waitForArchive(t.app, alice, res.json().id);
    expect(done.status).toBe('done');
    await site.close(); // Ziel offline: das PDF muss rein aus dem Archiv entstehen
    expect((await t.app.inject({ method: 'GET', url: '/api/v1/meta' })).json().pdfExport).toBe(true);

    const pdf = await t.app.inject({ method: 'GET', url: `/api/v1/archives/${done.id}/pdf`, headers: alice.auth });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.headers['content-disposition']).toMatch(/filename="Beispiel_Seite\.pdf"/);
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.rawPayload.length).toBeGreaterThan(1500);
  }, 60_000);

  it('verlangt Authentifizierung und fremde Archive sind tabu', async () => {
    expect((await t.app.inject({ method: 'GET', url: '/api/v1/archives/00000000-0000-0000-0000-000000000000/pdf' })).statusCode).toBe(401);
    expect((await t.app.inject({ method: 'GET', url: '/api/v1/archives/00000000-0000-0000-0000-000000000000/pdf', headers: alice.auth })).statusCode).toBe(404);
  });
});
