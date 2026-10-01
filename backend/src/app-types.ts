import type { Config } from './config.js';
import type { Db } from './db/index.js';
import type { TokenService } from './auth/tokens.js';
import type { UserRepo, UserRow } from './repos/users.js';
import type { RefreshTokenRepo } from './repos/refreshTokens.js';
import type { ArchiveRepo } from './repos/archives.js';
import type { SafeFetcher } from './net/safe-fetch.js';
import type { ArchiveService } from './archive/service.js';
import type { ArchiveStorage } from './archive/storage.js';
import type { PdfService } from './archive/pdf.js';

/** Alle langlebigen Abhängigkeiten der Anwendung an einer Stelle (einfach austauschbar in Tests). */
export interface Services {
  config: Config;
  db: Db;
  users: UserRepo;
  refreshTokens: RefreshTokenRepo;
  archives: ArchiveRepo;
  tokens: TokenService;
  /** Fetcher für Live-Proxy (interaktives Browsen). */
  proxyFetcher: SafeFetcher;
  archiveStorage: ArchiveStorage;
  archiveService: ArchiveService;
  pdf: PdfService;
}

declare module 'fastify' {
  interface FastifyInstance {
    services: Services;
    authenticate: (request: FastifyRequest) => Promise<void>;
    requireAdmin: (request: FastifyRequest) => Promise<void>;
  }
  interface FastifyRequest {
    user: UserRow | null;
  }
}
