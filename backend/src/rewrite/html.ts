import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';
import { isHttpUrl, tryResolve } from '../net/url-utils.js';
import { rewriteCss } from './css.js';
import { parseSrcset, stringifySrcset } from './srcset.js';

export type RefKind = 'navigation' | 'form' | 'frame' | 'script' | 'style' | 'resource';

export interface RefContext {
  /** Absolut aufgelöste Ziel-URL (immer http/https). */
  url: URL;
  kind: RefKind;
  tag: string;
  attr: string;
  el: Element;
  /** true, wenn die Referenz aus einem `<style>`-Block / style-Attribut bzw. @import stammt. */
  fromCss?: boolean;
}

/** Liefert den neuen Attributwert oder null, wenn die Referenz nur absolut gemacht werden soll. */
export type UrlMapper = (ctx: RefContext) => string | null | Promise<string | null>;

export interface HtmlRewriteOptions {
  /** URL des Dokuments (nach Redirects). `<base href>` wird automatisch berücksichtigt. */
  documentUrl: URL;
  mapUrl: UrlMapper;
  /** Wird für jedes Element aufgerufen, nachdem seine URLs umgeschrieben wurden (z. B. für target-Attribute). */
  onElement?: (el: Element, $: CheerioAPI) => void;
  /** Skripte, Inline-Handler und javascript:-URLs entfernen (statischer Schnappschuss). */
  stripScripts?: boolean;
  /** Zusätzliches Markup, das als erstes Kind in `<head>` eingefügt wird (z. B. Proxy-Shim). */
  headPrepend?: string;
}

