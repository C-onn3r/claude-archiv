import type { Db } from '../db/index.js';
import { newId, nowIso } from '../util/ids.js';

export type ArchiveStatus = 'pending' | 'running' | 'done' | 'failed';

export interface ArchiveOptions {
  /** JavaScript-Dateien und Inline-Skripte mitarchivieren (Standard: true). */
  includeScripts: boolean;
}

export const defaultArchiveOptions: ArchiveOptions = { includeScripts: true };

export interface ArchiveRow {
  id: string;
  user_id: string;
  url: string;
  final_url: string | null;
  title: string;
  description: string;
  status: ArchiveStatus;
  error: string | null;
  options: string;
  tags: string;
  entry_path: string;
  asset_count: number;
  failed_count: number;
  total_bytes: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface ResourceRow {
  archive_id: string;
  url: string;
  local_path: string | null;
  mime: string | null;
  size: number;
  status: 'stored' | 'failed' | 'skipped';
  error: string | null;
}

export interface PublicArchive {
  id: string;
  url: string;
  finalUrl: string | null;
  title: string;
  description: string;
  status: ArchiveStatus;
  error: string | null;
  tags: string[];
  options: ArchiveOptions;
  assetCount: number;
  failedCount: number;
  totalBytes: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export const toPublicArchive = (a: ArchiveRow): PublicArchive => ({
  id: a.id,
  url: a.url,
  finalUrl: a.final_url,
  title: a.title,
  description: a.description,
  status: a.status,
  error: a.error,
  tags: JSON.parse(a.tags) as string[],
  options: { ...defaultArchiveOptions, ...(JSON.parse(a.options) as Partial<ArchiveOptions>) },
  assetCount: a.asset_count,
  failedCount: a.failed_count,
  totalBytes: a.total_bytes,
  createdAt: a.created_at,
  startedAt: a.started_at,
  finishedAt: a.finished_at,
});

export interface ListFilter {
  userId: string;
  q?: string;
  status?: ArchiveStatus;
  tag?: string;
  limit: number;
  offset: number;
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export class ArchiveRepo {
  constructor(private readonly db: Db) {}

  create(userId: string, url: string, options: ArchiveOptions): ArchiveRow {
    const id = newId();
    this.db
      .prepare(
        `INSERT INTO archives (id, user_id, url, title, status, options, created_at)
         VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
      )
      .run(id, userId, url, url, JSON.stringify(options), nowIso());
    return this.findById(id)!;
  }

  findById(id: string): ArchiveRow | undefined {
    return this.db.prepare('SELECT * FROM archives WHERE id = ?').get(id) as ArchiveRow | undefined;
  }

  findOwned(id: string, userId: string): ArchiveRow | undefined {
    return this.db.prepare('SELECT * FROM archives WHERE id = ? AND user_id = ?').get(id, userId) as
      | ArchiveRow
      | undefined;
  }

  list(f: ListFilter): { items: ArchiveRow[]; total: number } {
    const where: string[] = ['user_id = @userId'];
    const params: Record<string, unknown> = { userId: f.userId, limit: f.limit, offset: f.offset };
    if (f.q) {
      where.push("(title LIKE @q ESCAPE '\\' OR url LIKE @q ESCAPE '\\' OR description LIKE @q ESCAPE '\\')");
      params.q = `%${escapeLike(f.q)}%`;
    }
    if (f.status) {
      where.push('status = @status');
      params.status = f.status;
    }
    if (f.tag) {
      where.push("EXISTS (SELECT 1 FROM json_each(archives.tags) WHERE value = @tag)");
      params.tag = f.tag;
    }
    const clause = where.join(' AND ');
    const items = this.db
      .prepare(`SELECT * FROM archives WHERE ${clause} ORDER BY created_at DESC LIMIT @limit OFFSET @offset`)
      .all(params) as ArchiveRow[];
    const { limit: _l, offset: _o, ...countParams } = params;
    const total = (this.db.prepare(`SELECT COUNT(*) AS c FROM archives WHERE ${clause}`).get(countParams) as { c: number })
      .c;
    return { items, total };
  }

  update(id: string, patch: { title?: string; description?: string; tags?: string[] }): ArchiveRow | undefined {
    const cur = this.findById(id);
    if (!cur) return undefined;
    this.db
      .prepare('UPDATE archives SET title = ?, description = ?, tags = ? WHERE id = ?')
      .run(patch.title ?? cur.title, patch.description ?? cur.description, JSON.stringify(patch.tags ?? JSON.parse(cur.tags)), id);
    return this.findById(id);
  }

  markRunning(id: string): void {
    this.db.prepare("UPDATE archives SET status = 'running', started_at = ?, error = NULL WHERE id = ?").run(nowIso(), id);
  }

  markDone(
    id: string,
    r: {
      finalUrl: string;
      title: string;
      description: string;
      entryPath: string;
      assetCount: number;
      failedCount: number;
      totalBytes: number;
    },
  ): void {
    this.db
      .prepare(
        `UPDATE archives SET status = 'done', final_url = ?, title = ?, description = ?, entry_path = ?, asset_count = ?,
         failed_count = ?, total_bytes = ?, finished_at = ?, error = NULL WHERE id = ?`,
      )
      .run(r.finalUrl, r.title, r.description, r.entryPath, r.assetCount, r.failedCount, r.totalBytes, nowIso(), id);
  }

  updateProgress(id: string, assetCount: number, totalBytes: number): void {
    this.db.prepare('UPDATE archives SET asset_count = ?, total_bytes = ? WHERE id = ?').run(assetCount, totalBytes, id);
  }

  markFailed(id: string, error: string): void {
    this.db.prepare("UPDATE archives SET status = 'failed', error = ?, finished_at = ? WHERE id = ?").run(error, nowIso(), id);
  }

  resetForRetry(id: string): void {
    this.db.prepare("UPDATE archives SET status = 'pending', error = NULL, started_at = NULL, finished_at = NULL WHERE id = ?").run(id);
    this.clearResources(id);
  }

  /** Beim Serverstart: unterbrochene Läufe als fehlgeschlagen markieren, wartende erneut einreihen. */
  recoverInterrupted(): string[] {
    this.db
      .prepare("UPDATE archives SET status = 'failed', error = 'Durch Neustart unterbrochen.', finished_at = ? WHERE status = 'running'")
      .run(nowIso());
    return (this.db.prepare("SELECT id FROM archives WHERE status = 'pending' ORDER BY created_at ASC").all() as { id: string }[]).map(
      (r) => r.id,
    );
  }

  listIdsByUser(userId: string): string[] {
    return (this.db.prepare('SELECT id FROM archives WHERE user_id = ?').all(userId) as { id: string }[]).map((r) => r.id);
  }

  delete(id: string): boolean {
    return this.db.prepare('DELETE FROM archives WHERE id = ?').run(id).changes > 0;
  }

  addResource(r: ResourceRow): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO archive_resources (archive_id, url, local_path, mime, size, status, error)
         VALUES (@archive_id, @url, @local_path, @mime, @size, @status, @error)`,
      )
      .run(r);
  }

  clearResources(id: string): void {
    this.db.prepare('DELETE FROM archive_resources WHERE archive_id = ?').run(id);
  }

  listResources(id: string): ResourceRow[] {
    return this.db
      .prepare('SELECT * FROM archive_resources WHERE archive_id = ? ORDER BY local_path IS NULL, local_path, url')
      .all(id) as ResourceRow[];
  }

  findResourceByPath(id: string, localPath: string): ResourceRow | undefined {
    return this.db
      .prepare("SELECT * FROM archive_resources WHERE archive_id = ? AND local_path = ? AND status = 'stored'")
      .get(id, localPath) as ResourceRow | undefined;
  }
}
