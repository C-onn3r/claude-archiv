package app.webarchiver.ui.account

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import app.webarchiver.R
import app.webarchiver.WebArchiverApp
import app.webarchiver.data.ApiException
import app.webarchiver.data.User
import app.webarchiver.ui.Avatar
import app.webarchiver.ui.ErrorNote
import app.webarchiver.ui.Icon
import kotlinx.coroutines.launch

/** Benutzerverwaltung (nur für Administratoren). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun UsersScreen(app: WebArchiverApp, onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    var users by remember { mutableStateOf<List<User>>(emptyList()) }
    var error by remember { mutableStateOf<String?>(null) }
    var showCreate by remember { mutableStateOf(false) }
    var passwordFor by remember { mutableStateOf<User?>(null) }
    var deleteFor by remember { mutableStateOf<User?>(null) }
    val me = app.store.state.value?.user

    suspend fun load() {
        try {
            users = app.api.listUsers()
            error = null
        } catch (e: ApiException) {
            error = e.message
        }
    }

    fun run(block: suspend () -> Unit) {
        scope.launch {
            try {
                block()
                load()
            } catch (e: ApiException) {
                snackbar.showSnackbar(e.message ?: "Fehler")
            }
        }
    }
    LaunchedEffect(Unit) { load() }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.surface,
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = { TopAppBar(title = { Text("Benutzer") }, navigationIcon = { IconButton(onClick = onBack) { Icon(R.drawable.ic_back, "Zurück") } }) },
        floatingActionButton = { ExtendedFloatingActionButton(onClick = { showCreate = true }, icon = { Icon(R.drawable.ic_add, null) }, text = { Text("Benutzer") }) },
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            error?.let { ErrorNote(it, Modifier.padding(16.dp)) }
            LazyColumn {
                items(users, key = { it.id }) { u ->
                    var menu by remember { mutableStateOf(false) }
                    ListItem(
                        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
                        leadingContent = { Avatar(u.initial, 40.dp) },
                        headlineContent = { Text(u.displayName.ifBlank { u.username }) },
                        supportingContent = { Text("${u.username} · ${if (u.isAdmin) "Administrator" else "Benutzer"}") },
                        trailingContent = {
                            Box {
                                IconButton(onClick = { menu = true }) { Icon(R.drawable.ic_more, "Mehr") }
                                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                                    DropdownMenuItem(
                                        text = { Text(if (u.isAdmin) "Zu Benutzer machen" else "Zu Administrator machen") },
                                        onClick = { menu = false; run { app.api.updateUser(u.id, role = if (u.isAdmin) "user" else "admin") } },
                                    )
                                    DropdownMenuItem(text = { Text("Passwort setzen") }, onClick = { menu = false; passwordFor = u })
                                    if (u.id != me?.id) DropdownMenuItem(text = { Text("Löschen") }, onClick = { menu = false; deleteFor = u })
                                }
                            }
                        },
                    )
                }
            }
        }
    }

    if (showCreate) {
        var username by remember { mutableStateOf("") }
        var password by remember { mutableStateOf("") }
        var admin by remember { mutableStateOf(false) }
        AlertDialog(
            onDismissRequest = { showCreate = false },
            title = { Text("Benutzer anlegen") },
            text = {
                Column {
                    OutlinedTextField(username, { username = it }, label = { Text("Benutzername") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    OutlinedTextField(
                        password, { password = it }, label = { Text("Passwort (mind. 8 Zeichen)") }, singleLine = true,
                        visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                        modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                    )
                    FilterChip(selected = admin, onClick = { admin = !admin }, label = { Text("Administrator") }, modifier = Modifier.padding(top = 12.dp))
                }
            },
            confirmButton = {
                TextButton(
                    enabled = username.length >= 3 && password.length >= 8,
                    onClick = { showCreate = false; run { app.api.createUser(username.trim(), password, if (admin) "admin" else "user") } },
                ) { Text("Anlegen") }
            },
            dismissButton = { TextButton(onClick = { showCreate = false }) { Text("Abbrechen") } },
        )
    }

    passwordFor?.let { u ->
        var password by remember(u.id) { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { passwordFor = null },
            title = { Text("Neues Passwort für ${u.username}") },
            text = {
                OutlinedTextField(
                    password, { password = it }, label = { Text("Passwort (mind. 8 Zeichen)") }, singleLine = true,
                    visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                    modifier = Modifier.fillMaxWidth(),
                )
            },
            confirmButton = { TextButton(enabled = password.length >= 8, onClick = { passwordFor = null; run { app.api.updateUser(u.id, password = password) } }) { Text("Setzen") } },
            dismissButton = { TextButton(onClick = { passwordFor = null }) { Text("Abbrechen") } },
        )
    }

    deleteFor?.let { u ->
        AlertDialog(
            onDismissRequest = { deleteFor = null },
            title = { Text("Benutzer löschen?") },
            text = { Text("„${u.username}“ wird inklusive aller Archive gelöscht.") },
            confirmButton = { TextButton(onClick = { deleteFor = null; run { app.api.deleteUser(u.id) } }) { Text("Löschen", color = MaterialTheme.colorScheme.error) } },
            dismissButton = { TextButton(onClick = { deleteFor = null }) { Text("Abbrechen") } },
        )
    }
}
