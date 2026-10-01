package app.webarchiver.ui.home

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.webarchiver.R
import app.webarchiver.WebArchiverApp
import app.webarchiver.data.Archive
import app.webarchiver.data.ArchiveFilter
import app.webarchiver.ui.Avatar
import app.webarchiver.ui.ErrorNote
import app.webarchiver.ui.Icon
import app.webarchiver.ui.vmOf
import app.webarchiver.util.Exporter
import app.webarchiver.util.formatBytes
import app.webarchiver.util.formatRelative
import app.webarchiver.util.hostOf

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    app: WebArchiverApp,
    onOpenLive: (String) -> Unit,
    onOpenArchive: (String) -> Unit,
    onAccount: () -> Unit,
    onUsers: () -> Unit,
) {
    val vm = vmOf { HomeViewModel(app) }
    val context = LocalContext.current
    val snackbar = remember { SnackbarHostState() }
    var showAdd by remember { mutableStateOf(false) }
    var addUrl by remember { mutableStateOf("") }
    var showAccount by remember { mutableStateOf(false) }
    var renameTarget by remember { mutableStateOf<Archive?>(null) }
    var deleteTarget by remember { mutableStateOf<Archive?>(null) }

    // Meldungen (inkl. "Öffnen" für exportierte Dateien)
    LaunchedEffect(Unit) {
        vm.snacks.collect { snack ->
            val result = snackbar.showSnackbar(snack.message, actionLabel = if (snack.fileUri != null) "Öffnen" else null, duration = SnackbarDuration.Long)
            if (result == SnackbarResult.ActionPerformed && snack.fileUri != null && snack.mime != null) Exporter.open(context, snack.fileUri, snack.mime)
        }
    }

    // Per "Teilen" aus dem Browser empfangener Link
    val incoming by app.incomingUrl.collectAsStateWithLifecycle()
    LaunchedEffect(incoming) {
        incoming?.let {
            addUrl = it
            showAdd = true
            app.incomingUrl.value = null
        }
    }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.surface,
        snackbarHost = { SnackbarHost(snackbar) },
        floatingActionButton = {
            ExtendedFloatingActionButton(
                onClick = { addUrl = ""; showAdd = true },
                icon = { Icon(R.drawable.ic_add, null) },
                text = { Text("Hinzufügen") },
            )
        },
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            SearchPill(
                query = vm.query,
                onQuery = { vm.query = it },
                initial = vm.user?.initial ?: "?",
                onAvatar = { showAccount = true },
            )
            LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                items(ArchiveFilter.entries.toList()) { f ->
                    FilterChip(selected = vm.filter == f, onClick = { vm.filter = f }, label = { Text(f.label) })
                }
            }
            Box(Modifier.height(8.dp))
            vm.working?.let {
                Column(Modifier.padding(horizontal = 16.dp, vertical = 4.dp)) {
                    Text(it, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    LinearProgressIndicator(Modifier.fillMaxWidth().padding(top = 6.dp))
                }
            }
            vm.error?.let { ErrorNote(it, Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) }

            PullToRefreshBox(isRefreshing = vm.refreshing, onRefresh = vm::refresh, modifier = Modifier.fillMaxSize()) {
                when {
                    vm.loading && vm.items.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        androidx.compose.material3.CircularProgressIndicator()
                    }
                    vm.items.isEmpty() -> EmptyState(filtered = vm.query.isNotBlank() || vm.filter != ArchiveFilter.ALL)
                    else -> LazyColumn(contentPadding = PaddingValues(bottom = 96.dp)) {
                        items(vm.items, key = { it.id }) { a ->
                            ArchiveRow(
                                a = a,
                                pdfExport = vm.pdfExport,
                                onOpen = { if (a.isDone) onOpenArchive(a.id) },
                                onPdf = { vm.export(a, pdf = true) },
                                onZip = { vm.export(a, pdf = false) },
                                onRename = { renameTarget = a },
                                onDelete = { deleteTarget = a },
                                onRetry = { vm.retry(a) },
                            )
                        }
                        if (vm.hasMore) {
                            item { TextButton(onClick = vm::loadMore, modifier = Modifier.fillMaxWidth().padding(8.dp)) { Text("Mehr laden") } }
                        }
                    }
                }
            }
        }
    }

    if (showAdd) {
        AddSheet(
            initialUrl = addUrl,
            onDismiss = { showAdd = false },
            onLive = { showAdd = false; onOpenLive(it) },
            onArchive = { url, js -> vm.add(url, js) { showAdd = false } },
        )
    }

    if (showAccount) {
        AccountDialog(
            name = vm.user?.displayName.orEmpty(),
            username = vm.user?.username.orEmpty(),
            admin = vm.user?.isAdmin == true,
            initial = vm.user?.initial ?: "?",
            server = app.api.baseUrl.orEmpty(),
            onDismiss = { showAccount = false },
            onAccount = { showAccount = false; onAccount() },
            onUsers = { showAccount = false; onUsers() },
            onLogout = { showAccount = false; vm.logout() },
        )
    }

    renameTarget?.let { a ->
        var text by remember(a.id) { mutableStateOf(a.displayTitle) }
        AlertDialog(
            onDismissRequest = { renameTarget = null },
            title = { Text("Umbenennen") },
            text = { OutlinedTextField(text, { text = it }, singleLine = true, modifier = Modifier.fillMaxWidth()) },
            confirmButton = { TextButton(onClick = { vm.rename(a, text.trim()); renameTarget = null }, enabled = text.isNotBlank()) { Text("Speichern") } },
            dismissButton = { TextButton(onClick = { renameTarget = null }) { Text("Abbrechen") } },
        )
    }

    deleteTarget?.let { a ->
        AlertDialog(
            onDismissRequest = { deleteTarget = null },
            title = { Text("Archiv löschen?") },
            text = { Text("„${a.displayTitle}“ wird endgültig gelöscht.") },
            confirmButton = { TextButton(onClick = { vm.delete(a); deleteTarget = null }) { Text("Löschen", color = MaterialTheme.colorScheme.error) } },
            dismissButton = { TextButton(onClick = { deleteTarget = null }) { Text("Abbrechen") } },
        )
    }
}

