import { createHash } from 'node:crypto';
import path from 'node:path';
import mime from 'mime-types';
import type { Element } from 'domhandler';
import type { Config } from '../config.js';
import type { SafeFetcher } from '../net/safe-fetch.js';
import { readBodyLimited } from '../net/safe-fetch.js';
import { HttpError } from '../util/errors.js';
import { Semaphore } from '../util/semaphore.js';
import { isHttpUrl, stripHash } from '../net/url-utils.js';
import { rewriteHtml, type RefKind } from '../rewrite/html.js';
import { rewriteCss } from '../rewrite/css.js';
import { buildArchiveShim } from '../rewrite/shim.js';
import { decodeText, stripCssCharset } from '../rewrite/charset.js';
import type { ArchiveRepo, ArchiveOptions } from '../repos/archives.js';
import type { ArchiveStorage } from './storage.js';

export interface ArchiveResult {
  finalUrl: string;
  title: string;
  description: string;
  entryPath: string;
  assetCount: number;
  failedCount: number;
  totalBytes: number;
}

interface Deps {
  config: Config;
  fetcher: SafeFetcher;
  repo: ArchiveRepo;
  storage: ArchiveStorage;
}

const MAX_REDIRECTS = 8;
const HTML_TYPE = /^(?:text\/html|application\/xhtml\+xml)\b/i;
const CSS_TYPE = /^text\/css\b/i;
const JS_TYPE = /(?:javascript|ecmascript)/i;

const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function sanitizeSegment(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 48);
}

function pickExtension(url: URL, mimeType: string): string {
  const urlExt = path.posix.extname(url.pathname).slice(1).toLowerCase();
  const fromMime = mimeType && mimeType !== 'application/octet-stream' ? mime.extension(mimeType) : false;
  // URL-Endung bevorzugen, wenn sie zum MIME-Typ passt (z. B. .jpg vs. "jpeg"), sonst Endung vom MIME-Typ ableiten.
  if (urlExt && /^[a-z0-9]{1,8}$/.test(urlExt) && (!fromMime || mime.lookup(urlExt) === mimeType)) return urlExt;
  if (fromMime && /^[a-z0-9]{1,8}$/.test(fromMime)) return fromMime;
  return urlExt && /^[a-z0-9]{1,8}$/.test(urlExt) ? urlExt : 'bin';
}

export function localPathFor(url: URL, mimeType: string, dir: 'assets' | 'pages'): string {
  const hash = createHash('sha1').update(stripHash(url)).digest('hex').slice(0, 10);
  let last = url.pathname.split('/').filter(Boolean).pop() ?? '';
  try {
    last = decodeURIComponent(last);
  } catch {
    /* unverändert lassen */
  }
  const ext = pickExtension(url, mimeType);
  const stem = sanitizeSegment(last.replace(/\.[^.]*$/, '')) || 'file';
  return `${dir}/${hash}-${stem}.${ext}`;
}

/** Relativer URL-Pfad von einer Archivdatei zu einer anderen. */
export function relativeLink(fromFile: string, toFile: string): string {
  const rel = path.posix.relative(path.posix.dirname(fromFile), toFile);
  return rel === '' ? path.posix.basename(toFile) : rel;
}

export class ArchiveCancelledError extends Error {
  constructor() {
    super('Archivierung abgebrochen.');
  }
}

/**
 * Archiviert genau eine Webseite samt aller Abhängigkeiten.
 *
 * Ablauf: Hauptdokument laden → HTML parsen → jede Ressourcen-Referenz (CSS, JS, Bilder, Fonts, Medien, iframes)
 * über `ensure()` laden, lokal unter assets/ ablegen und die Referenz auf einen relativen Pfad umschreiben.
 * CSS wird rekursiv behandelt (@import, url() → Fonts/Bilder). Ressourcen werden pro URL nur einmal geladen.
 *
 * Zyklen (CSS importiert sich gegenseitig) sind unkritisch: `ensure()` liefert den lokalen Pfad, sobald die Datei
 * heruntergeladen ist – die Weiterverarbeitung ihrer eigenen Abhängigkeiten läuft danach unabhängig weiter.
 */
export class ArchiveJob {
  private readonly entries = new Map<string, Promise<string | null>>();
  private readonly pending = new Set<Promise<void>>();
  private readonly net: Semaphore;
  private assetCount = 0;
  /** Anzahl begonnener Ressourcen-Downloads (zählt sofort, nicht erst nach Abschluss – wichtig bei Parallelität). */
  private started = 0;
  private failedCount = 0;
  private totalBytes = 0;
  private fatal: Error | null = null;

  constructor(
    private readonly deps: Deps,
    private readonly archiveId: string,
    private readonly startUrl: URL,
    private readonly options: ArchiveOptions,
    private readonly signal: AbortSignal,
  ) {
    this.net = new Semaphore(deps.config.archive.maxFetchConcurrency);
  }

