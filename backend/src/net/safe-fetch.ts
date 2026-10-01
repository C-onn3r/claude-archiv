import dns from 'node:dns';
import { Agent, fetch as undiciFetch, type RequestInit, type Response } from 'undici';
import type { Config } from '../config.js';
import { HttpError } from '../util/errors.js';
import { isBlockedAddress } from './ip-guard.js';
import { isIP } from 'node:net';

export class BlockedTargetError extends HttpError {
  constructor(host: string) {
    super(403, 'blocked_target', `Zugriff auf "${host}" ist nicht erlaubt (private oder lokale Adresse).`);
  }
}

export class ResponseTooLargeError extends HttpError {
  constructor(limit: number) {
    super(413, 'too_large', `Antwort überschreitet das Limit von ${Math.round(limit / 1024 / 1024)} MB.`);
  }
}

/**
 * HTTP-Client für alle ausgehenden Zugriffe auf fremde Ziele (Proxy + Archivierung).
 *
 * SSRF-Schutz: Die DNS-Auflösung läuft über einen eigenen `lookup`, der jede aufgelöste Adresse prüft –
 * unmittelbar vor dem Verbindungsaufbau (kein TOCTOU/DNS-Rebinding). IP-Literale umgehen `lookup`
 * und werden deshalb vorab geprüft. Redirects werden nie automatisch verfolgt, damit jeder Hop erneut geprüft wird.
 */
export class SafeFetcher {
  private readonly agent: Agent;

  constructor(private readonly config: Config, timeouts: { headersMs: number; bodyMs: number }) {
    const allowPrivate = config.allowPrivateNetworks;
    const lookup: typeof dns.lookup = ((hostname: string, options: unknown, callback: (...args: unknown[]) => void) => {
      (dns.lookup as (...a: unknown[]) => void)(hostname, options, (err: Error | null, address: unknown, family: unknown) => {
        if (err) return callback(err, address, family);
        const list = Array.isArray(address) ? (address as { address: string }[]) : [{ address: address as string }];
        if (!allowPrivate && list.some((a) => isBlockedAddress(a.address))) return callback(new BlockedTargetError(hostname));
        callback(null, address, family);
      });
    }) as typeof dns.lookup;

    this.agent = new Agent({
      connect: { lookup, timeout: timeouts.headersMs },
      headersTimeout: timeouts.headersMs,
      bodyTimeout: timeouts.bodyMs,
      connections: 32,
    });
  }

  /** Vorab-Prüfung (Schema, IP-Literal, DNS) für freundliche Fehlermeldungen beim Anlegen von Links/Archiven. */
  async assertAllowed(url: URL): Promise<void> {
    if (this.config.allowPrivateNetworks) return;
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (isIP(host)) {
      if (isBlockedAddress(host)) throw new BlockedTargetError(host);
      return;
    }
    if (host === 'localhost' || host.endsWith('.localhost')) throw new BlockedTargetError(host);
    let addrs: dns.LookupAddress[];
    try {
      addrs = await dns.promises.lookup(host, { all: true });
    } catch {
      throw HttpError.badGateway(`Host "${host}" konnte nicht aufgelöst werden.`, 'dns_failure');
    }
    if (addrs.some((a) => isBlockedAddress(a.address))) throw new BlockedTargetError(host);
  }

  /** Ein einzelner Request ohne Redirect-Following. Fehler werden in HttpError übersetzt. */
  async request(url: URL, init: RequestInit = {}, signal?: AbortSignal): Promise<Response> {
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (!this.config.allowPrivateNetworks && isIP(host) && isBlockedAddress(host)) throw new BlockedTargetError(host);
    try {
      return await undiciFetch(url, {
        ...init,
        dispatcher: this.agent,
        redirect: 'manual',
        signal,
      });
    } catch (err) {
      throw this.translate(err, url);
    }
  }

  private translate(err: unknown, url: URL): HttpError {
    if (err instanceof HttpError) return err;
    const cause = (err as { cause?: unknown })?.cause;
    if (cause instanceof HttpError) return cause;
    const code = (cause as { code?: string } | undefined)?.code ?? (err as { code?: string })?.code ?? '';
    if ((err as Error)?.name === 'AbortError' || code === 'UND_ERR_ABORTED') {
      return new HttpError(504, 'upstream_timeout', `Zeitüberschreitung beim Abruf von ${url.host}.`);
    }
    if (code.startsWith('UND_ERR_') && code.includes('TIMEOUT')) {
      return new HttpError(504, 'upstream_timeout', `Zeitüberschreitung beim Abruf von ${url.host}.`);
    }
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
      return HttpError.badGateway(`Host "${url.hostname}" konnte nicht aufgelöst werden.`, 'dns_failure');
    }
    if (code === 'ECONNREFUSED') return HttpError.badGateway(`Verbindung zu ${url.host} wurde abgelehnt.`, 'connection_refused');
    if (code.startsWith('ERR_TLS') || code.includes('CERT') || code === 'DEPTH_ZERO_SELF_SIGNED_CERT') {
      return HttpError.badGateway(`TLS-Fehler bei ${url.host}: ${code}`, 'tls_error');
    }
    const detail = (cause as Error | undefined)?.message ?? (err as Error)?.message ?? 'unbekannter Fehler';
    return HttpError.badGateway(`Abruf von ${url.host} fehlgeschlagen: ${detail}`);
  }

  async close(): Promise<void> {
    await this.agent.close();
  }
}

/** Liest einen Body vollständig, bricht aber bei Überschreiten des Limits ab. */
export async function readBodyLimited(res: Response, limit: number): Promise<Buffer> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) {
    void res.body?.cancel().catch(() => undefined);
    throw new ResponseTooLargeError(limit);
  }
  if (!res.body) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  let size = 0;
  const reader = res.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel().catch(() => undefined);
        throw new ResponseTooLargeError(limit);
      }
      chunks.push(Buffer.from(value));
    }
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw HttpError.badGateway(`Antwort konnte nicht vollständig gelesen werden: ${(err as Error).message}`);
  }
  return Buffer.concat(chunks, size);
}
