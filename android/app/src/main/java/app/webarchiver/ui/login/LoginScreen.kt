package app.webarchiver.ui.login

import androidx.compose.animation.AnimatedContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import app.webarchiver.R
import app.webarchiver.WebArchiverApp
import app.webarchiver.ui.ErrorNote
import app.webarchiver.ui.Icon
import app.webarchiver.ui.vmOf

/** Zweistufiger Login im Stil von Google: erst Server, dann Zugangsdaten. */
@Composable
fun LoginScreen(app: WebArchiverApp, onLoggedIn: () -> Unit) {
    val vm = vmOf { LoginViewModel(app) }
    val focus = LocalFocusManager.current

    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.surface) {
        Column(
            Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .navigationBarsPadding()
                .imePadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 28.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.height(72.dp))
            Surface(shape = CircleShape, color = MaterialTheme.colorScheme.primary, contentColor = MaterialTheme.colorScheme.onPrimary, modifier = Modifier.size(64.dp)) {
                Box(contentAlignment = Alignment.Center) { Icon(R.drawable.ic_inventory, null, Modifier.size(34.dp)) }
            }
            Spacer(Modifier.height(24.dp))
            val meta = vm.meta
            Text(
                when {
                    meta == null -> "Willkommen"
                    meta.needsSetup -> "Administrator anlegen"
                    vm.registerMode -> "Konto erstellen"
                    else -> "Anmelden"
                },
                style = MaterialTheme.typography.headlineMedium,
            )
            Spacer(Modifier.height(8.dp))
            Text(
                when {
                    meta == null -> "Verbinde dich mit deinem Web-Archivierer-Server."
                    meta.needsSetup -> "Der erste Benutzer wird Administrator."
                    else -> "weiter zu ${meta.name.ifBlank { "Web-Archivierer" }}"
                },
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(32.dp))

            AnimatedContent(targetState = meta != null, label = "step") { connected ->
                Column(Modifier.fillMaxWidth()) {
                    if (!connected) {
                        OutlinedTextField(
                            value = vm.server,
                            onValueChange = { vm.server = it },
                            label = { Text("Server-Adresse") },
                            leadingIcon = { Icon(R.drawable.ic_dns, null) },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go),
                            keyboardActions = KeyboardActions(onGo = { focus.clearFocus(); vm.connect() }),
                        )
                    } else {
                        Surface(shape = CircleShape, color = MaterialTheme.colorScheme.surfaceContainerHigh, modifier = Modifier.align(Alignment.CenterHorizontally)) {
                            Row(Modifier.padding(start = 14.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                Icon(R.drawable.ic_dns, null, Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                                Text(vm.server.removePrefix("https://").removePrefix("http://"), style = MaterialTheme.typography.labelLarge, maxLines = 1)
                                IconButton(onClick = vm::changeServer, modifier = Modifier.size(32.dp)) { Icon(R.drawable.ic_close, "Server ändern", Modifier.size(16.dp)) }
                            }
                        }
                        Spacer(Modifier.height(20.dp))
                        OutlinedTextField(
                            value = vm.username,
                            onValueChange = { vm.username = it },
                            label = { Text("Benutzername") },
                            leadingIcon = { Icon(R.drawable.ic_person, null) },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next),
                            keyboardActions = KeyboardActions(onNext = { focus.moveFocus(FocusDirection.Down) }),
                        )
                        if (vm.registerMode) {
                            Spacer(Modifier.height(12.dp))
                            OutlinedTextField(
                                value = vm.displayName,
                                onValueChange = { vm.displayName = it },
                                label = { Text("Anzeigename (optional)") },
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth(),
                                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                                keyboardActions = KeyboardActions(onNext = { focus.moveFocus(FocusDirection.Down) }),
                            )
                        }
                        Spacer(Modifier.height(12.dp))
                        var visible by remember { mutableStateOf(false) }
                        OutlinedTextField(
                            value = vm.password,
                            onValueChange = { vm.password = it },
                            label = { Text("Passwort") },
                            leadingIcon = { Icon(R.drawable.ic_lock, null) },
                            trailingIcon = {
                                IconButton(onClick = { visible = !visible }) {
                                    Icon(if (visible) R.drawable.ic_visibility_off else R.drawable.ic_visibility, if (visible) "Passwort verbergen" else "Passwort anzeigen")
                                }
                            },
                            supportingText = if (vm.registerMode) ({ Text("Mindestens 8 Zeichen") }) else null,
                            singleLine = true,
                            visualTransformation = if (visible) VisualTransformation.None else PasswordVisualTransformation(),
                            modifier = Modifier.fillMaxWidth(),
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Go),
                            keyboardActions = KeyboardActions(onGo = { focus.clearFocus(); vm.submit(onLoggedIn) }),
                        )
                    }
                }
            }

            vm.error?.let {
                Spacer(Modifier.height(16.dp))
                ErrorNote(it)
            }
            Spacer(Modifier.height(28.dp))
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                if (meta != null && meta.registrationOpen && !meta.needsSetup) {
                    TextButton(onClick = vm::toggleRegister) { Text(if (vm.registerMode) "Zur Anmeldung" else "Konto erstellen") }
                } else Spacer(Modifier.size(1.dp))
                Button(
                    onClick = { focus.clearFocus(); if (meta == null) vm.connect() else vm.submit(onLoggedIn) },
                    enabled = !vm.busy,
                ) {
                    if (vm.busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimary)
                    else Text(if (meta == null) "Weiter" else if (vm.registerMode) "Registrieren" else "Anmelden")
                }
            }
            Spacer(Modifier.height(32.dp))
        }
    }
}
