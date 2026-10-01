/**
 * Client-Skript, das in jede geproxte HTML-Seite eingefügt wird (als erstes Skript im <head>).
 *
 * Aufgaben:
 *  - dynamisch erzeugte URLs (fetch, XHR, setAttribute, src/href-Setter, innerHTML, history, window.open) durch den Proxy leiten
 *  - localStorage/sessionStorage/document.cookie durch In-Memory-Varianten ersetzen, falls die Seite in einer
 *    Sandbox (undurchsichtiger Origin) läuft und der Zugriff sonst eine SecurityError wirft
 *  - die aktuelle echte URL + Titel per postMessage an die einbettende Viewer-Komponente melden und
 *    Navigationsbefehle (zurück/vor/neu laden) von dort entgegennehmen
 *
 * Hinweis: Dieser Quelltext darf weder Backticks noch "${" enthalten (er liegt in einem Template-String).
 */
const SHIM_SOURCE = String.raw`(function () {
  'use strict';
  var cfg = window.__WEB_ARCHIVER__;
  if (!cfg || window.__WEB_ARCHIVER_ACTIVE__) return;
  window.__WEB_ARCHIVER_ACTIVE__ = true;
  var PREFIX = cfg.prefix;
  var ORIGIN = location.origin === 'null' ? (location.protocol + '//' + location.host) : location.origin;

  function realFromLocation(href) {
    try {
      var u = new URL(href, location.href);
      if (u.pathname.indexOf(PREFIX) !== 0) return null;
      var rest = u.pathname.slice(PREFIX.length);
      var i = rest.indexOf('/');
      if (i < 0) return null;
      var scheme = rest.slice(0, i);
      rest = rest.slice(i + 1);
      var j = rest.indexOf('/');
      var host = j < 0 ? rest : rest.slice(0, j);
      var path = j < 0 ? '/' : rest.slice(j);
      return new URL(scheme + '://' + host + path + u.search + u.hash);
    } catch (e) { return null; }
  }
  function realBase() { return realFromLocation(location.href) || new URL(cfg.base); }

  function proxify(u) {
    return ORIGIN + PREFIX + u.protocol.slice(0, -1) + '/' + u.host + u.pathname + u.search + u.hash;
  }

  function toProxy(input) {
    try {
      if (input == null) return input;
      var str = String(input);
      if (/^\s*(#|data:|blob:|javascript:|about:|mailto:|tel:)/i.test(str)) return input;
      var abs = new URL(str, location.href);
      if (abs.protocol !== 'http:' && abs.protocol !== 'https:') return input;
      if (abs.origin === ORIGIN) {
        if (abs.pathname.indexOf(PREFIX) === 0) return abs.href;
        // Root-relativer Pfad, der gegen den Proxy-Host aufgelöst wurde -> gegen die echte Seite auflösen
        var real = new URL(abs.pathname + abs.search + abs.hash, realBase());
        return proxify(real);
      }
      return proxify(abs);
    } catch (e) { return input; }
  }

  function rewriteSrcset(v) {
    return String(v).split(/,\s+/).map(function (part) {
      var p = part.trim().split(/\s+/);
      if (!p[0]) return part;
      p[0] = toProxy(p[0]);
      return p.join(' ');
    }).join(', ');
  }

  // ---- Netzwerk ------------------------------------------------------------------------------
  if (window.fetch) {
    var origFetch = window.fetch;
    window.fetch = function (input, init) {
      try {
        if (typeof input === 'string' || (window.URL && input instanceof URL)) input = toProxy(input);
        else if (window.Request && input instanceof Request) input = new Request(toProxy(input.url), input);
      } catch (e) {}
      return origFetch.call(this, input, init);
    };
  }
  if (window.XMLHttpRequest) {
    var origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
      var args = Array.prototype.slice.call(arguments);
      args[1] = toProxy(url);
      return origOpen.apply(this, args);
    };
  }
  if (navigator.sendBeacon) {
    var origBeacon = navigator.sendBeacon;
    navigator.sendBeacon = function (url, data) { return origBeacon.call(navigator, toProxy(url), data); };
  }
  if (window.EventSource) {
    var OrigES = window.EventSource;
    window.EventSource = function (url, init) { return new OrigES(toProxy(url), init); };
    window.EventSource.prototype = OrigES.prototype;
  }
  var origWindowOpen = window.open;
  window.open = function (url) {
    var args = Array.prototype.slice.call(arguments);
    if (url) args[0] = toProxy(url);
    return origWindowOpen.apply(window, args);
  };

  // ---- DOM: Attribute und Properties ----------------------------------------------------------
  var URL_ATTRS = { src: 1, href: 1, action: 1, poster: 1, data: 1, formaction: 1, 'xlink:href': 1, background: 1 };
  var origSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    var n = String(name).toLowerCase();
    if (URL_ATTRS[n] === 1 && n !== 'data' || (n === 'data' && this.tagName === 'OBJECT')) value = toProxy(value);
    else if (n === 'srcset') value = rewriteSrcset(value);
    return origSetAttribute.call(this, name, value);
  };

  function patchProp(ctorName, prop, fn) {
    var C = window[ctorName];
    if (!C || !C.prototype) return;
    var d = Object.getOwnPropertyDescriptor(C.prototype, prop);
    if (!d || !d.set) return;
    Object.defineProperty(C.prototype, prop, {
      configurable: true, enumerable: d.enumerable, get: d.get,
      set: function (v) { d.set.call(this, fn(v)); }
    });
  }
  [['HTMLImageElement', 'src'], ['HTMLScriptElement', 'src'], ['HTMLLinkElement', 'href'],
   ['HTMLAnchorElement', 'href'], ['HTMLAreaElement', 'href'], ['HTMLIFrameElement', 'src'],
   ['HTMLSourceElement', 'src'], ['HTMLMediaElement', 'src'], ['HTMLVideoElement', 'poster'],
   ['HTMLFormElement', 'action'], ['HTMLEmbedElement', 'src'], ['HTMLObjectElement', 'data'],
   ['HTMLInputElement', 'src'], ['HTMLTrackElement', 'src']
  ].forEach(function (p) { patchProp(p[0], p[1], toProxy); });
  patchProp('HTMLImageElement', 'srcset', rewriteSrcset);
  patchProp('HTMLSourceElement', 'srcset', rewriteSrcset);

  // CSS-Eigenschaften mit url(...)
  function rewriteCssValue(v) {
    return String(v).replace(/url\(\s*(["']?)([^)"']*)\1\s*\)/gi, function (m, q, u) { return 'url("' + toProxy(u) + '")'; });
  }
  if (window.CSSStyleDeclaration) {
    var origSetProperty = CSSStyleDeclaration.prototype.setProperty;
    CSSStyleDeclaration.prototype.setProperty = function (name, value, prio) {
      return origSetProperty.call(this, name, value == null ? value : rewriteCssValue(value), prio);
    };
    ['backgroundImage', 'background', 'listStyleImage', 'borderImage', 'maskImage', 'webkitMaskImage', 'content', 'cursor'].forEach(function (prop) {
      var d = Object.getOwnPropertyDescriptor(CSSStyleDeclaration.prototype, prop);
      if (!d || !d.set) return;
      Object.defineProperty(CSSStyleDeclaration.prototype, prop, {
        configurable: true, enumerable: d.enumerable, get: d.get,
        set: function (v) { d.set.call(this, rewriteCssValue(v)); }
      });
    });
  }

  // Elemente, die per innerHTML & Co. entstehen, nachträglich korrigieren
  var FIX_SELECTOR = '[src],[href],[srcset],[action],[poster],[data],[formaction]';
  function fixElement(el) {
    if (el.nodeType !== 1) return;
    ['src', 'href', 'action', 'poster', 'formaction'].forEach(function (a) {
      var v = el.getAttribute(a);
      if (v == null) return;
      var nv = toProxy(v);
      if (nv !== v) origSetAttribute.call(el, a, nv);
    });
    var ss = el.getAttribute('srcset');
    if (ss) { var ns = rewriteSrcset(ss); if (ns !== ss) origSetAttribute.call(el, 'srcset', ns); }
  }
  function fixTree(root) {
    fixElement(root);
    if (root.querySelectorAll) Array.prototype.forEach.call(root.querySelectorAll(FIX_SELECTOR), fixElement);
  }
  new MutationObserver(function (muts) {
    for (var i = 0; i < muts.length; i++) {
      var added = muts[i].addedNodes;
      for (var j = 0; j < added.length; j++) fixTree(added[j]);
    }
  }).observe(document, { childList: true, subtree: true });

  // ---- History / Navigation --------------------------------------------------------------------
  ['pushState', 'replaceState'].forEach(function (m) {
    var orig = history[m];
    history[m] = function (state, title, url) {
      var r = orig.call(history, state, title, url == null ? url : toProxy(url));
      notify();
      return r;
    };
  });

  // ---- Kommunikation mit dem Viewer --------------------------------------------------------------
  function notify() {
    try {
      var real = realBase();
      parent.postMessage({ source: 'web-archiver', type: 'location', url: real.href, title: document.title || '' }, '*');
    } catch (e) {}
  }
  window.addEventListener('message', function (e) {
    if (e.source !== parent) return;
    var d = e.data;
    if (!d || d.source !== 'web-archiver-host') return;
    if (d.cmd === 'back') history.back();
    else if (d.cmd === 'forward') history.forward();
    else if (d.cmd === 'reload') location.reload();
  });
  window.addEventListener('popstate', notify);
  window.addEventListener('hashchange', notify);
  document.addEventListener('DOMContentLoaded', function () {
    notify();
    var t = document.querySelector('title');
    if (t) new MutationObserver(notify).observe(t, { childList: true, characterData: true, subtree: true });
  });
  window.addEventListener('load', notify);
  notify();
})();`;

