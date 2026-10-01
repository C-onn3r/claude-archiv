package app.webarchiver.ui.viewer

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.BottomAppBar
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import app.webarchiver.R
import app.webarchiver.WebArchiverApp
import app.webarchiver.data.realUrlFromProxy
import app.webarchiver.ui.ErrorNote
import app.webarchiver.ui.Icon
import app.webarchiver.ui.vmOf
import app.webarchiver.util.hostOf
import android.content.Intent
import android.net.Uri

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LiveViewerScreen(app: WebArchiverApp, initialUrl: String, onBack: () -> Unit) {
    val vm = vmOf(key = "live-$initialUrl") { LiveViewerViewModel(app, initialUrl) }
    val state = remember { WebViewState() }
    val base = app.api.baseUrl.orEmpty()
    val snackbar = remember { SnackbarHostState() }
    val focus = LocalFocusManager.current
    val clipboard = LocalClipboardManager.current
    val context = LocalContext.current

    val realUrl = state.currentUrl?.let { realUrlFromProxy(it, base) } ?: vm.address
    var draft by remember { mutableStateOf(realUrl) }
    var focused by remember { mutableStateOf(false) }
    var menu by remember { mutableStateOf(false) }
    LaunchedEffect(realUrl, focused) { if (!focused) draft = realUrl }
    LaunchedEffect(vm.message) { vm.message?.let { snackbar.showSnackbar(it); vm.consumeMessage() } }

    BackHandler(enabled = state.canGoBack) { state.goBack() }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.surface,
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            TopAppBar(
                navigationIcon = { IconButton(onClick = onBack) { Icon(R.drawable.ic_close, "Schließen") } },
                title = {
                    Surface(shape = CircleShape, color = MaterialTheme.colorScheme.surfaceContainerHigh, modifier = Modifier.fillMaxWidth().height(44.dp)) {
                        Row(Modifier.padding(horizontal = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                            Icon(if (realUrl.startsWith("https")) R.drawable.ic_lock else R.drawable.ic_language, null, Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                            BasicTextField(
                                value = draft,
                                onValueChange = { draft = it },
                                singleLine = true,
                                textStyle = MaterialTheme.typography.bodyMedium.copy(color = MaterialTheme.colorScheme.onSurface),
                                cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go),
                                keyboardActions = KeyboardActions(onGo = { focus.clearFocus(); vm.open(draft) }),
                                modifier = Modifier.weight(1f).padding(start = 10.dp).onFocusChanged { focused = it.isFocused },
                            )
                        }
                    }
                },
                actions = {
                    Box {
                        IconButton(onClick = { menu = true }) { Icon(R.drawable.ic_more, "Mehr") }
                        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                            DropdownMenuItem(
                                text = { Text("Im Browser öffnen") },
                                leadingIcon = { Icon(R.drawable.ic_open_in_new, null) },
                                onClick = { menu = false; runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(realUrl)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } },
                            )
                            DropdownMenuItem(
                                text = { Text("Link kopieren") },
                                leadingIcon = { Icon(R.drawable.ic_link, null) },
                                onClick = { menu = false; clipboard.setText(AnnotatedString(realUrl)) },
                            )
                        }
                    }
                },
            )
        },
        bottomBar = {
            BottomAppBar(
                actions = {
                    IconButton(onClick = state::goBack, enabled = state.canGoBack) { Icon(R.drawable.ic_back, "Zurück") }
                    IconButton(onClick = state::goForward, enabled = state.canGoForward) { Icon(R.drawable.ic_forward, "Vorwärts") }
                    IconButton(onClick = state::reload) { Icon(R.drawable.ic_refresh, "Neu laden") }
                },
                floatingActionButton = {
                    FloatingActionButton(onClick = { vm.archive(realUrl) }) { Icon(R.drawable.ic_inventory, "Diese Seite archivieren") }
                },
            )
        },
    ) { padding ->
        Box(Modifier.padding(padding).fillMaxSize()) {
            ProxyWebView(base, state, vm.request, Modifier.fillMaxSize())
            if (state.progress < 100) LinearProgressIndicator(progress = { state.progress / 100f }, modifier = Modifier.fillMaxWidth())
            vm.error?.let { Column(Modifier.padding(16.dp)) { ErrorNote(it) } }
        }
    }
}
