package app.webarchiver.ui.home

import android.net.Uri
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.webarchiver.WebArchiverApp
import app.webarchiver.data.Archive
import app.webarchiver.data.ArchiveFilter
import app.webarchiver.data.ApiException
import app.webarchiver.util.exportArchive
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.launch

/** Einmalige Meldung für die Snackbar (optional mit "Öffnen"-Aktion für exportierte Dateien). */
data class Snack(val message: String, val fileUri: Uri? = null, val mime: String? = null)

class HomeViewModel(private val app: WebArchiverApp) : ViewModel() {
    var items by mutableStateOf<List<Archive>>(emptyList())
        private set
    var total by mutableStateOf(0)
        private set
    var loading by mutableStateOf(true)
        private set
    var refreshing by mutableStateOf(false)
        private set
    var error by mutableStateOf<String?>(null)
        private set
    var working by mutableStateOf<String?>(null)
        private set
    var pdfExport by mutableStateOf(false)
        private set
    var query by mutableStateOf("")
    var filter by mutableStateOf(ArchiveFilter.ALL)

    private var limit = PAGE
    private val _snacks = MutableSharedFlow<Snack>(extraBufferCapacity = 4)
    val snacks: SharedFlow<Snack> = _snacks

    val user get() = app.store.state.value?.user

    @OptIn(FlowPreview::class)
    private fun startQueryWatcher() = viewModelScope.launch {
        snapshotFlow { query.trim() to filter }.debounce(250).collect {
            limit = PAGE
            load(silent = false)
        }
    }

    init {
        startQueryWatcher()
        // Server-Fähigkeiten (PDF verfügbar?)
        viewModelScope.launch {
            runCatching { app.api.meta(app.api.baseUrl ?: return@launch) }.onSuccess { pdfExport = it.pdfExport }
        }
        // Laufende Archivierungen: Liste automatisch aktualisieren (wie im Web-Dashboard).
        viewModelScope.launch {
            while (true) {
                delay(2000)
                if (items.any { it.isActive }) load(silent = true)
            }
        }
    }

    fun refresh() {
        refreshing = true
        viewModelScope.launch {
            load(silent = true)
            refreshing = false
        }
    }

    fun loadMore() {
        limit += PAGE
        viewModelScope.launch { load(silent = true) }
    }

    val hasMore get() = items.size < total

    private suspend fun load(silent: Boolean) {
        if (!silent) loading = true
        try {
            val page = app.api.listArchives(query.trim(), filter.status, limit)
            items = page.items
            total = page.total
            error = null
        } catch (e: ApiException) {
            if (e.code != "session_expired") error = e.message
        } finally {
            loading = false
        }
    }

    fun add(url: String, includeScripts: Boolean, onDone: () -> Unit) = guarded {
        val a = app.api.createArchive(url.trim(), includeScripts)
        _snacks.tryEmit(Snack("Archivierung von ${app.hostOf(a.url)} gestartet"))
        onDone()
        load(silent = true)
    }

    fun rename(a: Archive, title: String) = guarded {
        val updated = app.api.renameArchive(a.id, title)
        items = items.map { if (it.id == a.id) updated else it }
    }

    fun delete(a: Archive) = guarded {
        app.api.deleteArchive(a.id)
        items = items.filterNot { it.id == a.id }
        total -= 1
        _snacks.tryEmit(Snack("„${a.displayTitle}“ gelöscht"))
    }

    fun retry(a: Archive) = guarded {
        val updated = app.api.retryArchive(a.id)
        items = items.map { if (it.id == a.id) updated else it }
    }

    fun export(a: Archive, pdf: Boolean) = guarded {
        working = if (pdf) "PDF wird erstellt …" else "ZIP wird geladen …"
        try {
            _snacks.tryEmit(exportArchive(app, a, pdf))
        } finally {
            working = null
        }
    }

    private fun guarded(block: suspend () -> Unit) {
        viewModelScope.launch {
            try {
                block()
            } catch (e: ApiException) {
                if (e.code != "session_expired") _snacks.tryEmit(Snack(e.message ?: "Fehler"))
            } catch (e: Exception) {
                _snacks.tryEmit(Snack("Fehler: ${e.message}"))
            }
        }
    }

    fun logout() {
        viewModelScope.launch { app.api.logout() }
    }

    companion object {
        const val PAGE = 20
    }
}

private fun WebArchiverApp.hostOf(url: String) = app.webarchiver.util.hostOf(url)
