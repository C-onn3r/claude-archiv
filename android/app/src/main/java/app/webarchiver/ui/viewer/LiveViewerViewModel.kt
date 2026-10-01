package app.webarchiver.ui.viewer

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.webarchiver.WebArchiverApp
import app.webarchiver.data.ApiException
import app.webarchiver.util.hostOf
import kotlinx.coroutines.launch

class LiveViewerViewModel(private val app: WebArchiverApp, initialUrl: String) : ViewModel() {
    var request by mutableStateOf<LoadRequest?>(null)
        private set
    var address by mutableStateOf(initialUrl)
        private set
    var error by mutableStateOf<String?>(null)
        private set
    var message by mutableStateOf<String?>(null)
        private set
    private var nextId = 0

    init {
        open(initialUrl)
    }

    /** Fordert einen Proxy-Link an und lädt ihn in der WebView. */
    fun open(url: String) {
        if (url.isBlank()) return
        viewModelScope.launch {
            try {
                error = null
                val link = app.api.proxyLink(url.trim())
                address = link.targetUrl
                request = LoadRequest(nextId++, (app.api.baseUrl ?: "") + link.proxyUrl)
            } catch (e: ApiException) {
                if (e.code != "session_expired") error = e.message
            }
        }
    }

    fun archive(url: String) {
        viewModelScope.launch {
            message = try {
                val a = app.api.createArchive(url, true)
                "Archivierung von ${hostOf(a.url)} gestartet"
            } catch (e: ApiException) {
                e.message
            }
        }
    }

    fun consumeMessage() {
        message = null
    }
}
