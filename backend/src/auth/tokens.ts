import { SignJWT, jwtVerify } from 'jose';
import type { Config } from '../config.js';
import type { Role, UserRow } from '../repos/users.js';

export type TokenType = 'access' | 'content';

export interface TokenClaims {
  sub: string;
  role: Role;
  /** token_version des Benutzers zum Ausstellungszeitpunkt. */
  tv: number;
  typ: TokenType;
}

const ISSUER = 'web-archiver';

export class TokenService {
  private readonly key: Uint8Array;

  constructor(private readonly config: Config) {
    this.key = new TextEncoder().encode(config.jwtSecret);
  }

  private sign(user: UserRow, typ: TokenType, ttlSec: number): Promise<string> {
    return new SignJWT({ role: user.role, tv: user.token_version, typ })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user.id)
      .setIssuer(ISSUER)
      .setIssuedAt()
      .setExpirationTime(`${ttlSec}s`)
      .sign(this.key);
  }

  signAccess(user: UserRow): Promise<string> {
    return this.sign(user, 'access', this.config.accessTokenTtlSec);
  }

  /** Kurzlebiges Token für URLs (iframe/WebView), das ausschließlich Proxy-/Archiv-Inhalte freischaltet. */
  async signContent(user: UserRow): Promise<{ token: string; expiresAt: string }> {
    const token = await this.sign(user, 'content', this.config.contentTokenTtlSec);
    return { token, expiresAt: new Date(Date.now() + this.config.contentTokenTtlSec * 1000).toISOString() };
  }

  /** Gibt die Claims zurück oder null bei ungültigem/abgelaufenem Token bzw. falschem Typ. */
  async verify(token: string, expected: TokenType): Promise<TokenClaims | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, { issuer: ISSUER, algorithms: ['HS256'] });
      if (payload.typ !== expected || typeof payload.sub !== 'string') return null;
      return { sub: payload.sub, role: payload.role as Role, tv: Number(payload.tv), typ: expected };
    } catch {
      return null;
    }
  }
}
