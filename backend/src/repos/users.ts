import type { Db } from '../db/index.js';
import { newId, nowIso } from '../util/ids.js';

export type Role = 'admin' | 'user';

export interface UserRow {
  id: string;
  username: string;
  display_name: string;
  password_hash: string;
  role: Role;
  token_version: number;
  created_at: string;
  updated_at: string;
}

export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  createdAt: string;
}

export const toPublicUser = (u: UserRow): PublicUser => ({
  id: u.id,
  username: u.username,
  displayName: u.display_name,
  role: u.role,
  createdAt: u.created_at,
});

export class UserRepo {
  constructor(private readonly db: Db) {}

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }).c;
  }

  countAdmins(): number {
    return (this.db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'").get() as { c: number }).c;
  }

  findById(id: string): UserRow | undefined {
    return this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
  }

  findByUsername(username: string): UserRow | undefined {
    return this.db.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined;
  }

  list(): UserRow[] {
    return this.db.prepare('SELECT * FROM users ORDER BY created_at ASC').all() as UserRow[];
  }

  create(input: { username: string; displayName: string; passwordHash: string; role: Role }): UserRow {
    const now = nowIso();
    const id = newId();
    this.db
      .prepare(
        `INSERT INTO users (id, username, display_name, password_hash, role, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, input.username, input.displayName, input.passwordHash, input.role, now, now);
    return this.findById(id)!;
  }

  update(id: string, patch: { displayName?: string; role?: Role }): UserRow | undefined {
    const cur = this.findById(id);
    if (!cur) return undefined;
    this.db
      .prepare('UPDATE users SET display_name = ?, role = ?, updated_at = ? WHERE id = ?')
      .run(patch.displayName ?? cur.display_name, patch.role ?? cur.role, nowIso(), id);
    return this.findById(id);
  }

  /** Setzt das Passwort und erhöht token_version – dadurch werden alle ausgegebenen JWTs ungültig. */
  setPassword(id: string, passwordHash: string): void {
    this.db
      .prepare('UPDATE users SET password_hash = ?, token_version = token_version + 1, updated_at = ? WHERE id = ?')
      .run(passwordHash, nowIso(), id);
  }

  delete(id: string): boolean {
    return this.db.prepare('DELETE FROM users WHERE id = ?').run(id).changes > 0;
  }
}