  async run(): Promise<ArchiveResult> {
    const { config } = this.deps;
    const first = await this.fetchFollowing(this.startUrl, this.startUrl.href, config.archive.maxTotalBytes);
    const contentType = first.contentType;
    const looksHtml = HTML_TYPE.test(contentType) || (!contentType && /^\s*(?:<!doctype html|<html)/i.test(first.body.subarray(0, 512).toString('latin1')));

    let entryPath: string;
    let title = '';
    let description = '';
    this.totalBytes += first.body.length;

    if (looksHtml) {
      entryPath = 'index.html';
      this.entries.set(stripHash(first.finalUrl), Promise.resolve(entryPath));
      const res = await this.processHtml(first.body, contentType, first.finalUrl, entryPath, 0);
      title = res.title;
      description = res.description;
    } else {
      // Direktes Dokument (PDF, Bild, Text …): unverändert ablegen.
      const m = contentType.split(';')[0]!.trim() || 'application/octet-stream';
      entryPath = `index.${pickExtension(first.finalUrl, m)}`;
      await this.store(entryPath, first.finalUrl.href, first.body, m);
      title = decodeURIComponent(first.finalUrl.pathname.split('/').filter(Boolean).pop() ?? first.finalUrl.hostname);
    }

    await this.drain();
    this.throwIfAborted();
    if (this.fatal) throw this.fatal;
    return {
      finalUrl: first.finalUrl.href,
      title: title || first.finalUrl.hostname,
      description,
      entryPath,
      assetCount: this.assetCount,
      failedCount: this.failedCount,
      totalBytes: this.totalBytes,
    };
  }

  private throwIfAborted(): void {
    if (this.signal.aborted) throw new ArchiveCancelledError();
  }

  private track(p: Promise<void>): void {
    const wrapped = p.catch((err) => {
      if (!this.fatal && (err instanceof ArchiveCancelledError || (err as Error).name === 'ArchiveCancelledError')) this.fatal = err as Error;
    });
    this.pending.add(wrapped);
    void wrapped.finally(() => this.pending.delete(wrapped));
  }

  private async drain(): Promise<void> {
    while (this.pending.size > 0) await Promise.allSettled([...this.pending]);
  }

