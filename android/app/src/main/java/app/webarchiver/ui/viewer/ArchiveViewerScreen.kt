package app.webarchiver.ui.viewer

import android.content.Intent
import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.webarchiver.R
import app.webarchiver.WebArchiverApp
import app.webarchiver.ui.ErrorNote
import app.webarchiver.ui.Icon
import app.webarchiver.ui.vmOf
import app.webarchiver.util.Exporter
import app.webarchiver.util.formatBytes
import app.webarchiver.util.formatDateTime

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ArchiveViewerScreen(app: WebArchiverApp, archiveId: String, onBack: () -> Unit) {
    val vm = vmOf(key = "archive-$archiveId") { ArchiveViewerViewModel(app, archiveId) }
    val state = remember { WebViewState() }
    val context = LocalContext.current
    val snackbar = remember { SnackbarHostState() }
    var menu by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    val a = vm.archive

    LaunchedEffect(vm.deleted) { if (vm.deleted) onBack() }
    LaunchedEffect(Unit) {
        vm.snacks.collect { s ->
            val r = snackbar.showSnackbar(s.message, actionLabel = if (s.fileUri != null) "Öffnen" else null, duration = SnackbarDuration.Long)
            if (r == SnackbarResult.ActionPerformed && s.fileUri != null && s.mime != null) Exporter.open(context, s.fileUri, s.mime)
        }
    }
    BackHandler(enabled = state.canGoBack) { state.goBack() }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.surface,
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            TopAppBar(
                navigationIcon = { IconButton(onClick = onBack) { Icon(R.drawable.ic_back, "Zurück") } },
                title = {
                    Column {
                        Text(a?.displayTitle ?: "Archiv", maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.titleMedium)
                        if (a != null) {
                            Text(
                                "${formatDateTime(a.createdAt)} · ${formatBytes(a.totalBytes)}",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 1,
                            )
                        }
                    }
                },
                actions = {
                    if (a?.isDone == true && vm.pdfExport) IconButton(onClick = { vm.export(pdf = true) }, enabled = vm.working == null) { Icon(R.drawable.ic_pdf, "Als PDF speichern") }
                    Box {
                        IconButton(onClick = { menu = true }) { Icon(R.drawable.ic_more, "Mehr") }
                        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                            if (a?.isDone == true) DropdownMenuItem(text = { Text("Als ZIP speichern") }, leadingIcon = { Icon(R.drawable.ic_zip, null) }, onClick = { menu = false; vm.export(pdf = false) })
                            if (a != null) DropdownMenuItem(
                                text = { Text("Original im Browser öffnen") },
                                leadingIcon = { Icon(R.drawable.ic_open_in_new, null) },
                                onClick = { menu = false; runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(a.finalUrl ?: a.url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } },
                            )
                            HorizontalDivider()
                            DropdownMenuItem(text = { Text("Löschen") }, leadingIcon = { Icon(R.drawable.ic_delete, null) }, onClick = { menu = false; confirmDelete = true })
                        }
                    }
                },
            )
        },
    ) { padding ->
        Box(Modifier.padding(padding).fillMaxSize()) {
            when {
                vm.request != null -> {
                    ProxyWebView(app.api.baseUrl.orEmpty(), state, vm.request, Modifier.fillMaxSize())
                    if (state.progress < 100) LinearProgressIndicator(progress = { state.progress / 100f }, modifier = Modifier.fillMaxWidth())
                }
                vm.error != null -> Column(Modifier.padding(16.dp)) { ErrorNote(vm.error!!) }
                a?.isFailed == true -> Column(Modifier.padding(16.dp)) { ErrorNote(a.error ?: "Archivierung fehlgeschlagen.") }
                else -> Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                    CircularProgressIndicator()
                    Text("Archiv wird erstellt …", Modifier.padding(top = 16.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            vm.working?.let {
                Column(Modifier.fillMaxWidth().padding(16.dp).align(Alignment.BottomCenter)) {
                    Text(it, style = MaterialTheme.typography.labelMedium)
                    LinearProgressIndicator(Modifier.fillMaxWidth().padding(top = 6.dp))
                }
            }
        }
    }

    if (confirmDelete) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text("Archiv löschen?") },
            text = { Text("„${a?.displayTitle.orEmpty()}“ wird endgültig gelöscht.") },
            confirmButton = { TextButton(onClick = { confirmDelete = false; vm.delete() }) { Text("Löschen", color = MaterialTheme.colorScheme.error) } },
            dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("Abbrechen") } },
        )
    }
}
