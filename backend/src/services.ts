import type { FastifyBaseLogger } from 'fastify';
import type { Services } from './app-types.js';
import { ArchiveService } from './archive/service.js';
import { ArchiveStorage } from './archive/storage.js';
import { TokenService } from './auth/tokens.js';
import type { Config } from './config.js';
import { openDatabase } from './db/index.js';
import { SafeFetcher } from './net/safe-fetch.js';
import { ArchiveRepo } from './repos/archives.js';
import { RefreshTokenRepo } from './repos/refreshTokens.js';
import { UserRepo } from './repos/users.js';

/** Verdrahtet alle Dienste. Einziger Ort, an dem konkrete Implementierungen ausgewählt werden. */
export function createServices(config: Config, log: FastifyBaseLogger): Services {
  const db = openDatabase(config.dbFile);
  const archives = new ArchiveRepo(db);
  const archiveStorage = new ArchiveStorage(config.archivesDir);
  const archiveFetcher = new SafeFetcher(config, { headersMs: config.archive.timeoutMs, bodyMs: config.archive.timeoutMs });
  const proxyFetcher = new SafeFetcher(config, { headersMs: config.proxy.timeoutMs, bodyMs: config.proxy.timeoutMs * 3 });
  return {
    config,
    db,
    users: new UserRepo(db),
    refreshTokens: new RefreshTokenRepo(db),
    archives,
    tokens: new TokenService(config),
    proxyFetcher,
    archiveStorage,
    archiveService: new ArchiveService({ config, repo: archives, storage: archiveStorage, fetcher: archiveFetcher, log }),
  };
}