const NON_FETCHABLE = /^(?:#|data:|blob:|about:|javascript:|mailto:|tel:|sms:|cid:|file:)/i;

const LAZY_ATTRS = ['data-src', 'data-original', 'data-lazy-src', 'data-lazy', 'data-url', 'data-poster', 'data-bg'];
const LAZY_SRCSET_ATTRS = ['data-srcset', 'data-lazy-srcset'];

interface Ref {
  el: Element;
  attr: string;
  kind: RefKind;
  /** Mehrere Kandidaten (srcset) bzw. meta-refresh-Syntax. */
  mode: 'single' | 'srcset' | 'refresh';
}

const RES_ONLY_ATTRS: Record<string, string[]> = {
  img: ['src', 'lowsrc'],
  source: ['src'],
  video: ['src', 'poster'],
  audio: ['src'],
  track: ['src'],
  embed: ['src'],
  object: ['data'],
  input: ['src'],
  body: ['background'],
  table: ['background'],
  td: ['background'],
  th: ['background'],
  use: ['href', 'xlink:href'],
  image: ['href', 'xlink:href'],
  feimage: ['href', 'xlink:href'],
};

const HINT_RELS = new Set(['dns-prefetch', 'preconnect', 'prefetch', 'prerender', 'manifest']);
const RESOURCE_RELS = new Set([
  'stylesheet',
  'icon',
  'shortcut',
  'apple-touch-icon',
  'apple-touch-icon-precomposed',
  'mask-icon',
  'image_src',
  'preload',
  'modulepreload',
]);

function collectRefs($: CheerioAPI): Ref[] {
  const refs: Ref[] = [];
  const toRemove: Element[] = [];
  $('*').each((_, node) => {
    const el = node as Element;
    const tag = el.tagName?.toLowerCase();
    if (!tag) return;
    const has = (a: string) => el.attribs[a] !== undefined;

    switch (tag) {
      case 'a':
      case 'area':
        if (has('href')) refs.push({ el, attr: 'href', kind: 'navigation', mode: 'single' });
        break;
      case 'link': {
        if (!has('href')) break;
        const rels = (el.attribs.rel ?? '').toLowerCase().split(/\s+/).filter(Boolean);
        if (rels.some((r) => HINT_RELS.has(r))) {
          toRemove.push(el);
        } else if (rels.some((r) => RESOURCE_RELS.has(r))) {
          refs.push({ el, attr: 'href', kind: rels.includes('stylesheet') ? 'style' : 'resource', mode: 'single' });
          if (has('imagesrcset')) refs.push({ el, attr: 'imagesrcset', kind: 'resource', mode: 'srcset' });
        } else {
          refs.push({ el, attr: 'href', kind: 'navigation', mode: 'single' });
        }
        break;
      }
      case 'script':
        if (has('src')) refs.push({ el, attr: 'src', kind: 'script', mode: 'single' });
        break;
      case 'iframe':
      case 'frame':
        if (has('src')) refs.push({ el, attr: 'src', kind: 'frame', mode: 'single' });
        break;
      case 'form':
        if (has('action')) refs.push({ el, attr: 'action', kind: 'form', mode: 'single' });
        break;
      case 'button':
      case 'input':
        if (has('formaction')) refs.push({ el, attr: 'formaction', kind: 'form', mode: 'single' });
        break;
      case 'meta':
        if ((el.attribs['http-equiv'] ?? '').toLowerCase() === 'refresh' && has('content')) {
          refs.push({ el, attr: 'content', kind: 'navigation', mode: 'refresh' });
        }
        break;
    }

    for (const attr of RES_ONLY_ATTRS[tag] ?? []) {
      if (!has(attr)) continue;
      if (tag === 'input' && (el.attribs.type ?? '').toLowerCase() !== 'image') continue;
      refs.push({ el, attr, kind: 'resource', mode: 'single' });
    }
    if (tag === 'img' || tag === 'source') {
      if (has('srcset')) refs.push({ el, attr: 'srcset', kind: 'resource', mode: 'srcset' });
    }
    if (tag === 'img' || tag === 'source' || tag === 'video' || tag === 'div' || tag === 'section' || tag === 'picture') {
      for (const attr of LAZY_ATTRS) {
        const v = el.attribs[attr];
        if (v !== undefined && v.trim() !== '' && !/\s/.test(v.trim())) refs.push({ el, attr, kind: 'resource', mode: 'single' });
      }
      for (const attr of LAZY_SRCSET_ATTRS) if (has(attr)) refs.push({ el, attr, kind: 'resource', mode: 'srcset' });
    }
  });
  for (const el of toRemove) $(el).remove();
  return refs;
}

function parseRefresh(content: string): { prefix: string; url: string } | null {
  const m = /^(\s*[\d.]*\s*[;,]\s*(?:url\s*=\s*)?)(["']?)([^"']*)\2\s*$/i.exec(content);
  return m ? { prefix: m[1]!, url: m[3]! } : null;
}

async function mapOne(
  raw: string,
  base: URL,
  ref: { kind: RefKind; tag: string; attr: string; el: Element; fromCss?: boolean },
  mapUrl: UrlMapper,
): Promise<string> {
  const trimmed = raw.trim();
  if (trimmed === '' || NON_FETCHABLE.test(trimmed)) return raw;
  const url = tryResolve(trimmed, base);
  if (!url || !isHttpUrl(url)) return raw;
  const mapped = await mapUrl({ url, ...ref });
  return mapped ?? url.href;
}

/**
 * Schreibt ein HTML-Dokument um. Alle URL-tragenden Attribute (inkl. srcset, meta refresh, inline CSS) werden
 * absolut aufgelöst und durch `mapUrl` abgebildet. Die eigentliche Strategie (Proxy-URL vs. lokale Datei)
 * liegt komplett im Mapper – dieser Code kennt weder Proxy noch Archiv.
 */
export async function rewriteHtml(html: string, opts: HtmlRewriteOptions): Promise<{ html: string; title: string; description: string; $: CheerioAPI }> {
  const $ = cheerio.load(html);

  // <base href> bestimmt die Auflösungsbasis, wird danach aber entfernt (alle URLs sind danach absolut/umgeschrieben).
  let base = opts.documentUrl;
  const baseEl = $('base[href]').first();
  if (baseEl.length) {
    const b = tryResolve(baseEl.attr('href') ?? '', opts.documentUrl);
    if (b && isHttpUrl(b)) base = b;
  }
  $('base').remove();

  // Inhalts-Sicherheits- und Charset-Metas passen nach dem Umschreiben nicht mehr (Antworten sind immer UTF-8).
  $('meta[http-equiv]').each((_, el) => {
    const v = ($(el).attr('http-equiv') ?? '').toLowerCase();
    if (v === 'content-security-policy' || v === 'content-security-policy-report-only' || v === 'content-type') $(el).remove();
  });
  $('meta[charset]').remove();
  $('head').prepend('<meta charset="utf-8">');
  const charsetMeta = $('head > meta[charset]').first();

  if (opts.stripScripts) {
    $('script').remove();
    $('noscript').each((_, el) => {
      $(el).replaceWith($(el).text());
    });
  }

  const refs = collectRefs($);
  await Promise.all(
    refs.map(async (r) => {
      const tag = r.el.tagName.toLowerCase();
      const raw = r.el.attribs[r.attr] ?? '';
      const ctx = { kind: r.kind, tag, attr: r.attr, el: r.el };
      if (r.mode === 'single') {
        r.el.attribs[r.attr] = await mapOne(raw, base, ctx, opts.mapUrl);
      } else if (r.mode === 'srcset') {
        const cands = parseSrcset(raw);
        for (const c of cands) c.url = await mapOne(c.url, base, ctx, opts.mapUrl);
        r.el.attribs[r.attr] = stringifySrcset(cands);
      } else {
        const parsed = parseRefresh(raw);
        if (parsed) r.el.attribs[r.attr] = `${parsed.prefix}${await mapOne(parsed.url, base, ctx, opts.mapUrl)}`;
      }
    }),
  );

  // Inline-CSS: <style>-Blöcke und style-Attribute
  const cssJobs: Promise<void>[] = [];
  const cssMapper = (el: Element, tag: string, attr: string) => async (raw: string, kind: 'url' | 'import') => {
    const out = await mapOne(raw, base, { kind: kind === 'import' ? 'style' : 'resource', tag, attr, el, fromCss: true }, opts.mapUrl);
    return out === raw ? null : out;
  };
  $('style').each((_, node) => {
    const el = node as Element;
    const css = $(el).text();
    if (!css.trim()) return;
    cssJobs.push(
      rewriteCss(css, cssMapper(el, 'style', '#text')).then((out) => {
        $(el).text(out);
      }),
    );
  });
  $('[style]').each((_, node) => {
    const el = node as Element;
    const css = el.attribs.style ?? '';
    if (!/url\(/i.test(css)) return;
    cssJobs.push(
      rewriteCss(css, cssMapper(el, el.tagName.toLowerCase(), 'style')).then((out) => {
        el.attribs.style = out;
      }),
    );
  });
  await Promise.all(cssJobs);

  if (opts.stripScripts) {
    $('*').each((_, node) => {
      const el = node as Element;
      for (const name of Object.keys(el.attribs)) {
        if (/^on[a-z]+$/i.test(name)) delete el.attribs[name];
        else if ((name === 'href' || name === 'src' || name === 'action') && /^\s*javascript:/i.test(el.attribs[name] ?? '')) {
          el.attribs[name] = '#';
        }
      }
    });
  }

  // integrity würde nach dem Umschreiben fehlschlagen
  $('[integrity]').removeAttr('integrity');

  if (opts.onElement) $('*').each((_, node) => opts.onElement!(node as Element, $));
  if (opts.headPrepend) charsetMeta.after(opts.headPrepend);

  const title = $('head > title').first().text().trim() || $('title').first().text().trim();
  const description =
    ($('meta[name="description"]').attr('content') ?? $('meta[property="og:description"]').attr('content') ?? '').trim();
  return { html: $.html(), title, description, $ };
}
