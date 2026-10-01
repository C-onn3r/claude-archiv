import { mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig, type Config } from '../src/config.js';

// 1x1 transparente PNG
export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

export interface SampleSite {
  origin: string;
  hits: string[];
  close(): Promise<void>;
}

/** Kleine Test-Website mit CSS-Zyklus, Fonts, srcset, iframe, Redirect, 404-Asset und Latin-1-Seite. */
export async function startSampleSite(): Promise<SampleSite> {
  const hits: string[] = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    hits.push(`${req.method} ${url.pathname}${url.search}`);
    const send = (status: number, type: string, body: string | Buffer, headers: Record<string, string> = {}) => {
      res.writeHead(status, { 'content-type': type, ...headers });
      res.end(body);
    };
    switch (url.pathname) {
      case '/':
        return send(
          200,
          'text/html; charset=utf-8',
          `<!doctype html><html><head><title>Beispiel Seite</title>
<meta name="description" content="Eine Testseite">
<base href="/">
<link rel="stylesheet" href="/style.css" integrity="sha384-abc">
<link rel="icon" href="img/logo.png">
<link rel="preconnect" href="https://cdn.example.net">
<style>.hero{background:url("img/bg.png")}</style>
<script src="app.js"></script></head>
<body style="background-image:url(img/bg.png)">
<h1>Hallo Welt</h1>
<img src="img/logo.png" srcset="img/logo.png 1x, /img/logo@2x.png 2x" alt="logo">
<img src="img/missing.png" alt="fehlt">
<a id="a1" href="/about" target="_blank">Über uns</a>
<a id="a2" href="https://external.example/x">extern</a>
<a id="a3" href="#top">anker</a>
<a id="a4" href="/#section">selbst</a>
<iframe src="/frame.html"></iframe>
<form action="/echo" method="post"><input name="q"></form>
</body></html>`,
        );
      case '/about':
        return send(200, 'text/html; charset=utf-8', '<html><head><title>Über</title></head><body>about</body></html>');
      case '/frame.html':
        return send(200, 'text/html', '<html><body><img src="img/logo.png"></body></html>');
      case '/style.css':
        return send(
          200,
          'text/css',
          `@import "/extra.css";
@font-face{font-family:T;src:url(fonts/f.woff2) format("woff2"),url('fonts/f.woff') format('woff')}
/* url(ignored.png) */
body{background:url('img/bg.png');cursor:url(data:image/png;base64,AAAA),auto}`,
        );
      case '/extra.css':
        return send(200, 'text/css', '@import url("style.css");\n.x{background:url(../img/logo.png)}');
      case '/app.js':
        return send(200, 'application/javascript', 'window.__loaded = true;');
      case '/img/logo.png':
      case '/img/logo@2x.png':
      case '/img/bg.png':
        return send(200, 'image/png', PNG, { 'cache-control': 'public, max-age=60' });
      case '/fonts/f.woff2':
        return send(200, 'font/woff2', Buffer.from('wOF2fake'));
      case '/fonts/f.woff':
        return send(404, 'text/plain', 'nope');
      case '/redirect':
        res.writeHead(302, { location: '/about?from=redirect' });
        return res.end();
      case '/latin1':
        return send(200, 'text/html; charset=iso-8859-1', Buffer.from('<html><head><title>Käse</title></head><body>äöü</body></html>', 'latin1'));
      case '/echo': {
        const chunks: Buffer[] = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () =>
          send(200, 'application/json', JSON.stringify({ method: req.method, body: Buffer.concat(chunks).toString(), ct: req.headers['content-type'] ?? null, cookie: req.headers.cookie ?? null })),
        );
        return;
      }
      case '/video.mp4': {
        const data = Buffer.from('0123456789');
        const range = req.headers.range;
        if (range) {
          const m = /bytes=(\d+)-(\d*)/.exec(range)!;
          const start = Number(m[1]);
          const end = m[2] ? Number(m[2]) : data.length - 1;
          return send(206, 'video/mp4', data.subarray(start, end + 1), { 'content-range': `bytes ${start}-${end}/${data.length}`, 'accept-ranges': 'bytes' });
        }
        return send(200, 'video/mp4', data, { 'accept-ranges': 'bytes' });
      }
      default:
        return send(404, 'text/html', '<html><body>404</body></html>');
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    hits,
    close: () => new Promise((r) => server.close(() => r())),
  };
}

export interface TestApp {
  app: FastifyInstance;
  config: Config;
  cleanup(): Promise<void>;
}

export async function createTestApp(overrides: Partial<Config> = {}): Promise<TestApp> {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'archiv-test-'));
  const config = loadConfig(
    { NODE_ENV: 'test', DATA_DIR: dataDir, JWT_SECRET: 'x'.repeat(48) } as NodeJS.ProcessEnv,
    { allowPrivateNetworks: true, allowRegistration: true, frontendDir: null, ...overrides },
  );
  const app = await buildApp(config);
  await app.ready();
  return {
    app,
    config,
    cleanup: async () => {
      await app.close();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  auth: { authorization: string };
  user: { id: string; username: string; role: string };
}

export async function register(app: FastifyInstance, username: string, password = 'passwort123'): Promise<Session> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { username, password } });
  if (res.statusCode !== 201) throw new Error(`register failed: ${res.statusCode} ${res.body}`);
  const body = res.json();
  return { accessToken: body.accessToken, refreshToken: body.refreshToken, auth: { authorization: `Bearer ${body.accessToken}` }, user: body.user };
}

export async function waitForArchive(app: FastifyInstance, session: Session, id: string, timeoutMs = 15_000) {
  const start = Date.now();
  for (;;) {
    const res = await app.inject({ method: 'GET', url: `/api/v1/archives/${id}`, headers: session.auth });
    const body = res.json();
    if (body.status === 'done' || body.status === 'failed') return body;
    if (Date.now() - start > timeoutMs) throw new Error(`Archive ${id} timed out (status ${body.status})`);
    await new Promise((r) => setTimeout(r, 50));
  }
}