/**
 * Ersetzt localStorage/sessionStorage/document.cookie durch In-Memory-Varianten, wenn die Seite in einer Sandbox
 * ohne Origin läuft (Zugriff würde sonst eine SecurityError werfen und viele Seiten-Skripte abbrechen lassen).
 * Wird für Proxy- UND Archiv-Seiten eingefügt.
 */
const STORAGE_SOURCE = String.raw`(function () {
  'use strict';
  function memoryStorage() {
    var data = Object.create(null);
    var api = {
      getItem: function (k) { k = String(k); return k in data ? data[k] : null; },
      setItem: function (k, v) { data[String(k)] = String(v); },
      removeItem: function (k) { delete data[String(k)]; },
      clear: function () { for (var k in data) delete data[k]; },
      key: function (i) { var ks = Object.keys(data); return i < ks.length ? ks[i] : null; }
    };
    return new Proxy(api, {
      get: function (t, p) { if (p === 'length') return Object.keys(data).length; if (p in t) return t[p]; return p in data ? data[p] : undefined; },
      set: function (t, p, v) { data[String(p)] = String(v); return true; },
      deleteProperty: function (t, p) { delete data[p]; return true; },
      has: function (t, p) { return p in t || p in data; },
      ownKeys: function () { return Object.keys(data); },
      getOwnPropertyDescriptor: function (t, p) { return p in data ? { value: data[p], enumerable: true, configurable: true, writable: true } : undefined; }
    });
  }
  ['localStorage', 'sessionStorage'].forEach(function (name) {
    var ok = true;
    try { var s = window[name]; s.getItem('__probe__'); } catch (e) { ok = false; }
    if (!ok) { try { Object.defineProperty(window, name, { configurable: true, value: memoryStorage() }); } catch (e) {} }
  });
  var cookiesOk = true;
  try { void document.cookie; } catch (e) { cookiesOk = false; }
  if (!cookiesOk) {
    var jar = {};
    try {
      Object.defineProperty(document, 'cookie', {
        configurable: true,
        get: function () { return Object.keys(jar).map(function (k) { return k + '=' + jar[k]; }).join('; '); },
        set: function (v) {
          var parts = String(v).split(';');
          var kv = parts[0]; var i = kv.indexOf('=');
          if (i < 0) return;
          var key = kv.slice(0, i).trim(); var val = kv.slice(i + 1).trim();
          var expired = /max-age\s*=\s*0|max-age\s*=\s*-/i.test(v) || /expires\s*=\s*[^;]*(19[0-9]{2}|1970)/i.test(v);
          if (expired) delete jar[key]; else jar[key] = val;
        }
      });
    } catch (e) {}
  }

})();`;

/** Baut das <script>-Markup für eine geproxte Seite. `prefix` ist z. B. "/proxy/<token>/". */
export function buildProxyShim(prefix: string, baseUrl: string): string {
  const cfg = JSON.stringify({ prefix, base: baseUrl }).replace(/</g, '\\u003c');
  return `<script>${STORAGE_SOURCE}</script><script>window.__WEB_ARCHIVER__=${cfg};</script><script>${SHIM_SOURCE}</script>`;
}

/** Minimaler Shim für Offline-Archive: nur Storage-/Cookie-Ersatz, keine URL-Umleitung. */
export function buildArchiveShim(): string {
  return `<script>${STORAGE_SOURCE}</script>`;
}