/** Abgerundetes Suchfeld mit Konto-Avatar – wie in Gmail/Drive. */
@Composable
private fun SearchPill(query: String, onQuery: (String) -> Unit, initial: String, onAvatar: () -> Unit) {
    Surface(
        shape = CircleShape,
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp).height(56.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(R.drawable.ic_search, null, Modifier.padding(start = 16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
            TextField(
                value = query,
                onValueChange = onQuery,
                placeholder = { Text("Archive durchsuchen") },
                singleLine = true,
                modifier = Modifier.weight(1f),
                colors = TextFieldDefaults.colors(
                    focusedContainerColor = Color.Transparent,
                    unfocusedContainerColor = Color.Transparent,
                    focusedIndicatorColor = Color.Transparent,
                    unfocusedIndicatorColor = Color.Transparent,
                ),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                keyboardActions = KeyboardActions(),
            )
            if (query.isNotEmpty()) IconButton(onClick = { onQuery("") }) { Icon(R.drawable.ic_close, "Suche leeren") }
            Box(
                Modifier.padding(end = 12.dp)
                    .semantics { contentDescription = "Konto" }
                    .clickable(onClick = onAvatar, role = androidx.compose.ui.semantics.Role.Button),
            ) { Avatar(initial, 36.dp) }
        }
    }
}

@Composable
private fun EmptyState(filtered: Boolean) {
    Column(Modifier.fillMaxSize().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        Surface(shape = CircleShape, color = MaterialTheme.colorScheme.secondaryContainer, contentColor = MaterialTheme.colorScheme.onSecondaryContainer, modifier = Modifier.size(88.dp)) {
            Box(contentAlignment = Alignment.Center) { Icon(if (filtered) R.drawable.ic_search else R.drawable.ic_inventory, null, Modifier.size(40.dp)) }
        }
        Text(if (filtered) "Keine Treffer" else "Noch keine Archive", style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 20.dp))
        Text(
            if (filtered) "Passe Suche oder Filter an." else "Tippe auf „Hinzufügen“, um eine Webseite zu öffnen oder dauerhaft zu archivieren.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(top = 8.dp),
        )
    }
}

