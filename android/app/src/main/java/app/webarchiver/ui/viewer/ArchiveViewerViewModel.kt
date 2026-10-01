package app.webarchiver.ui.viewer

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.webarchiver.WebArchiverApp
import app.webarchiver.data.ApiException
import app.webarchiver.data.Archive
import app.webarchiver.ui.home.Snack
import app.webarchiver.util.exportArchive
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.launch

class ArchiveViewerViewModel(private val app: WebArchiverApp, private val id: String) : ViewModel() {
    var archive by mutableStateOf<Archive?>(null)
        private set
    var request by mutableStateOf<LoadRequest?>(null)
        private set
    var error by mutableStateOf<String?>(null)
        private set
    var working by mutableStateOf<String?>(null)
        private set
    var pdfExport by mutableStateOf(false)
        private set
    var deleted by mutableStateOf(false)
        private set
    private val _snacks = MutableSharedFlow<Snack>(extraBufferCapacity = 4)
    val snacks: SharedFlow<Snack> = _snacks

    init {
        viewModelScope.launch {
            runCatching { app.api.meta(app.api.baseUrl ?: return@launch) }.onSuccess { pdfExport = it.pdfExport }
        }
        viewModelScope.launch {
            // Laden; solange das Archiv noch läuft, alle 1,5 s nachfragen.
            while (true) {
                try {
                    val a = app.api.getArchive(id)
                    archive = a
                    if (a.isDone && request == null) {
                        val view = app.api.archiveView(id)
                        request = LoadRequest(0, (app.api.baseUrl ?: "") + view.viewUrl)
                    }
                    if (!a.isActive) break
                } catch (e: ApiException) {
                    if (e.code != "session_expired") error = e.message
                    break
                } catch (e: Exception) {
                    error = "Archiv konnte nicht geladen werden: ${e.message}"
                    break
                }
                delay(1500)
            }
        }
    }

    fun export(pdf: Boolean) {
        val a = archive ?: return
        viewModelScope.launch {
            working = if (pdf) "PDF wird erstellt …" else "ZIP wird geladen …"
            try {
                _snacks.tryEmit(exportArchive(app, a, pdf))
            } catch (e: ApiException) {
                _snacks.tryEmit(Snack(e.message ?: "Export fehlgeschlagen"))
            } finally {
                working = null
            }
        }
    }

    fun delete() {
        viewModelScope.launch {
            try {
                app.api.deleteArchive(id)
                deleted = true
            } catch (e: ApiException) {
                _snacks.tryEmit(Snack(e.message ?: "Löschen fehlgeschlagen"))
            }
        }
    }
}
