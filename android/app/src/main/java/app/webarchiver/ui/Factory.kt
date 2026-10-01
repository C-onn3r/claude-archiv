package app.webarchiver.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.compose.viewModel

/** Kleine Hilfsfunktion: ViewModel mit Konstruktor-Argumenten erzeugen, ohne Factory-Boilerplate. */
@androidx.compose.runtime.Composable
inline fun <reified VM : ViewModel> vmOf(key: String? = null, crossinline create: () -> VM): VM =
    viewModel(key = key, factory = object : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = create() as T
    })
