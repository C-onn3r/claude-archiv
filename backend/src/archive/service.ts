import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../config.js';
import type { SafeFetcher } from '../net/safe-fetch.js';
import { parseTargetUrl } from '../net/url-utils.js';
import { HttpError } from '../util/errors.js';
import { defaultArchiveOptions, type ArchiveOptions, type ArchiveRepo, type ArchiveRow } from '../repos/archives.js';
import { ArchiveCancelledError, ArchiveJob } from './engine.js';
import type { ArchiveStorage } from './storage.js';

interface Deps {
  config: Config;
  repo: ArchiveRepo;
  storage: ArchiveStorage;
  fetcher: SafeFetcher;
  log: Pick<FastifyBaseLogger, 'info' | 'warn' | 'error'>;
}

/**
 * Steuert Archivierungsaufträge: Warteschlange mit begrenzter Parallelität, Wiederaufnahme nach Neustart,
 * Abbruch beim Löschen. Der Zustand ist vollständig in der Datenbank – die In-Memory-Queue ist nur Scheduler und
 * lässt sich später 1:1 durch eine externe Queue (BullMQ, SQS …) ersetzen.
 */
export class ArchiveService {
  private readonly queue: string[] = [];
  private readonly running = new Map<string, { abort: AbortController; done: Promise<void> }>();
  private stopped = false;

  constructor(private readonly deps: Deps) {}

  /** Beim Serverstart aufrufen: unterbrochene Aufträge bereinigen, wartende fortsetzen. */
  start(): void {
    const pending = this.deps.repo.recoverInterrupted();
    for (const id of pending) this.enqueue(id);
  }

  async create(userId: string, rawUrl: string, partial: Partial<ArchiveOptions> = {}): Promise<ArchiveRow> {
    const url = parseTargetUrl(rawUrl);
    await this.deps.fetcher.assertAllowed(url);
    const row = this.deps.repo.create(userId, url.href, { ...defaultArchiveOptions, ...partial });
    this.enqueue(row.id);
    return row;
  }

  storageDir(id: string): string {
    return this.deps.storage.dirFor(id);
  }

  retry(row: ArchiveRow): ArchiveRow {
    if (row.status !== 'failed') throw HttpError.conflict('Nur fehlgeschlagene Archive können erneut gestartet werden.');
    this.deps.repo.resetForRetry(row.id);
    void this.deps.storage.remove(row.id);
    this.enqueue(row.id);
    return this.deps.repo.findById(row.id)!;
  }

  /** Bricht einen laufenden Auftrag ab (falls vorhanden), löscht DB-Eintrag und Dateien. */
  async remove(id: string): Promise<void> {
    const idx = this.queue.indexOf(id);
    if (idx >= 0) this.queue.splice(idx, 1);
    const job = this.running.get(id);
    this.deps.repo.delete(id);
    if (job) {
      job.abort.abort();
      await job.done.catch(() => undefined);
    }
    await this.deps.storage.remove(id);
  }

  /** Entfernt die Dateien aller Archive eines Benutzers (nach dem Löschen des Benutzers). */
  async removeAllForUser(userId: string): Promise<void> {
    for (const id of this.deps.repo.listIdsByUser(userId)) await this.remove(id);
  }

  async shutdown(): Promise<void> {
    this.stopped = true;
    this.queue.length = 0;
    for (const job of this.running.values()) job.abort.abort();
    await Promise.allSettled([...this.running.values()].map((j) => j.done));
  }

  private enqueue(id: string): void {
    if (this.stopped || this.queue.includes(id) || this.running.has(id)) return;
    this.queue.push(id);
    setImmediate(() => this.pump());
  }

  private pump(): void {
    while (!this.stopped && this.running.size < this.deps.config.archive.concurrency && this.queue.length > 0) {
      const id = this.queue.shift()!;
      const abort = new AbortController();
      const done = this.runOne(id, abort.signal).finally(() => {
        this.running.delete(id);
        this.pump();
      });
      this.running.set(id, { abort, done });
    }
  }

  private async runOne(id: string, signal: AbortSignal): Promise<void> {
    const { repo, storage, fetcher, config, log } = this.deps;
    const row = repo.findById(id);
    if (!row) return;
    repo.markRunning(id);
    try {
      const options = { ...defaultArchiveOptions, ...(JSON.parse(row.options) as Partial<ArchiveOptions>) };
      const job = new ArchiveJob({ config, fetcher, repo, storage }, id, new URL(row.url), options, signal);
      const result = await job.run();
      repo.markDone(id, result);
      log.info({ archiveId: id, assets: result.assetCount, failed: result.failedCount, bytes: result.totalBytes }, 'archive done');
    } catch (err) {
      await storage.remove(id);
      if (!repo.findById(id)) return; // währenddessen gelöscht
      if (err instanceof ArchiveCancelledError || signal.aborted) {
        repo.markFailed(id, 'Archivierung abgebrochen.');
        return;
      }
      const message = err instanceof HttpError ? err.message : `Unerwarteter Fehler: ${(err as Error).message}`;
      if (!(err instanceof HttpError)) log.error({ err, archiveId: id }, 'archive failed unexpectedly');
      else log.warn({ archiveId: id, reason: message }, 'archive failed');
      repo.clearResources(id);
      repo.markFailed(id, message);
    }
  }
}
