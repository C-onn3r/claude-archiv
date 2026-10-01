import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface Config {
  env: 'development' | 'production' | 'test';
  host: string;
  port: number;
  dataDir: string;
  dbFile: string;
  archivesDir: string;
  /** Verzeichnis des gebauten Frontends (leer = kein statisches Hosting). */
  frontendDir: string | null;
  jwtSecret: string;
  accessTokenTtlSec: number;
  refreshTokenTtlSec: number;
  /** Lebensdauer der Content-Tokens, die in Proxy-/Archiv-URLs stehen (iframes können keine Header senden). */
  contentTokenTtlSec: number;
  /** Erlaubt Selbstregistrierung. Der allererste Benutzer darf sich immer registrieren und wird Admin. */
  allowRegistration: boolean;
  /** Erlaubt Proxy/Archivierung für private/loopback Adressen (SSRF-Schutz aus). Nur für Tests/Heimnetz. */
  allowPrivateNetworks: boolean;
  corsOrigins: string[];
  /** Hinter einem Reverse-Proxy (nginx, Caddy, Traefik) betreiben: X-Forwarded-* für Client-IP/Rate-Limits beachten. */
  trustProxy: boolean;
  userAgent: string;
  proxy: {
    timeoutMs: number;
    maxBufferedBytes: number;
  };
  archive: {
    concurrency: number;
    timeoutMs: number;
    maxAssetBytes: number;
    maxTotalBytes: number;
    maxAssets: number;
    maxFetchConcurrency: number;
    maxIframeDepth: number;
  };
  rateLimit: {
    global: number;
    auth: number;
  };
}

function str(env: NodeJS.ProcessEnv, key: string, fallback: string): string {
  const v = env[key];
  return v === undefined || v === '' ? fallback : v;
}

function int(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const v = env[key];
  if (v === undefined || v === '') return fallback;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n) || n < 0) throw new Error(`Ungültiger Wert für ${key}: ${v}`);
  return n;
}

function bool(env: NodeJS.ProcessEnv, key: string, fallback: boolean): boolean {
  const v = env[key];
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

/** Liest ein Secret aus ENV oder erzeugt/persistiert es einmalig im Datenverzeichnis. */
function loadSecret(env: NodeJS.ProcessEnv, dataDir: string): string {
  const fromEnv = env.JWT_SECRET;
  if (fromEnv && fromEnv.length >= 32) return fromEnv;
  if (fromEnv) throw new Error('JWT_SECRET muss mindestens 32 Zeichen lang sein.');
  mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'jwt-secret.key');
  if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  const secret = randomBytes(48).toString('base64url');
  writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, overrides: Partial<Config> = {}): Config {
  const nodeEnv = (env.NODE_ENV as Config['env'] | undefined) ?? 'development';
  const dataDir = path.resolve(str(env, 'DATA_DIR', './data'));
  const frontendDefault = path.resolve('../frontend/dist');
  const frontendDir = str(env, 'FRONTEND_DIR', existsSync(frontendDefault) ? frontendDefault : '');

  const config: Config = {
    env: nodeEnv,
    host: str(env, 'HOST', '0.0.0.0'),
    port: int(env, 'PORT', 3000),
    dataDir,
    dbFile: path.join(dataDir, 'archiv.db'),
    archivesDir: path.join(dataDir, 'archives'),
    frontendDir: frontendDir ? path.resolve(frontendDir) : null,
    jwtSecret: loadSecret(env, dataDir),
    accessTokenTtlSec: int(env, 'ACCESS_TOKEN_TTL_SEC', 15 * 60),
    refreshTokenTtlSec: int(env, 'REFRESH_TOKEN_TTL_SEC', 30 * 24 * 3600),
    contentTokenTtlSec: int(env, 'CONTENT_TOKEN_TTL_SEC', 12 * 3600),
    allowRegistration: bool(env, 'ALLOW_REGISTRATION', false),
    allowPrivateNetworks: bool(env, 'ALLOW_PRIVATE_NETWORKS', false),
    corsOrigins: str(env, 'CORS_ORIGINS', '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    trustProxy: bool(env, 'TRUST_PROXY', false),
    userAgent: str(
      env,
      'USER_AGENT',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 WebArchiver/1.0',
    ),
    proxy: {
      timeoutMs: int(env, 'PROXY_TIMEOUT_MS', 20_000),
      maxBufferedBytes: int(env, 'PROXY_MAX_BUFFERED_BYTES', 15 * 1024 * 1024),
    },
    archive: {
      concurrency: int(env, 'ARCHIVE_CONCURRENCY', 2),
      timeoutMs: int(env, 'ARCHIVE_TIMEOUT_MS', 20_000),
      maxAssetBytes: int(env, 'ARCHIVE_MAX_ASSET_BYTES', 25 * 1024 * 1024),
      maxTotalBytes: int(env, 'ARCHIVE_MAX_TOTAL_BYTES', 250 * 1024 * 1024),
      maxAssets: int(env, 'ARCHIVE_MAX_ASSETS', 1000),
      maxFetchConcurrency: int(env, 'ARCHIVE_FETCH_CONCURRENCY', 8),
      maxIframeDepth: int(env, 'ARCHIVE_MAX_IFRAME_DEPTH', 1),
    },
    rateLimit: {
      global: int(env, 'RATE_LIMIT_PER_MIN', 600),
      auth: int(env, 'AUTH_RATE_LIMIT_PER_MIN', 20),
    },
  };
  return { ...config, ...overrides };
}
