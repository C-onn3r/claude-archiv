package app.webarchiver.util

import java.net.URI
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

fun formatBytes(n: Long): String {
    if (n < 1024) return "$n B"
    val units = arrayOf("KB", "MB", "GB")
    var v = n / 1024.0
    var i = 0
    while (v >= 1024 && i < units.lastIndex) {
        v /= 1024
        i++
    }
    return String.format(Locale.GERMANY, if (v < 10) "%.1f %s" else "%.0f %s", v, units[i])
}

/** "vor 5 Min.", "vor 3 Std.", "gestern", sonst Datum – wie in den Google-Apps. */
fun formatRelative(iso: String, now: Instant = Instant.now()): String {
    val then = runCatching { Instant.parse(iso) }.getOrNull() ?: return ""
    val d = Duration.between(then, now)
    val minutes = d.toMinutes()
    return when {
        minutes < 1 -> "gerade eben"
        minutes < 60 -> "vor $minutes Min."
        d.toHours() < 24 -> "vor ${d.toHours()} Std."
        d.toDays() == 1L -> "gestern"
        d.toDays() < 7 -> "vor ${d.toDays()} Tagen"
        else -> DateTimeFormatter.ofPattern("d. MMM yyyy", Locale.GERMANY).withZone(ZoneId.systemDefault()).format(then)
    }
}

fun formatDateTime(iso: String): String {
    val then = runCatching { Instant.parse(iso) }.getOrNull() ?: return ""
    return DateTimeFormatter.ofPattern("d. MMMM yyyy, HH:mm", Locale.GERMANY).withZone(ZoneId.systemDefault()).format(then)
}

fun hostOf(url: String): String = runCatching { URI(url).host }.getOrNull() ?: url.removePrefix("https://").removePrefix("http://").substringBefore('/')

fun safeFileName(title: String, ext: String): String {
    val base = title.replace(Regex("[^\\w.\\-]+"), "_").trim('_').take(60).ifEmpty { "archiv" }
    return "$base.$ext"
}
