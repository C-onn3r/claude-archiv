package app.webarchiver.ui

import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.test.core.app.ApplicationProvider
import app.webarchiver.TestServer
import app.webarchiver.WebArchiverApp
import app.webarchiver.data.TokenPair
import app.webarchiver.data.User
import app.webarchiver.ui.theme.WebArchiverTheme
import com.github.takahirom.roborazzi.captureRoboImage
import org.junit.After
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "w411dp-h891dp-xxhdpi")
class ViewersAndThemesTest {
    @get:Rule val compose = createComposeRule()
    private lateinit var server: TestServer
    private lateinit var app: WebArchiverApp

    @Before fun setUp() {
        server = TestServer()
        app = ApplicationProvider.getApplicationContext()
        app.store.save(server.baseUrl, TokenPair("access-0", "refresh-0", 900, User("u1", "conner", "Conner", "admin")))
    }

    @After fun tearDown() = server.shutdown()

    private fun waitForText(text: String) = compose.waitUntil(10_000) { compose.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty() }

    @Test fun liveViewerUndArchivViewer() {
        compose.setContent { WebArchiverTheme { AppNav(app) } }
        waitForText("Raspberry Pi – Wikipedia")

        // Archiv-Viewer
        compose.onNodeWithText("Raspberry Pi – Wikipedia").performClick()
        // Robolectric-WebView lädt nichts übers Netz: wir prüfen, dass der Viewer den Ansichts-Link vom Server angefordert hat.
        compose.waitUntil(30_000) { compose.onAllNodesWithContentDescription("Als PDF speichern").fetchSemanticsNodes().isNotEmpty() }
        compose.waitForIdle()
        compose.onRoot().captureRoboImage("build/screenshots/06_archive_viewer.png")
    }

    @Test fun liveViewer() {
        compose.setContent { WebArchiverTheme { AppNav(app) } }
        waitForText("Raspberry Pi – Wikipedia")
        compose.onNodeWithText("Hinzufügen", useUnmergedTree = true).performClick()
        waitForText("Seite hinzufügen")
        compose.onNodeWithText("Adresse").performTextInput("example.org")
        compose.onNodeWithText("Live öffnen", useUnmergedTree = true).performClick()
        compose.waitUntil(30_000) { server.requests.contains("POST /api/v1/proxy/links") }
        compose.waitForIdle()
        compose.onRoot().captureRoboImage("build/screenshots/07_live_viewer.png")
    }

    @Test @Config(sdk = [30], qualifiers = "w411dp-h891dp-xxhdpi")
    fun fallbackIndigoSchemaAufAelterenAndroid() {
        compose.setContent { WebArchiverTheme { AppNav(app) } }
        waitForText("Raspberry Pi – Wikipedia")
        compose.onRoot().captureRoboImage("build/screenshots/08_home_fallback_indigo.png")
    }

    @Test @Config(sdk = [35], qualifiers = "w411dp-h891dp-night-xxhdpi")
    fun dunkelModus() {
        compose.setContent { WebArchiverTheme { AppNav(app) } }
        waitForText("Raspberry Pi – Wikipedia")
        compose.onRoot().captureRoboImage("build/screenshots/09_home_dark.png")
    }
}
