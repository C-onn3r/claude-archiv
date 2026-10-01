package app.webarchiver

import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import java.time.Instant

/** Minimaler Fake des Web-Archivierer-Servers für Tests (gleiche Antwortformate wie das echte Backend). */
class TestServer(private val needsSetup: Boolean = false) {
    val server = MockWebServer()
    val requests = mutableListOf<String>()
    val baseUrl: String get() = server.url("/").toString().trimEnd('/')
    var accessTokenCounter = 0
    /** Wenn true, antwortet der Server auf Aufrufe mit abgelaufenem Access-Token mit 401 (Refresh-Test). */
    var rejectToken: String? = null

    private fun ago(minutes: Long) = Instant.now().minusSeconds(minutes * 60).toString()

    private fun user(role: String = "admin") = """{"id":"u1","username":"conner","displayName":"Conner","role":"$role","createdAt":"${ago(9999)}"}"""
    private fun tokens() = """{"accessToken":"access-${++accessTokenCounter}","refreshToken":"refresh-$accessTokenCounter","tokenType":"Bearer","expiresIn":900,"user":${user()}}"""

    private fun archive(id: String, title: String, url: String, status: String, minutes: Long, bytes: Long = 0, files: Int = 0, failed: Int = 0, error: String? = null) =
        """{"id":"$id","url":"$url","finalUrl":"$url","title":"$title","description":"","status":"$status","error":${error?.let { "\"$it\"" } ?: "null"},"tags":[],"options":{"includeScripts":true},"assetCount":$files,"failedCount":$failed,"totalBytes":$bytes,"createdAt":"${ago(minutes)}","startedAt":null,"finishedAt":null}"""

    val archives = listOf(
        archive("a1", "Raspberry Pi – Wikipedia", "https://de.wikipedia.org/wiki/Raspberry_Pi", "done", 5, 2_480_000, 63),
        archive("a2", "heise online – IT-News", "https://www.heise.de/", "running", 1, 0, 12),
        archive("a3", "Kubernetes Dokumentation: Konzepte", "https://kubernetes.io/docs/concepts/", "done", 190, 5_900_000, 118, 3),
        archive("a4", "https://intranet.example.org/wiki", "https://intranet.example.org/wiki", "failed", 1500, error = "HTTP 403 von intranet.example.org"),
        archive("a5", "Material Design 3 – Komponenten", "https://m3.material.io/components", "done", 60 * 24 * 12, 1_200_000, 41),
    )

    init {
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val path = request.path ?: ""
                requests += "${request.method} $path"
                val json = { body: String, code: Int -> MockResponse().setResponseCode(code).setHeader("Content-Type", "application/json").setBody(body) }
                val auth = request.getHeader("Authorization")
                val protected = !path.startsWith("/api/v1/meta") && !path.startsWith("/api/v1/auth/login") && !path.startsWith("/api/v1/auth/register") && !path.startsWith("/api/v1/auth/refresh")
                if (protected && rejectToken != null && auth == "Bearer $rejectToken") return json("""{"error":{"code":"token_invalid","message":"Token ungültig"}}""", 401)
                return when {
                    path == "/api/v1/meta" -> json("""{"name":"Web-Archivierer","apiVersion":"1.0.0","registrationOpen":$needsSetup,"needsSetup":$needsSetup,"accessTokenTtlSec":900,"contentTokenTtlSec":43200,"pdfExport":true}""", 200)
                    path == "/api/v1/auth/login" && request.method == "POST" ->
                        if (request.body.readUtf8().contains("falsch")) json("""{"error":{"code":"invalid_credentials","message":"Benutzername oder Passwort falsch."}}""", 401)
                        else json(tokens(), 200)
                    path == "/api/v1/auth/register" -> json(tokens(), 201)
                    path == "/api/v1/auth/refresh" -> json(tokens(), 200)
                    path == "/api/v1/auth/logout" -> MockResponse().setResponseCode(204)
                    path.startsWith("/api/v1/archives?") || path == "/api/v1/archives" && request.method == "GET" -> {
                        val q = Regex("[?&]q=([^&]*)").find(path)?.groupValues?.get(1)?.lowercase()
                        val status = Regex("[?&]status=([^&]*)").find(path)?.groupValues?.get(1)
                        val items = archives.filter { a -> (q == null || a.lowercase().contains(q)) && (status == null || a.contains("\"status\":\"$status\"")) }
                        json("""{"items":[${items.joinToString(",")}],"total":${items.size},"limit":20,"offset":0}""", 200)
                    }
                    path == "/api/v1/archives" && request.method == "POST" -> json(archive("new1", "Neues Archiv", "https://example.org/", "pending", 0), 202)
                    path.matches(Regex("/api/v1/archives/a\\d")) -> json(archives.first { it.contains("\"id\":\"${path.substringAfterLast('/')}\"") }, 200)
                    path.endsWith("/view") -> json("""{"viewUrl":"/archive/tok/a1/index.html","expiresAt":"2030-01-01T00:00:00Z"}""", 200)
                    path == "/api/v1/proxy/links" -> json("""{"targetUrl":"https://example.org/","proxyUrl":"/proxy/tok/https/example.org/","expiresAt":"2030-01-01T00:00:00Z"}""", 200)
                    path == "/api/v1/users" -> json("[${user()},${user("user").replace("u1", "u2").replace("conner", "gast").replace("Conner", "Gast")}]", 200)
                    path.startsWith("/proxy/") || path.startsWith("/archive/") ->
                        MockResponse().setHeader("Content-Type", "text/html; charset=utf-8").setBody("<html><body><h1>Seite</h1></body></html>")
                    else -> json("""{"error":{"code":"not_found","message":"Nicht gefunden."}}""", 404)
                }
            }
        }
        server.start()
    }

    fun shutdown() = server.shutdown()
}
