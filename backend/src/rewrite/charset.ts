const HTML_META = /<meta[^>]+charset\s*=\s*["']?\s*([a-z0-9_:.-]+)/i;
const CSS_CHARSET = /^@charset\s+["']([a-z0-9_:.-]+)["']/i;

function fromContentType(contentType: string | null | undefined): string | null {
  const m = /charset\s*=\s*"?([^\s;"]+)/i.exec(contentType ?? '');
  return m ? m[1]! : null;
}

function bomEncoding(buf: Buffer): { label: string; skip: number } | null {
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return { label: 'utf-8', skip: 3 };
  if (buf[0] === 0xff && buf[1] === 0xfe) return { label: 'utf-16le', skip: 2 };
  if (buf[0] === 0xfe && buf[1] === 0xff) return { label: 'utf-16be', skip: 2 };
  return null;
}

function decodeWith(buf: Buffer, label: string): string | null {
  try {
    return new TextDecoder(label.trim().toLowerCase(), { fatal: false, ignoreBOM: false }).decode(buf);
  } catch {
    return null;
  }
}

/** Dekodiert Text nach der Priorität BOM > HTTP-Header > <meta>/@charset > UTF-8. */
export function decodeText(buf: Buffer, contentType: string | null | undefined, kind: 'html' | 'css'): string {
  const bom = bomEncoding(buf);
  if (bom) return decodeWith(buf.subarray(bom.skip), bom.label) ?? buf.toString('utf8');
  const header = fromContentType(contentType);
  if (header) {
    const t = decodeWith(buf, header);
    if (t !== null) return t;
  }
  const head = buf.subarray(0, 4096).toString('latin1');
  const declared = (kind === 'html' ? HTML_META : CSS_CHARSET).exec(head)?.[1];
  if (declared) {
    const t = decodeWith(buf, declared);
    if (t !== null) return t;
  }
  return buf.toString('utf8');
}

/** Entfernt Charset-Deklarationen, da der Inhalt nach dem Dekodieren immer als UTF-8 ausgeliefert wird. */
export const stripCssCharset = (css: string): string => css.replace(CSS_CHARSET, '').replace(/^﻿/, '');
