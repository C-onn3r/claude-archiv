package app.webarchiver.util

import app.webarchiver.WebArchiverApp
import app.webarchiver.data.Archive
import app.webarchiver.ui.home.Snack
import java.io.File

/** Lädt ein Archiv als PDF oder ZIP vom Server und legt es in "Downloads" ab. */
suspend fun exportArchive(app: WebArchiverApp, a: Archive, pdf: Boolean): Snack {
    val ext = if (pdf) "pdf" else "zip"
    val mime = if (pdf) "application/pdf" else "application/zip"
    val tmp = File(app.cacheDir, "exports/${System.nanoTime()}.$ext")
    try {
        app.api.download("/archives/${a.id}/${if (pdf) "pdf" else "download"}", tmp)
        val uri = Exporter.saveToDownloads(app, tmp, safeFileName(a.displayTitle, ext), mime)
        return Snack("${ext.uppercase()} in „Downloads“ gespeichert", uri, mime)
    } finally {
        tmp.delete()
    }
}