@Composable
private fun ArchiveRow(
    a: Archive,
    pdfExport: Boolean,
    onOpen: () -> Unit,
    onPdf: () -> Unit,
    onZip: () -> Unit,
    onRename: () -> Unit,
    onDelete: () -> Unit,
    onRetry: () -> Unit,
) {
    var menu by remember { mutableStateOf(false) }
    val scheme = MaterialTheme.colorScheme
    val (iconRes, container, content) = when {
        a.isFailed -> Triple(R.drawable.ic_error, scheme.errorContainer, scheme.onErrorContainer)
        a.isActive -> Triple(if (a.status == "running") R.drawable.ic_sync else R.drawable.ic_schedule, scheme.tertiaryContainer, scheme.onTertiaryContainer)
        else -> Triple(R.drawable.ic_public, scheme.primaryContainer, scheme.onPrimaryContainer)
    }
    ListItem(
        modifier = Modifier.clickable(enabled = a.isDone, onClick = onOpen),
        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
        leadingContent = {
            Surface(shape = CircleShape, color = container, contentColor = content, modifier = Modifier.size(44.dp)) {
                Box(contentAlignment = Alignment.Center) { Icon(iconRes, null, Modifier.size(22.dp)) }
            }
        },
        headlineContent = { Text(a.displayTitle, maxLines = 2, overflow = TextOverflow.Ellipsis) },
        supportingContent = {
            Column {
                val meta = buildString {
                    append(hostOf(a.url))
                    if (a.createdAt.isNotEmpty()) append(" · ").append(formatRelative(a.createdAt))
                    if (a.isDone) append(" · ").append(formatBytes(a.totalBytes))
                    if (a.isActive) append(" · ").append(if (a.status == "running") "läuft" else "wartet")
                }
                Text(meta, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (a.isFailed && a.error != null) Text(a.error, color = scheme.error, maxLines = 2, overflow = TextOverflow.Ellipsis)
                if (a.isDone && a.failedCount > 0) Text("${a.failedCount} Dateien fehlen", color = scheme.onSurfaceVariant)
                if (a.isActive) LinearProgressIndicator(Modifier.fillMaxWidth().padding(top = 8.dp))
            }
        },
        trailingContent = {
            Box {
                IconButton(onClick = { menu = true }) { Icon(R.drawable.ic_more, "Mehr") }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    if (a.isDone) {
                        DropdownMenuItem(text = { Text("Öffnen") }, leadingIcon = { Icon(R.drawable.ic_open_in_new, null) }, onClick = { menu = false; onOpen() })
                        if (pdfExport) DropdownMenuItem(text = { Text("Als PDF speichern") }, leadingIcon = { Icon(R.drawable.ic_pdf, null) }, onClick = { menu = false; onPdf() })
                        DropdownMenuItem(text = { Text("Als ZIP speichern") }, leadingIcon = { Icon(R.drawable.ic_zip, null) }, onClick = { menu = false; onZip() })
                    }
                    if (a.isFailed) DropdownMenuItem(text = { Text("Erneut versuchen") }, leadingIcon = { Icon(R.drawable.ic_refresh, null) }, onClick = { menu = false; onRetry() })
                    DropdownMenuItem(text = { Text("Umbenennen") }, leadingIcon = { Icon(R.drawable.ic_edit, null) }, onClick = { menu = false; onRename() })
                    HorizontalDivider()
                    DropdownMenuItem(text = { Text("Löschen") }, leadingIcon = { Icon(R.drawable.ic_delete, null) }, onClick = { menu = false; onDelete() })
                }
            }
        },
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AddSheet(initialUrl: String, onDismiss: () -> Unit, onLive: (String) -> Unit, onArchive: (String, Boolean) -> Unit) {
    var url by remember { mutableStateOf(initialUrl) }
    var scripts by remember { mutableStateOf(true) }
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.padding(horizontal = 24.dp).padding(bottom = 24.dp).navigationBarsPadding()) {
            Text("Seite hinzufügen", style = MaterialTheme.typography.titleLarge)
            OutlinedTextField(
                value = url,
                onValueChange = { url = it },
                label = { Text("Adresse") },
                placeholder = { Text("https://beispiel.de/artikel") },
                leadingIcon = { Icon(R.drawable.ic_link, null) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth().padding(top = 16.dp),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go),
                keyboardActions = KeyboardActions(onGo = { if (url.isNotBlank()) onLive(url.trim()) }),
            )
            Row(Modifier.fillMaxWidth().padding(top = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("JavaScript mitarchivieren", style = MaterialTheme.typography.bodyLarge)
                    Text("Aus = statischer Schnappschuss", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Switch(checked = scripts, onCheckedChange = { scripts = it })
            }
            Row(Modifier.fillMaxWidth().padding(top = 20.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                FilledTonalButton(onClick = { onLive(url.trim()) }, enabled = url.isNotBlank(), modifier = Modifier.weight(1f)) {
                    Icon(R.drawable.ic_public, null, Modifier.size(18.dp)); Text("Live öffnen", Modifier.padding(start = 8.dp))
                }
                Button(onClick = { onArchive(url.trim(), scripts) }, enabled = url.isNotBlank(), modifier = Modifier.weight(1f)) {
                    Icon(R.drawable.ic_inventory, null, Modifier.size(18.dp)); Text("Archivieren", Modifier.padding(start = 8.dp))
                }
            }
        }
    }
}

/** Konto-Karte wie im Google-Konto-Menü. */
@Composable
private fun AccountDialog(
    name: String, username: String, admin: Boolean, initial: String, server: String,
    onDismiss: () -> Unit, onAccount: () -> Unit, onUsers: () -> Unit, onLogout: () -> Unit,
) {
    Dialog(onDismissRequest = onDismiss) {
        Surface(shape = MaterialTheme.shapes.extraLarge, color = MaterialTheme.colorScheme.surfaceContainerHigh) {
            Column(Modifier.padding(vertical = 20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Avatar(initial, 72.dp)
                Text(name, style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 12.dp))
                Text("$username · ${if (admin) "Administrator" else "Benutzer"}", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(server.removePrefix("https://").removePrefix("http://"), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 2.dp, bottom = 16.dp))
                OutlinedButton(onClick = onAccount) { Icon(R.drawable.ic_manage_accounts, null, Modifier.size(18.dp)); Text("Konto verwalten", Modifier.padding(start = 8.dp)) }
                Column(Modifier.fillMaxWidth().padding(top = 12.dp)) {
                    if (admin) AccountItem(R.drawable.ic_group, "Benutzer verwalten", onUsers)
                    AccountItem(R.drawable.ic_logout, "Abmelden", onLogout)
                }
            }
        }
    }
}

@Composable
private fun AccountItem(icon: Int, label: String, onClick: () -> Unit) {
    ListItem(
        modifier = Modifier.clickable(onClick = onClick),
        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
        leadingContent = { Icon(icon, null) },
        headlineContent = { Text(label) },
    )
}
