# Web-Archivierer & Proxy-Service

Persönlicher Dienst zum **Browsen über einen Proxy** und zum **dauerhaften Archivieren** von Webseiten – mit
Weboberfläche und einer entkoppelten REST-API, an die später eine native Android-App als gleichwertiger Client
angebunden werden kann.

| Bereich | Funktion |
| --- | --- |
| **Benutzer & Auth** | Registrierung/Login, JWT-Access-Tokens (kurzlebig) + rotierende Refresh-Tokens, Rollen (Admin/Benutzer), Benutzerverwaltung, Passwortwechsel |
| **Live-Proxy** | Ziel-URL wird serverseitig abgerufen und umgeschrieben (HTML, CSS, Weiterleitungen, Formulare, dynamische Requests per Client-Shim), sodass Links und Assets **innerhalb der App navigierbar** bleiben |
| **Archivierung** | Seite + CSS (rekursiv, `@import`, Fonts, Hintergrundbilder), JavaScript, Bilder (`src`/`srcset`/Lazy-Load), Medien, Icons, same-origin-iframes werden geladen, Pfade relativ umgeschrieben und lokal abgelegt – dauerhaft offline nutzbar |
| **Viewer** | iframe-Viewer für Live-Proxy (Adressleiste, Vor/Zurück, „Archivieren“) und für Offline-Archive; ZIP-Export |
| **API** | Versionierte REST-API unter `/api/v1`, OpenAPI 3 (`/api/docs`, [`docs/openapi.json`](docs/openapi.json)) |

## Tech-Stack

