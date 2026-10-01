package app.webarchiver.ui.account

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.webarchiver.R
import app.webarchiver.WebArchiverApp
import app.webarchiver.data.ApiException
import app.webarchiver.ui.Avatar
import app.webarchiver.ui.ErrorNote
import app.webarchiver.ui.Icon
import app.webarchiver.ui.SectionLabel
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AccountScreen(app: WebArchiverApp, onBack: () -> Unit) {
    val session by app.store.state.collectAsStateWithLifecycle()
    val user = session?.user
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    var name by remember(user?.id) { mutableStateOf(user?.displayName.orEmpty()) }
    var current by remember { mutableStateOf("") }
    var next by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }

    fun save() {
        error = null
        if (next.isNotEmpty() && next != confirm) {
            error = "Die neuen Passwörter stimmen nicht überein."
            return
        }
        if (next.isNotEmpty() && next.length < 8) {
            error = "Das neue Passwort braucht mindestens 8 Zeichen."
            return
        }
        busy = true
        scope.launch {
            try {
                app.api.updateProfile(name.trim().ifBlank { null }, current.ifBlank { null }, next.ifBlank { null })
                current = ""; next = ""; confirm = ""
                snackbar.showSnackbar("Gespeichert")
            } catch (e: ApiException) {
                error = e.message
            } finally {
                busy = false
            }
        }
    }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.surface,
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            TopAppBar(title = { Text("Konto") }, navigationIcon = { IconButton(onClick = onBack) { Icon(R.drawable.ic_back, "Zurück") } })
        },
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp)) {
            Row(Modifier.padding(vertical = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                Avatar(user?.initial ?: "?", 64.dp)
                Column(Modifier.padding(start = 16.dp)) {
                    Text(user?.displayName.orEmpty(), style = MaterialTheme.typography.titleLarge)
                    Text("${user?.username.orEmpty()} · ${if (user?.isAdmin == true) "Administrator" else "Benutzer"}", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(session?.baseUrl.orEmpty().removePrefix("https://").removePrefix("http://"), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            error?.let { ErrorNote(it); Spacer(Modifier.height(12.dp)) }
            OutlinedTextField(name, { name = it }, label = { Text("Anzeigename") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            SectionLabel("Passwort ändern", Modifier.padding(top = 20.dp, start = 0.dp))
            val pw = KeyboardOptions(keyboardType = KeyboardType.Password)
            OutlinedTextField(current, { current = it }, label = { Text("Aktuelles Passwort") }, singleLine = true, visualTransformation = PasswordVisualTransformation(), keyboardOptions = pw, modifier = Modifier.fillMaxWidth())
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(next, { next = it }, label = { Text("Neues Passwort") }, singleLine = true, visualTransformation = PasswordVisualTransformation(), keyboardOptions = pw, modifier = Modifier.fillMaxWidth())
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(confirm, { confirm = it }, label = { Text("Neues Passwort wiederholen") }, singleLine = true, visualTransformation = PasswordVisualTransformation(), keyboardOptions = pw, modifier = Modifier.fillMaxWidth())
            Spacer(Modifier.height(20.dp))
            Button(onClick = ::save, enabled = !busy, modifier = Modifier.align(Alignment.End)) { Text("Speichern") }
            Spacer(Modifier.height(32.dp))
        }
    }
}