  /** Lädt eine URL mit manuellem Redirect-Handling (jeder Hop wird gegen SSRF geprüft). */
  private async fetchFollowing(
    start: URL,
    referer: string,
    maxBytes: number,
  ): Promise<{ finalUrl: URL; contentType: string; body: Buffer }> {
    const { fetcher, config } = this.deps;
    let url = start;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      this.throwIfAborted();
      const signal = AbortSignal.any([this.signal, AbortSignal.timeout(config.archive.timeoutMs * 3)]);
      const res = await fetcher.request(
        url,
        { headers: { 'user-agent': config.userAgent, accept: '*/*', 'accept-language': 'de,en;q=0.8', referer } },
        signal,
      );
      const location = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && location) {
        void res.body?.cancel().catch(() => undefined);
        let next: URL;
        try {
          next = new URL(location, url);
        } catch {
          throw HttpError.badGateway(`Ungültige Weiterleitung: ${location}`);
        }
        if (!isHttpUrl(next)) throw HttpError.badGateway(`Weiterleitung auf nicht unterstütztes Schema: ${next.protocol}`);
        url = next;
        continue;
      }
      if (res.status < 200 || res.status >= 300) {
        void res.body?.cancel().catch(() => undefined);
        throw HttpError.badGateway(`HTTP ${res.status} von ${url.host}`, 'upstream_status');
      }
      const body = await readBodyLimited(res, maxBytes);
      return { finalUrl: url, contentType: res.headers.get('content-type') ?? '', body };
    }
    throw HttpError.badGateway('Zu viele Weiterleitungen.', 'too_many_redirects');
  }

  private async store(localPath: string, url: string, data: Buffer | string, mimeType: string): Promise<void> {
    this.throwIfAborted();
    const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
    await this.deps.storage.write(this.archiveId, localPath, buf);
    this.deps.repo.addResource({
      archive_id: this.archiveId,
      url,
      local_path: localPath,
      mime: mimeType,
      size: buf.length,
      status: 'stored',
      error: null,
    });
    this.assetCount++;
    if (this.assetCount % 10 === 0) this.deps.repo.updateProgress(this.archiveId, this.assetCount, this.totalBytes);
  }

  private recordFailure(url: URL, status: 'failed' | 'skipped', error: string): void {
    this.failedCount++;
    try {
      this.deps.repo.addResource({ archive_id: this.archiveId, url: url.href, local_path: null, mime: null, size: 0, status, error });
    } catch {
      /* Archiv wurde währenddessen gelöscht */
    }
  }

  /**
   * Stellt sicher, dass `url` lokal vorliegt, und gibt den lokalen Pfad zurück (null = nicht archivierbar).
   * Die Weiterverarbeitung (CSS-/HTML-Inhalt) läuft im Hintergrund weiter und wird über `drain()` abgewartet.
   */
  private ensure(url: URL, referer: string, kind: RefKind, pageDepth?: number): Promise<string | null> {
    const key = stripHash(url);
    const existing = this.entries.get(key);
    if (existing) return existing;

    const promise = new Promise<string | null>((resolve) => {
      this.track(this.download(url, referer, kind, pageDepth, resolve));
    });
    this.entries.set(key, promise);
    return promise;
  }

  private async download(
    url: URL,
    referer: string,
    kind: RefKind,
    pageDepth: number | undefined,
    resolve: (path: string | null) => void,
  ): Promise<void> {
    const { config } = this.deps;
    let settled = false;
    const done = (p: string | null) => {
      if (!settled) {
        settled = true;
        resolve(p);
      }
    };
    try {
      if (this.started >= config.archive.maxAssets) {
        this.recordFailure(url, 'skipped', 'Maximale Anzahl Ressourcen erreicht.');
        return done(null);
      }
      this.started++;
      const remaining = config.archive.maxTotalBytes - this.totalBytes;
      if (remaining <= 0) {
        this.recordFailure(url, 'skipped', 'Maximale Archivgröße erreicht.');
        return done(null);
      }

      const fetched = await this.net.run(() => this.fetchFollowing(url, referer, Math.min(config.archive.maxAssetBytes, remaining)));
      this.totalBytes += fetched.body.length;

      let mimeType = fetched.contentType.split(';')[0]!.trim().toLowerCase();
      if (kind === 'script' && !JS_TYPE.test(mimeType)) mimeType = 'text/javascript';
      else if (kind === 'style' && !CSS_TYPE.test(mimeType)) mimeType = 'text/css';
      else if (!mimeType) mimeType = (mime.lookup(url.pathname) || 'application/octet-stream') as string;

      const isPage = kind === 'frame' && HTML_TYPE.test(mimeType) && pageDepth !== undefined;
      const isCss = CSS_TYPE.test(mimeType);
      const localPath = localPathFor(url, isPage ? 'text/html' : mimeType, isPage ? 'pages' : 'assets');
      // Ab hier kennen Aufrufer den Zielpfad – Zyklen können nicht mehr blockieren.
      done(localPath);

      if (isPage) {
        await this.processHtml(fetched.body, fetched.contentType, fetched.finalUrl, localPath, pageDepth!);
      } else if (isCss) {
        const css = stripCssCharset(decodeText(fetched.body, fetched.contentType, 'css'));
        const out = await this.rewriteCssFor(css, fetched.finalUrl, localPath);
        await this.store(localPath, url.href, out, 'text/css; charset=utf-8');
      } else {
        await this.store(localPath, url.href, fetched.body, mimeType);
      }
    } catch (err) {
      if (err instanceof ArchiveCancelledError || this.signal.aborted) {
        done(null);
        throw new ArchiveCancelledError();
      }
      this.recordFailure(url, 'failed', err instanceof Error ? err.message : String(err));
      done(null);
    }
  }

  private rewriteCssFor(css: string, cssUrl: URL, cssPath: string): Promise<string> {
    return rewriteCss(css, async (raw) => {
      let target: URL;
      try {
        target = new URL(raw, cssUrl);
      } catch {
        return null;
      }
      if (!isHttpUrl(target)) return null;
      const local = await this.ensure(target, cssUrl.href, 'resource');
      // Nicht archivierbar → absolute URL behalten (relativ zur lokalen CSS-Datei wäre sie sonst kaputt).
      return local ? relativeLink(cssPath, local) + target.hash : target.href;
    });
  }

  private async processHtml(
    body: Buffer,
    contentType: string,
    documentUrl: URL,
    pagePath: string,
    depth: number,
  ): Promise<{ title: string; description: string }> {
    const { config } = this.deps;
    const html = decodeText(body, contentType, 'html');
    const result = await rewriteHtml(html, {
      documentUrl,
      stripScripts: !this.options.includeScripts,
      headPrepend:
        `<meta name="web-archiver:source" content="${escapeAttr(documentUrl.href)}">` +
        `<meta name="web-archiver:archived-at" content="${new Date().toISOString()}">` +
        (this.options.includeScripts ? buildArchiveShim() : ''),
      mapUrl: async ({ url, kind }) => {
        if (kind === 'navigation') {
          // Link auf die archivierte Seite selbst: als Anker erhalten, damit er offline funktioniert.
          if (stripHash(url) === stripHash(documentUrl)) return url.hash || '#';
          return null;
        }
        if (kind === 'form') return null;
        if (kind === 'frame') {
          if (depth >= config.archive.maxIframeDepth || url.origin !== documentUrl.origin) return null;
          const local = await this.ensure(url, documentUrl.href, 'frame', depth + 1);
          return local ? relativeLink(pagePath, local) + url.hash : null;
        }
        const local = await this.ensure(url, documentUrl.href, kind);
        return local ? relativeLink(pagePath, local) + url.hash : null;
      },
      onElement: (el: Element) => {
        const tag = el.tagName.toLowerCase();
        if ((tag === 'a' || tag === 'area') && /^https?:/i.test(el.attribs.href ?? '')) {
          el.attribs.target = '_blank';
          el.attribs.rel = 'noopener noreferrer';
        }
      },
    });
    await this.store(pagePath, documentUrl.href, result.html, 'text/html; charset=utf-8');
    return { title: result.title, description: result.description };
  }
}
