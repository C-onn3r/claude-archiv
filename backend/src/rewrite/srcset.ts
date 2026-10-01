export interface SrcsetCandidate {
  url: string;
  descriptor: string;
}

/** Parser nach HTML-Spezifikation (vereinfacht): URLs dürfen Kommas enthalten (z. B. data:-URIs). */
export function parseSrcset(value: string): SrcsetCandidate[] {
  const out: SrcsetCandidate[] = [];
  let i = 0;
  const n = value.length;
  while (i < n) {
    while (i < n && /[\s,]/.test(value[i]!)) i++;
    if (i >= n) break;
    let start = i;
    while (i < n && !/\s/.test(value[i]!)) i++;
    let url = value.slice(start, i);
    let descriptor = '';
    if (url.endsWith(',')) {
      url = url.replace(/,+$/, '');
    } else {
      start = i;
      let depth = 0;
      while (i < n) {
        const c = value[i]!;
        if (c === '(') depth++;
        else if (c === ')') depth = Math.max(0, depth - 1);
        else if (c === ',' && depth === 0) break;
        i++;
      }
      descriptor = value.slice(start, i).trim();
    }
    if (url) out.push({ url, descriptor });
  }
  return out;
}

export const stringifySrcset = (c: SrcsetCandidate[]): string =>
  c.map((x) => (x.descriptor ? `${x.url} ${x.descriptor}` : x.url)).join(', ');
