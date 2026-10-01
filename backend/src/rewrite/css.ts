export type CssRefKind = 'url' | 'import';
/** Liefert den neuen Wert oder null, wenn der Eintrag unverändert bleiben soll. */
export type CssMapper = (raw: string, kind: CssRefKind) => string | null | Promise<string | null>;

// Reihenfolge der Alternativen ist wichtig: Kommentare zuerst, damit URLs in Kommentaren unberührt bleiben.
const TOKEN =
  /\/\*[\s\S]*?\*\/|(@import\s+(?:url\(\s*)?)(["'])(.*?)\2|(url\(\s*)(?:(["'])(.*?)\5|([^)\s'"]*))(\s*\))/gi;

const SKIP = /^(?:data:|blob:|about:|#|javascript:)/i;

const quote = (v: string) => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '%22').replace(/\n/g, '')}"`;

/**
 * Schreibt alle `url(...)`- und `@import`-Referenzen eines Stylesheets um.
 * Der Mapper darf asynchron sein (Archivierung lädt Ressourcen nach); Aufrufe laufen parallel.
 */
export async function rewriteCss(css: string, mapper: CssMapper): Promise<string> {
  interface Hit {
    start: number;
    end: number;
    build: (value: string) => string;
    raw: string;
    kind: CssRefKind;
  }
  const hits: Hit[] = [];
  for (const m of css.matchAll(TOKEN)) {
    const start = m.index!;
    const end = start + m[0].length;
    if (m[1] !== undefined) {
      const prefix = m[1];
      hits.push({ start, end, raw: m[3] ?? '', kind: 'import', build: (v) => `${prefix}${quote(v)}` });
    } else if (m[4] !== undefined) {
      const prefix = m[4];
      const suffix = m[8] ?? ')';
      hits.push({ start, end, raw: (m[6] ?? m[7] ?? '').trim(), kind: 'url', build: (v) => `${prefix}${quote(v)}${suffix}` });
    }
  }
  const results = await Promise.all(
    hits.map((h) => (h.raw === '' || SKIP.test(h.raw) ? null : Promise.resolve(mapper(h.raw, h.kind)))),
  );
  let out = '';
  let cursor = 0;
  hits.forEach((h, i) => {
    out += css.slice(cursor, h.start);
    const replacement = results[i];
    out += replacement == null ? css.slice(h.start, h.end) : h.build(replacement);
    cursor = h.end;
  });
  return out + css.slice(cursor);
}
