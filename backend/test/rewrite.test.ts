import { describe, expect, it } from 'vitest';
import { rewriteCss } from '../src/rewrite/css.js';
import { parseSrcset, stringifySrcset } from '../src/rewrite/srcset.js';
import { decodeText } from '../src/rewrite/charset.js';
import { isBlockedAddress } from '../src/net/ip-guard.js';
import { parseTargetUrl } from '../src/net/url-utils.js';
import { relativeLink, localPathFor } from '../src/archive/engine.js';
import { rewriteHtml } from '../src/rewrite/html.js';

describe('rewriteCss', () => {
  it('schreibt url() und @import um, lässt data:-URIs und Kommentare unberührt', async () => {
    const css = `@import "a.css"; @import url(b.css);
/* url(c.png) */
.x{background:url( 'd.png' ) , url(data:image/png;base64,AAA)} .y{src:url(e.woff2)format("woff2")}`;
    const seen: string[] = [];
    const out = await rewriteCss(css, async (raw) => {
      seen.push(raw);
      return `/p/${raw}`;
    });
    expect(seen).toEqual(['a.css', 'b.css', 'd.png', 'e.woff2']);
    expect(out).toContain('@import "/p/a.css"');
    expect(out).toContain('@import url("/p/b.css")');
    expect(out).toContain('/* url(c.png) */');
    expect(out).toContain('"/p/d.png"');
    expect(out).toContain('url(data:image/png;base64,AAA)');
    expect(out).toContain('url("/p/e.woff2")format("woff2")');
  });
});

describe('srcset', () => {
  it('parst Kandidaten inkl. Kommas in URLs und Deskriptoren', () => {
    const c = parseSrcset('a.png 1x, b.png 2x,c.png, data:image/png;base64,AA,BB 3x');
    expect(c).toEqual([
      { url: 'a.png', descriptor: '1x' },
      { url: 'b.png', descriptor: '2x' },
      { url: 'c.png', descriptor: '' },
      { url: 'data:image/png;base64,AA,BB', descriptor: '3x' },
    ]);
    expect(stringifySrcset(c.slice(0, 2))).toBe('a.png 1x, b.png 2x');
  });
});

describe('charset', () => {
  it('beachtet Header, meta und BOM', () => {
    const latin = Buffer.from('<p>äöü</p>', 'latin1');
    expect(decodeText(latin, 'text/html; charset=iso-8859-1', 'html')).toContain('äöü');
    expect(decodeText(Buffer.from('<meta charset="windows-1252"><p>ä</p>', 'latin1'), 'text/html', 'html')).toContain('ä');
    expect(decodeText(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('ä')]), 'text/html', 'html')).toBe('ä');
  });
});

describe('SSRF-Adressprüfung', () => {
  it.each(['127.0.0.1', '10.1.2.3', '192.168.0.5', '172.20.0.1', '169.254.169.254', '0.0.0.0', '::1', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '100.64.0.1', 'not-an-ip'])(
    'blockiert %s',
    (ip) => expect(isBlockedAddress(ip)).toBe(true),
  );
  it.each(['8.8.8.8', '93.184.216.34', '2606:4700:4700::1111', '::ffff:8.8.8.8'])('erlaubt %s', (ip) => expect(isBlockedAddress(ip)).toBe(false));
});

describe('parseTargetUrl', () => {
  it('ergänzt https, lehnt andere Schemata und Zugangsdaten ab', () => {
    expect(parseTargetUrl('example.com/a?b=1').href).toBe('https://example.com/a?b=1');
    expect(parseTargetUrl('localhost:3000/x').href).toBe('https://localhost:3000/x');
    expect(parseTargetUrl('http://example.com').protocol).toBe('http:');
    for (const bad of ['', 'javascript:alert(1)', 'file:///etc/passwd', 'ftp://x.org', 'https://user:pw@example.com', 'data:text/html,hi']) {
      expect(() => parseTargetUrl(bad), bad).toThrow();
    }
  });
});

describe('Archiv-Pfade', () => {
  it('berechnet relative Links und sichere lokale Dateinamen', () => {
    expect(relativeLink('index.html', 'assets/a.css')).toBe('assets/a.css');
    expect(relativeLink('assets/a.css', 'assets/b.woff2')).toBe('b.woff2');
    expect(relativeLink('pages/p.html', 'assets/b.png')).toBe('../assets/b.png');
    const p = localPathFor(new URL('https://example.com/../a b/../../évil%2F..%2Fname.JPG?x=1'), 'image/jpeg', 'assets');
    expect(p).toMatch(/^assets\/[0-9a-f]{10}-[A-Za-z0-9._-]+\.jpg$/);
  });
});

describe('rewriteHtml', () => {
  it('löst <base> auf, entfernt integrity/CSP-Metas und rewritet meta refresh', async () => {
    const out = await rewriteHtml(
      '<html><head><base href="https://cdn.test/dir/"><meta http-equiv="Content-Security-Policy" content="default-src none"><meta http-equiv="refresh" content="3; url=next.html"></head><body><script src="x.js" integrity="sha"></script></body></html>',
      { documentUrl: new URL('https://site.test/'), mapUrl: ({ url }) => `/m/${url.href}` },
    );
    expect(out.html).not.toContain('<base');
    expect(out.html).not.toContain('Content-Security-Policy');
    expect(out.html).not.toContain('integrity');
    expect(out.html).toContain('src="/m/https://cdn.test/dir/x.js"');
    expect(out.html).toContain('content="3; url=/m/https://cdn.test/dir/next.html"');
  });
});

describe('Client-Skripte', () => {
  it('erzeugen syntaktisch gültiges JavaScript und escapen die Konfiguration', async () => {
    const { buildProxyShim, buildArchiveShim } = await import('../src/rewrite/shim.js');
    const { Script } = await import('node:vm');
    for (const markup of [buildProxyShim('/proxy/tok/', 'https://x.test/</script><b>'), buildArchiveShim()]) {
      const scripts = [...markup.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
      expect(scripts.length).toBeGreaterThan(0);
      for (const code of scripts) expect(() => new Script(code)).not.toThrow();
    }
    expect(buildProxyShim('/proxy/tok/', 'https://x.test/</script><b>')).not.toContain('</script><b>');
  });
});
