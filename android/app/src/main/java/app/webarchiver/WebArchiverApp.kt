package app.webarchiver

import android.app.Application
import app.webarchiver.data.ApiClient
import app.webarchiver.data.PrefsSessionStore
import app.webarchiver.data.SessionStore
import kotlinx.coroutines.flow.MutableStateFlow

/** Hält die langlebigen Objekte (Sitzung, API-Client) – bewusst ohne DI-Framework. */
class WebArchiverApp : Application() {
    lateinit var store: SessionStore
        private set
    lateinit var api: ApiClient
        private set

    /** Per "Teilen" empfangene URL; wird vom Home-Screen übernommen und geleert. */
    val incomingUrl = MutableStateFlow<String?>(null)

    override fun onCreate() {
        super.onCreate()
        store = PrefsSessionStore(this)
        api = ApiClient(store)
    }

    companion object {
        /** Voreingestellter Server beim ersten Start (im Login änderbar). */
        const val DEFAULT_SERVER = "https://archive.host-1.pi.frontend.conner.api64.de"
    }
}