* **Backend:** Node.js 22, TypeScript, [Fastify 5](https://fastify.dev) (TypeBox-Schemas → Validierung **und** OpenAPI aus einer Quelle),
  SQLite ([better-sqlite3](https://github.com/WiseLibs/better-sqlite3), WAL), [cheerio](https://cheerio.js.org) (HTML-Parsing), [undici](https://undici.nodejs.org) (HTTP-Client), [jose](https://github.com/panva/jose) (JWT), scrypt (Passwort-Hashes, ohne native Abhängigkeit)
* **Frontend:** React 19, TypeScript, Vite, React Router – ohne UI-Framework, hell/dunkel automatisch
* **Betrieb:** ein Prozess liefert API **und** Frontend aus; Docker-Image + Compose-Datei enthalten

```
backend/src
├─ app.ts, index.ts, config.ts, services.ts   Start, Verdrahtung, Konfiguration (ENV)
├─ auth/        Passwörter (scrypt), JWT (access | content), Auth-Plugin
├─ db/          SQLite + versionierte Migrationen
├─ repos/       Datenzugriff (Users, Refresh-Tokens, Archive, Ressourcen)
├─ net/         SafeFetcher (SSRF-Schutz), IP-Prüfung, URL-Normalisierung
├─ rewrite/     HTML-/CSS-/srcset-Umschreiber (geteilt von Proxy & Archiv), Client-Shim, Charset
├─ proxy/       Live-Proxy-Logik, Sicherheits-Header für Fremdinhalte
├─ archive/     Engine (Crawler), Job-Queue, Dateiablage
└─ routes/      REST-Endpunkte + Auslieferung von /proxy/… und /archive/…
frontend/src    API-Client (Token-Refresh), Auth-Kontext, Dashboard, Viewer, Konto, Benutzerverwaltung
```

## Inbetriebnahme

### Variante A – Docker (empfohlen)

```bash
docker compose up -d --build
# → http://localhost:3000
```

Daten (SQLite, Archive, JWT-Secret) liegen im Volume `archiv-data`.

### Variante B – lokal (Node ≥ 22.12)

```bash
npm install
npm run build          # baut Frontend + Backend
npm start              # → http://localhost:3000
```

Entwicklung mit Hot-Reload (zwei Terminals):

```bash
npm run dev:backend    # http://localhost:3000  (tsx watch)
npm run dev:frontend   # http://localhost:5173  (Vite, leitet /api, /proxy, /archive ans Backend)
```

### Erster Start

1. Weboberfläche öffnen – bei leerer Datenbank erscheint **„Administrator anlegen“**. Der erste Benutzer wird Admin.
2. Weitere Konten legt der Admin unter **Benutzer** an (oder `ALLOW_REGISTRATION=true` setzen).
3. URL eingeben → **Live öffnen** (Proxy) oder **Archivieren** (läuft im Hintergrund, Liste aktualisiert sich automatisch).

Produktiv **hinter einen HTTPS-Reverse-Proxy** (Caddy, nginx, Traefik) stellen und `TRUST_PROXY=true` setzen.
Alle Einstellungen: [`.env.example`](.env.example) (alles optional; das JWT-Secret wird beim ersten Start erzeugt und in `DATA_DIR` gespeichert).

### Tests

```bash
npm test               # 64 Tests: Auth, Benutzerverwaltung, Proxy, SSRF, Archiv-Engine, Rewriter
npm run typecheck
npm run openapi        # docs/openapi.json neu erzeugen
```

## API in Kürze

Vollständig: Swagger-UI unter `/api/docs`, Spezifikation in [`docs/openapi.json`](docs/openapi.json). Fehler haben immer die Form
`{"error": {"code": "…", "message": "…"}}`. Android-Anbindung: [`docs/ANDROID.md`](docs/ANDROID.md).

| Methode | Pfad | Zweck |
| --- | --- | --- |
| GET | `/api/v1/meta` | Server-Fähigkeiten (Registrierung offen? Ersteinrichtung nötig?) |
| POST | `/api/v1/auth/register` · `/login` · `/refresh` · `/logout` | Anmeldung, Token-Rotation |
| GET/PATCH | `/api/v1/auth/me` | Profil, Passwortwechsel |
| GET/POST/PATCH/DELETE | `/api/v1/users[/{id}]` | Benutzerverwaltung (Admin) |
| POST | `/api/v1/proxy/links` | Proxy-URL für ein Ziel erzeugen → `GET {proxyUrl}` in iframe/WebView |
| POST | `/api/v1/archives` | Archivierung starten (202, asynchron) |
| GET | `/api/v1/archives?q=&status=&tag=&limit=&offset=` | Archive suchen/auflisten |
| GET/PATCH/DELETE | `/api/v1/archives/{id}` | Details, Titel/Tags ändern, löschen |
| GET | `/api/v1/archives/{id}/view` | Offline-Ansicht → `GET {viewUrl}` in iframe/WebView |
| GET | `/api/v1/archives/{id}/download` | ZIP-Export (inkl. `archive.json`) |
| GET | `/api/v1/archives/{id}/resources` | Erfasste/fehlgeschlagene Ressourcen |
| POST | `/api/v1/archives/{id}/retry` | Fehlgeschlagenes Archiv neu starten |

**Warum Content-Tokens in der URL?** iframes und WebViews können keine `Authorization`-Header senden. Deshalb liefern
`/proxy/links` und `/archives/{id}/view` einen Pfad der Form `/proxy/<token>/<scheme>/<host>/<pfad>` bzw.
`/archive/<token>/<id>/<datei>`. Das Token ist ein eigener JWT-Typ (`content`, 12 h), der **nur** diese
Auslieferungs-Routen freischaltet – nie die API – und wird aus den Server-Logs entfernt.

## Sicherheitskonzept

Ein Proxy, der fremde Inhalte unter der eigenen Domain ausliefert, ist ein klassisches Angriffsziel. Umgesetzt:

* **SSRF-Schutz:** Private, Loopback-, Link-Local-, Cloud-Metadaten-, Multicast- und IPv4-mapped-Adressen werden blockiert.
  Die Prüfung läuft im DNS-`lookup` **unmittelbar vor dem Verbindungsaufbau** (kein DNS-Rebinding), IP-Literale werden vorab
  geprüft, Redirects werden nie automatisch verfolgt – jeder Hop wird neu validiert. Abschaltbar nur per `ALLOW_PRIVATE_NETWORKS=true`.
* **Isolation der Fremdinhalte:** Proxy- und Archivantworten tragen `Content-Security-Policy: sandbox …` **ohne** `allow-same-origin`.
  Fremde Skripte laufen in einem undurchsichtigen Origin und erreichen weder `localStorage` (Tokens) noch die API – auch dann,
  wenn die URL direkt im Browser geöffnet wird. Das iframe ist zusätzlich per `sandbox`-Attribut eingeschränkt.
  Ein Client-Shim ersetzt dort fehlenden Storage/Cookies durch In-Memory-Varianten, damit Seiten trotzdem funktionieren.
* **Hermetische Archive:** CSP `default-src 'self' …` – archivierte Seiten laden nichts aus dem Internet nach und können nicht „nach Hause telefonieren“.
* **Auth:** scrypt-Hashes, kurzlebige Access-Tokens, Refresh-Token-Rotation mit Wiederverwendungserkennung (alle Sitzungen werden widerrufen),
  Token-Invalidierung bei Passwortwechsel/Löschen, Rate-Limits auf Auth-Routen, Timing-neutraler Login.
* **Weiteres:** Helmet-Header, Path-Traversal-Schutz im Archiv-Speicher, Größen-/Anzahl-/Zeitlimits, Benutzer-Isolation (jedes Archiv gehört genau einem Benutzer),
  Cookies der Zielseiten werden **nicht** weitergegeben oder gespeichert.

## Funktionsweise

**Proxy:** `/proxy/<token>/<https|http>/<host>/<pfad>` – der Zielpfad steht im URL-Pfad, daher lösen relative Links im Browser
automatisch korrekt auf. Serverseitig werden HTML-Attribute (`href`, `src`, `srcset`, `action`, `poster`, `meta refresh`, Inline-CSS …),
CSS (`url()`, `@import`) und `Location`-Header umgeschrieben. Ein im `<head>` eingefügtes Skript (`rewrite/shim.ts`) leitet zur Laufzeit erzeugte
URLs (`fetch`, XHR, `setAttribute`, `img.src = …`, `innerHTML`, `history.pushState`, `window.open`) um und meldet die echte URL an den Viewer.
Formulare (GET/POST), Range-Requests (Video) und CORS-Preflights werden unterstützt.

**Archivierung:** `ArchiveJob` lädt das Hauptdokument (manuelle Redirects), parst es und löst jede Referenz über `ensure(url)` auf:
Download (parallel, begrenzt) → Ablage unter `assets/<hash>-<name>.<ext>` → relativer Pfad im Dokument. CSS wird rekursiv verarbeitet
(auch zyklische `@import`s). Nicht ladbare Ressourcen bleiben als absolute URL erhalten und werden in der Ressourcenliste mit Fehlergrund geführt.
Optional (`includeScripts=false`) entsteht ein statischer Schnappschuss ohne Skripte. Aufträge laufen in einer Queue mit begrenzter Parallelität
und überstehen Neustarts (wartende werden fortgesetzt, unterbrochene als fehlgeschlagen markiert).

## Bekannte Grenzen

* **Reine Client-Side-Apps (SPA):** Der Archivierer lädt statisch, er führt keinen Browser aus. Inhalte, die erst zur Laufzeit per `fetch` entstehen,
  fehlen im Archiv; Router-Logik, die `location.pathname` auswertet, kann auf `/proxy/…`- bzw. `/archive/…`-Pfaden andere Routen wählen.
  Die `ArchiveJob`-Schnittstelle (Ressourcen-Graph + Speicher) ist so geschnitten, dass sich ein Headless-Browser-Modus (z. B. Playwright) als zweite „Quelle“ ergänzen lässt.
* **Live-Proxy:** Keine Cookies/Logins bei Zielseiten, kein WebSocket, keine Service Worker; `location.href = '/…'`-Weiterleitungen aus Skripten und ES-Modul-`import`s mit Root-Pfaden werden nicht umgeschrieben.
* Es wird eine Seite pro Auftrag archiviert (kein Mehrseiten-Crawl).
* Betrieb hinter einem Upstream-HTTP-Proxy wird nicht unterstützt.

## Erweiterbarkeit

* Neue Endpunkte: Plugin in `backend/src/routes/` + Registrierung in `app.ts`; Schemas (TypeBox) erscheinen automatisch in OpenAPI.
* Andere Datenbank: nur `db/` + `repos/` anfassen (Repositories kapseln SQL; Migrationen in `db/migrations.ts`).
* Andere Job-Queue: `archive/service.ts` ist die einzige Stelle, die Aufträge einreiht/ausführt.
* Neue Ressourcentypen im Archiv: `rewrite/html.ts` (Attribut-Tabelle) bzw. `archive/engine.ts` (Verarbeitung nach MIME-Typ).
