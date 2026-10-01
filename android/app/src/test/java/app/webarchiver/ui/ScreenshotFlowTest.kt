package app.webarchiver.ui

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextClearance
import androidx.compose.ui.test.performTextInput
import androidx.test.core.app.ApplicationProvider
import app.webarchiver.TestServer
import app.webarchiver.WebArchiverApp
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

/**
 * Durchläuft Login → Archivliste → Hinzufügen → Konto gegen einen Fake-Server und schreibt Screenshots
 * nach app/build/screenshots. Dient gleichzeitig als Funktionstest der kompletten Daten-/UI-Schicht.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "w411dp-h891dp-xxhdpi")
class ScreenshotFlowTest {
    @get:Rule val compose = createComposeRule()
    private lateinit var server: TestServer
    private lateinit var app: WebArchiverApp

    @Before fun setUp() {
        server = TestServer()
        app = ApplicationProvider.getApplicationContext()
        app.store.clear()
    }

    @After fun tearDown() = server.shutdown()

    private fun waitForText(text: String, timeout: Long = 10_000) {
        compose.waitUntil(timeout) { compose.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty() }
    }

    @Test fun loginHomeFlow() {
        compose.setContent { WebArchiverTheme { AppNav(app) } }

        // 1) Server eingeben
        compose.onNodeWithText("Server-Adresse").assertIsDisplayed()
        compose.onRoot().captureRoboImage("build/screenshots/01_login_server.png")
        compose.onNodeWithText("Server-Adresse").performTextClearance()
        compose.onNodeWithText("Server-Adresse").performTextInput(server.baseUrl)
        compose.onNodeWithText("Weiter").performClick()

        // 2) Zugangsdaten
        waitForText("Benutzername")
        compose.onNodeWithText("Benutzername").performTextInput("conner")
        compose.onNodeWithText("Passwort").performTextInput("falsch")
        compose.onAllNodesWithText("Anmelden")[1].performClick()
        waitForText("Benutzername oder Passwort falsch.")
        compose.onRoot().captureRoboImage("build/screenshots/02_login_error.png")

        compose.onNodeWithText("Passwort").performTextClearance()
        compose.onNodeWithText("Passwort").performTextInput("richtig-123")
        compose.onAllNodesWithText("Anmelden")[1].performClick()

        // 3) Home mit Archivliste
        waitForText("Raspberry Pi – Wikipedia")
        compose.onNodeWithText("Kubernetes Dokumentation: Konzepte").assertIsDisplayed()
        compose.onRoot().captureRoboImage("build/screenshots/03_home.png")
        check(server.requests.any { it.startsWith("GET /api/v1/archives") }) { "Archivliste wurde nicht geladen" }
        check(app.store.accessToken != null && app.store.refreshToken != null) { "Tokens nicht gespeichert" }

        // 4) Hinzufügen-Sheet
        compose.onNodeWithText("Hinzufügen", useUnmergedTree = true).performClick()
        waitForText("Seite hinzufügen")
        compose.onRoot().captureRoboImage("build/screenshots/04_add_sheet.png")
        compose.onNodeWithText("Adresse").performTextInput("example.org")
        compose.onNodeWithText("Archivieren", useUnmergedTree = true).performClick()
        waitForText("Archivierung von example.org gestartet")
        check(server.requests.any { it == "POST /api/v1/archives" }) { "Archivierung nicht ausgelöst" }

        // 5) Konto-Karte
        compose.onNodeWithContentDescription("Konto").performClick()
        waitForText("Abmelden")
        compose.onRoot().captureRoboImage("build/screenshots/05_account_dialog.png")
        compose.onNodeWithText("Abmelden").performClick()
        waitForText("Server-Adresse")
        check(app.store.state.value == null) { "Abmelden hat die Sitzung nicht beendet" }
    }
}
