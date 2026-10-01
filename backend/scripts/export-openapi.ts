/** Schreibt die OpenAPI-Spezifikation nach docs/openapi.json (für Client-Generatoren, z. B. Android/Kotlin). */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'archiv-openapi-'));
const config = loadConfig({ NODE_ENV: 'test', DATA_DIR: dataDir, JWT_SECRET: 'x'.repeat(48) } as NodeJS.ProcessEnv, { frontendDir: null });
const app = await buildApp(config);
await app.ready();
const out = path.resolve('../docs/openapi.json');
mkdirSync(path.dirname(out), { recursive: true });
const res = await app.inject({ method: 'GET', url: '/api/docs/json' });
if (res.statusCode !== 200) throw new Error(`OpenAPI-Export fehlgeschlagen: ${res.statusCode}`);
writeFileSync(out, JSON.stringify(res.json(), null, 2) + '\n');
await app.close();
rmSync(dataDir, { recursive: true, force: true });
console.log(`OpenAPI geschrieben: ${out}`);
