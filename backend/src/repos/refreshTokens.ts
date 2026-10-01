import type { Db } from '../db/index.js';
import { newId, nowIso } from '../util/ids.js';

export interface RefreshTokenRow {
  id: string;
  user_id: string;
  token_hash: string;
  user_agent: string | null;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
}

export class RefreshTokenRepo {
  constructor(private readonly db: Db) {}

  create(userId: string, tokenHash: string, expiresAt: Date, userAgent?: string): void {
    this.db
      .prepare(
        'INSERT INTO refresh_tokens (id, user_id, token_hash, user_agent, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(newId(), userId, tokenHash, userAgent?.slice(0, 300) ?? null, nowIso(), expiresAt.toISOString());
  }

  findByHash(hash: string): RefreshTokenRow | undefined {
    return this.db.prepare('SELECT * FROM refresh_tokens WHERE token_hash = ?').get(hash) as RefreshTokenRow | undefined;
  }

  revoke(id: string): void {
    this.db.prepare('UPDATE refresh_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').run(nowIso(), id);
  }

  revokeAllForUser(userId: string): void {
    this.db
      .prepare('UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL')
      .run(nowIso(), userId);
  }

  purgeExpired(): void {
    this.db.prepare('DELETE FROM refresh_tokens WHERE expires_at < ?').run(new Date(Date.now() - 86_400_000).toISOString());
  }
}
