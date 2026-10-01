package app.webarchiver.ui.login

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.webarchiver.WebArchiverApp
import app.webarchiver.data.ApiException
import app.webarchiver.data.Meta
import app.webarchiver.data.normalizeBaseUrl
import kotlinx.coroutines.launch

class LoginViewModel(private val app: WebArchiverApp) : ViewModel() {
    var server by mutableStateOf(app.store.lastBaseUrl ?: WebArchiverApp.DEFAULT_SERVER)
    var username by mutableStateOf("")
    var password by mutableStateOf("")
    var displayName by mutableStateOf("")
    var meta by mutableStateOf<Meta?>(null)
        private set
    var registerMode by mutableStateOf(false)
        private set
    var busy by mutableStateOf(false)
        private set
    var error by mutableStateOf<String?>(null)
        private set
    private var base: String? = null

    /** Schritt 1: Server prüfen. */
    fun connect() {
        val normalized = normalizeBaseUrl(server)
        if (normalized == null) {
            error = "Bitte eine gültige Server-Adresse eingeben."
            return
        }
        launch {
            val m = app.api.meta(normalized)
            base = normalized
            server = normalized
            meta = m
            registerMode = m.needsSetup
        }
    }

    fun changeServer() {
        meta = null
        base = null
        error = null
        registerMode = false
    }

    fun toggleRegister() {
        registerMode = !registerMode
        error = null
    }

    /** Schritt 2: Anmelden bzw. Konto anlegen. */
    fun submit(onDone: () -> Unit) {
        val b = base ?: return
        if (username.isBlank() || password.isBlank()) {
            error = "Benutzername und Passwort eingeben."
            return
        }
        launch {
            if (registerMode) app.api.register(b, username.trim(), password, displayName.trim().ifBlank { null })
            else app.api.login(b, username.trim(), password)
            password = ""
            onDone()
        }
    }

    private fun launch(block: suspend () -> Unit) {
        busy = true
        error = null
        viewModelScope.launch {
            try {
                block()
            } catch (e: ApiException) {
                error = e.message
            } finally {
                busy = false
            }
        }
    }
}
