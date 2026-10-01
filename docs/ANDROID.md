# Anbindung einer Android-App

Eine fertige App liegt unter [`../android`](../android/README.md). Dieses Dokument beschreibt die API-Anbindung für eigene Clients.

Die API ist vollständig getrennt von der Weboberfläche: Die Web-App nutzt exakt dieselben Endpunkte wie ein nativer Client.
Es gibt keine Cookies/Sessions, keine CORS-Abhängigkeit und keine HTML-Antworten außerhalb von `/proxy/…` und `/archive/…`.

* Spezifikation: [`openapi.json`](openapi.json) → mit `openapi-generator` (Kotlin/Retrofit/OkHttp) oder `openapi-kotlin` einen Client erzeugen.
* Basis-URL: `https://<server>/api/v1`

## 1. Verbindung & Anmeldung

```
GET  /api/v1/meta                       → { registrationOpen, needsSetup, accessTokenTtlSec, … }
POST /api/v1/auth/login {username,password}
     → { accessToken, refreshToken, expiresIn, user }
```

* `Authorization: Bearer <accessToken>` an jeden API-Aufruf (Access-Token: 15 min).
* Bei `401` mit `error.code = token_invalid | token_expired`: **einmal** `POST /auth/refresh {refreshToken}` → neues Token-Paar, Aufruf wiederholen.
  Refresh-Tokens sind **Einmal-Token** (Rotation). Parallele Refreshes serialisieren (z. B. `Mutex` im OkHttp-`Authenticator`)!
  Wird ein altes Refresh-Token erneut benutzt (`token_reused`), widerruft der Server alle Sitzungen des Benutzers.
* Tokens in `EncryptedSharedPreferences`/Android Keystore ablegen.

```kotlin
class TokenAuthenticator(private val auth: AuthRepository) : Authenticator {
    override fun authenticate(route: Route?, response: Response): Request? {
        if (response.request.header("X-Retried") != null) return null
        val newAccess = runBlocking { auth.refreshOnce() } ?: return null   // Mutex + gespeichertes Refresh-Token
        return response.request.newBuilder()
            .header("Authorization", "Bearer $newAccess").header("X-Retried", "1").build()
    }
}
```

## 2. Live-Proxy in einer WebView

```
POST /api/v1/proxy/links {"url": "example.com/artikel"}
  → { targetUrl: "https://example.com/artikel", proxyUrl: "/proxy/<token>/https/example.com/artikel", expiresAt }
```

```kotlin
webView.settings.javaScriptEnabled = true
webView.loadUrl(baseUrl + link.proxyUrl)          // Token steckt im Pfad – keine Header nötig
```

* Alle Links/Assets der Seite zeigen bereits auf `/proxy/<token>/…`; die WebView bleibt beim Navigieren im Proxy.
* **Echte URL ermitteln** (Adressleiste, „Archivieren“): Pfadformat ist ein stabiler Vertrag:
  `/proxy/{token}/{http|https}/{host[:port]}/{pfad}?{query}#{fragment}` → `scheme://host/pfad?query#fragment`.
  Zusätzlich sendet die Seite per `postMessage` `{source:"web-archiver", type:"location", url, title}` an den Parent (nur in iframes relevant).
* Das Content-Token gilt 12 h (`expiresAt`). Danach zeigt der Server eine Fehlerseite „Sitzung abgelaufen“ → neuen Link erzeugen und neu laden.
* Optional `WebViewClient.shouldOverrideUrlLoading` verwenden, um Links außerhalb von `baseUrl/proxy/` im Systembrowser zu öffnen.

## 3. Archive

```
POST /api/v1/archives {"url": "...", "includeScripts": true}   → 202 { id, status: "pending", … }
GET  /api/v1/archives/{id}                                      → Polling bis status ∈ {done, failed}
GET  /api/v1/archives?q=&status=&limit=&offset=                 → { items, total, limit, offset }
GET  /api/v1/archives/{id}/view                                 → { viewUrl: "/archive/<token>/<id>/index.html", expiresAt }
GET  /api/v1/archives/{id}/download                             → application/zip (Bearer-Header)
GET  /api/v1/archives/{id}/pdf                                  → application/pdf (Bearer-Header; 501 pdf_unavailable, wenn der Server kein Chromium hat – siehe `pdfExport` in /meta)
```

* **Online ansehen:** `webView.loadUrl(baseUrl + viewUrl)`.
* **Vollständig lokal / ohne Server:** ZIP laden (mit Bearer-Header), in den App-Speicher entpacken und per
  [`WebViewAssetLoader`](https://developer.android.com/reference/androidx/webkit/WebViewAssetLoader) oder `file://` öffnen – alle Pfade im Archiv sind relativ.
  `archive.json` im ZIP enthält Metadaten und `entryPath` (Startdatei, i. d. R. `index.html`).
  Die Archiv-Seiten bringen einen Storage-Ersatz mit, sodass `localStorage`/`document.cookie` auch ohne Origin nicht werfen.
* Statuscodes: `202` angenommen · `403 blocked_target` (private Adresse) · `409 not_ready` (Archiv noch nicht fertig) · `404` fremdes/unbekanntes Archiv.

## 4. Fehlerformat

```json
{ "error": { "code": "invalid_credentials", "message": "Benutzername oder Passwort falsch." } }
```

`code` ist stabil und für die Logik gedacht, `message` ist deutscher Anzeigetext. Validierungsfehler: `400 validation_error`; Rate-Limit: `429 rate_limited`.
