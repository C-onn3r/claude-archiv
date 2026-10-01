package app.webarchiver

import app.webarchiver.data.ApiClient
import app.webarchiver.data.ApiException
import app.webarchiver.data.Session
import app.webarchiver.data.SessionStore
import app.webarchiver.data.TokenPair
import app.webarchiver.data.User
import app.webarchiver.data.normalizeBaseUrl
import app.webarchiver.data.realUrlFromProxy
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class FakeStore : SessionStore {
    private val _state = MutableStateFlow<Session?>(null)
    override val state: StateFlow<Session?> = _state
    override var baseUrl: String? = null
    override var accessToken: String? = null
    override var refreshToken: String? = null
    override val lastBaseUrl: String? get() = baseUrl
    override fun save(baseUrl: String, pair: TokenPair) { this.baseUrl = baseUrl; saveTokens(pair) }
    override fun saveTokens(pair: TokenPair) { accessToken = pair.accessToken; refreshToken = pair.refreshToken; _state.value = Session(baseUrl!!, pair.user) }
    override fun updateUser(user: User) { _state.value = baseUrl?.let { Session(it, user) } }
    override fun clear() { accessToken = null; refreshToken = null; baseUrl = null; _state.value = null }
}

class ApiClientTest {
    private val server = TestServer()
    private val store = FakeStore()
    private val api = ApiClient(store)

    @After fun tearDown() = server.shutdown()

    @Test fun `login speichert Tokens und Benutzer`() = runBlocking {
        val user = api.login(server.baseUrl, "conner", "pw")
        assertEquals("conner", user.username)
        assertTrue(store.accessToken!!.startsWith("access-"))
        assertEquals(server.baseUrl, store.baseUrl)
    }

    @Test fun `falsches Passwort liefert stabilen Fehlercode und Meldung`() = runBlocking {
        try {
            api.login(server.baseUrl, "conner", "falsch")
            fail("erwartet ApiException")
        } catch (e: ApiException) {
            assertEquals(401, e.status)
            assertEquals("invalid_credentials", e.code)
            assertEquals("Benutzername oder Passwort falsch.", e.message)
        }
    }

    @Test fun `abgelaufenes Access-Token wird per Refresh erneuert und der Aufruf wiederholt`() = runBlocking {
        api.login(server.baseUrl, "conner", "pw")
        server.rejectToken = store.accessToken
        val page = api.listArchives(null, null, 20)
        assertEquals(5, page.total)
        assertTrue(server.requests.contains("POST /api/v1/auth/refresh"))
        assertEquals("refresh-2", store.refreshToken)
    }

    @Test fun `parallele Aufrufe mit abgelaufenem Token loesen genau einen Refresh aus`() = runBlocking {
        api.login(server.baseUrl, "conner", "pw")
        server.rejectToken = store.accessToken
        (1..6).map { async { api.listArchives(null, null, 20) } }.awaitAll()
        assertEquals(1, server.requests.count { it == "POST /api/v1/auth/refresh" })
    }

    @Test fun `ungueltiges Refresh-Token beendet die Sitzung`() = runBlocking {
        api.login(server.baseUrl, "conner", "pw")
        server.rejectToken = store.accessToken
        server.server.dispatcher.let { /* Refresh soll scheitern */ }
        val failing = ApiClient(store, okhttp3.OkHttpClient.Builder().addInterceptor { chain ->
            val req = chain.request()
            if (req.url.encodedPath.endsWith("/auth/refresh")) {
                okhttp3.Response.Builder().request(req).protocol(okhttp3.Protocol.HTTP_1_1).code(401).message("x")
                    .body(okhttp3.ResponseBody.create(null, """{"error":{"code":"token_invalid","message":"x"}}""")).build()
            } else chain.proceed(req)
        }.build())
        try {
            failing.listArchives(null, null, 20)
            fail("erwartet session_expired")
        } catch (e: ApiException) {
            assertEquals("session_expired", e.code)
        }
        assertNull(store.accessToken)
        assertNull(store.state.value)
    }

    @Test fun `nicht erreichbarer Server wird als Netzwerkfehler gemeldet`() = runBlocking {
        val base = server.baseUrl
        server.shutdown()
        try {
            api.meta(base)
            fail("erwartet ApiException")
        } catch (e: ApiException) {
            assertEquals(0, e.status)
            assertEquals("network", e.code)
        }
    }

    @Test fun `normalizeBaseUrl ergaenzt https und entfernt Slash`() {
        assertEquals("https://archive.example.org", normalizeBaseUrl("archive.example.org/"))
        assertEquals("http://192.168.1.5:3000", normalizeBaseUrl(" http://192.168.1.5:3000 "))
        assertNull(normalizeBaseUrl(""))
        assertNull(normalizeBaseUrl("ftp://example.org"))
    }

    @Test fun `echte URL wird aus Proxy-URL der WebView rekonstruiert`() {
        val base = "https://archive.example.org"
        assertEquals("https://example.com/a/b?x=1#f", realUrlFromProxy("$base/proxy/TOKEN.abc/https/example.com/a/b?x=1#f", base))
        assertEquals("http://host:8080/", realUrlFromProxy("$base/proxy/t/http/host:8080", base))
        assertNull(realUrlFromProxy("$base/archive/t/id/index.html", base))
        assertNull(realUrlFromProxy("https://other.org/proxy/t/https/x/", base))
        assertFalse(realUrlFromProxy("$base/proxy/t/https/example.com/", base)!!.contains("proxy"))
    }
}
