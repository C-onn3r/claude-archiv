/**
 * Versionierte Schema-Migrationen. Neue Migrationen werden nur ans Ende angehängt;
 * bereits ausgelieferte Einträge dürfen nicht mehr verändert werden.
 */
export const migrations: { id: number; name: string; sql: string }[] = [
  {
    id: 1,
    name: 'init',
    sql: `
      CREATE TABLE users (
        id            TEXT PRIMARY KEY,
        username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
        display_name  TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role          TEXT NOT NULL CHECK (role IN ('admin','user')),
        token_version INTEGER NOT NULL DEFAULT 0,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL
      );

      CREATE TABLE refresh_tokens (
        id          TEXT PRIMARY KEY,
        user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash  TEXT NOT NULL UNIQUE,
        user_agent  TEXT,
        created_at  TEXT NOT NULL,
        expires_at  TEXT NOT NULL,
        revoked_at  TEXT
      );
      CREATE INDEX idx_refresh_user ON refresh_tokens(user_id);

      CREATE TABLE archives (
        id           TEXT PRIMARY KEY,
        user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        url          TEXT NOT NULL,
        final_url    TEXT,
        title        TEXT NOT NULL DEFAULT '',
        description  TEXT NOT NULL DEFAULT '',
        status       TEXT NOT NULL CHECK (status IN ('pending','running','done','failed')),
        error        TEXT,
        options      TEXT NOT NULL DEFAULT '{}',
        tags         TEXT NOT NULL DEFAULT '[]',
        entry_path   TEXT NOT NULL DEFAULT 'index.html',
        asset_count  INTEGER NOT NULL DEFAULT 0,
        failed_count INTEGER NOT NULL DEFAULT 0,
        total_bytes  INTEGER NOT NULL DEFAULT 0,
        created_at   TEXT NOT NULL,
        started_at   TEXT,
        finished_at  TEXT
      );
      CREATE INDEX idx_archives_user_created ON archives(user_id, created_at DESC);

      CREATE TABLE archive_resources (
        archive_id  TEXT NOT NULL REFERENCES archives(id) ON DELETE CASCADE,
        url         TEXT NOT NULL,
        local_path  TEXT,
        mime        TEXT,
        size        INTEGER NOT NULL DEFAULT 0,
        status      TEXT NOT NULL CHECK (status IN ('stored','failed','skipped')),
        error       TEXT,
        PRIMARY KEY (archive_id, url)
      );
      CREATE INDEX idx_resources_path ON archive_resources(archive_id, local_path);
    `,
  },
];
