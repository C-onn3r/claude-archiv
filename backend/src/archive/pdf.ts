import { readFile } from 'node:fs/promises';
import puppeteer, { type Browser, type HTTPRequest } from 'puppeteer-core';
import type { Config } from '../config.js';
import type { ArchiveRepo, ArchiveRow } from '../repos/archives.js';
import { HttpError } from '../util/errors.js';
import { Semaphore } from '../util/semaphore.js';
import type { ArchiveStorage } from './storage.js';

const VIRTUAL_HOST = 'archive.local';
const HTML_TYPE = /^(?:text\/html|application\/xhtml\+xml)\b/i;

/**
 * Rendert ein Archiv mit Headless-Chromium zu einem PDF.
 *
 * Die Seite wird NICHT über das Netzwerk geladen: Jede Anfrage des Browsers wird abgefangen und direkt aus dem
 * Archivverzeichnis beantwortet (virtueller Host `archive.local`). Alles andere wird blockiert – das PDF entsteht
 * also hermetisch aus dem gespeicherten Stand, ohne Zugriff auf Internet, LAN oder die API.
 */
export class PdfService {
  /** Chromium ist ressourcenhungrig (v. a. auf dem Raspberry Pi): immer nur ein Rendering gleichzeitig. */
  private readonly lock = new Semaphore(1);

  constructor(
    private readonly config: Config,
    private readonly repo: ArchiveRepo,
    private readonly storage: ArchiveStorage,
  ) {}

  get available(): boolean {
    return this.config.pdf.chromiumPath !== null;
  }

  async render(archive: ArchiveRow): Promise<Buffer> {
    if (!this.config.pdf.chromiumPath) {
      throw new HttpError(
        501,
        'pdf_unavailable',
        'PDF-Export ist nicht verfügbar: Chromium wurde nicht gefunden (installieren oder CHROMIUM_PATH setzen).',
      );
    }
    const entry = this.repo.findResourceByPath(archive.id, archive.entry_path);
    if (!entry) throw HttpError.notFound('Startdatei des Archivs fehlt.');
    const entryFile = this.storage.resolve(archive.id, archive.entry_path);
    if (!entryFile) throw HttpError.notFound('Startdatei des Archivs fehlt.');

    // Archivierte PDF-Dokumente müssen nicht neu gerendert werden.
    if (entry.mime?.startsWith('application/pdf')) return readFile(entryFile);

    return this.lock.run(() => this.renderWithBrowser(archive, entry.mime ?? 'text/html'));
  }

  private async renderWithBrowser(archive: ArchiveRow, entryMime: string): Promise<Buffer> {
    const { chromiumPath, noSandbox, timeoutMs } = this.config.pdf;
    let browser: Browser | undefined;
    const timer = setTimeout(() => void browser?.close().catch(() => undefined), timeoutMs);
    try {
      browser = await puppeteer.launch({
        executablePath: chromiumPath!,
        headless: true,
        args: ['--disable-gpu', '--disable-dev-shm-usage', '--hide-scrollbars', ...(noSandbox ? ['--no-sandbox'] : [])],
      });
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 900 });
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        void this.answer(archive, req.url(), req, entryMime);
      });

      const response = await page.goto(`http://${VIRTUAL_HOST}/${archive.entry_path}`, { waitUntil: 'networkidle0', timeout: timeoutMs });
      if (!response || !response.ok()) throw HttpError.badGateway('Archiv konnte nicht gerendert werden.', 'pdf_failed');
      // Lazy-Load-Bilder (Skripte) bekommen einen Moment Zeit.
      await new Promise((r) => setTimeout(r, 300));
      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '12mm', bottom: '12mm', left: '10mm', right: '10mm' },
        timeout: timeoutMs,
      });
      return Buffer.from(pdf);
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(500, 'pdf_failed', `PDF-Erstellung fehlgeschlagen: ${(err as Error).message}`);
    } finally {
      clearTimeout(timer);
      await browser?.close().catch(() => undefined);
    }
  }

  private async answer(
    archive: ArchiveRow,
    rawUrl: string,
    req: HTTPRequest,
    entryMime: string,
  ): Promise<void> {
    try {
      if (rawUrl.startsWith('data:') || rawUrl.startsWith('blob:') || rawUrl === 'about:blank') return await req.continue();
      const url = new URL(rawUrl);
      if (url.hostname !== VIRTUAL_HOST) return await req.abort('blockedbyclient');
      const rel = decodeURIComponent(url.pathname.slice(1));
      const resource = this.repo.findResourceByPath(archive.id, rel);
      const full = resource && this.storage.resolve(archive.id, rel);
      if (!resource || !full) return await req.respond({ status: 404, contentType: 'text/plain', body: 'not archived' });
      const body = await readFile(full);
      const contentType = rel === archive.entry_path ? entryMime : (resource.mime ?? 'application/octet-stream');
      await req.respond({ status: 200, contentType: HTML_TYPE.test(contentType) ? 'text/html; charset=utf-8' : contentType, body });
    } catch {
      await req.respond({ status: 404, contentType: 'text/plain', body: 'error' }).catch(() => undefined);
    }
  }
}
