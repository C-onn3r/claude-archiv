package app.webarchiver.ui.viewer

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView

/** Eine Ladeanforderung; die `id` sorgt dafür, dass auch dieselbe URL erneut geladen wird (Neu laden). */
data class LoadRequest(val id: Int, val url: String)

/** Zustand der WebView, den die Compose-Oberfläche beobachtet. */
@Stable
class WebViewState {
    var webView: WebView? = null
    var canGoBack by mutableStateOf(false)
    var canGoForward by mutableStateOf(false)
    var progress by mutableIntStateOf(100)
    var currentUrl by mutableStateOf<String?>(null)
    var title by mutableStateOf<String?>(null)

    fun goBack() = webView?.goBack()
    fun goForward() = webView?.goForward()
    fun reload() = webView?.reload()
}

/**
 * WebView für Proxy- und Archiv-Inhalte.
 * Alles unter {baseUrl}/proxy/ und {baseUrl}/archive/ bleibt in der WebView; Links nach außen
 * (z. B. externe Links in Archiven) öffnen im System-Browser.
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun ProxyWebView(baseUrl: String, state: WebViewState, request: LoadRequest?, modifier: Modifier = Modifier) {
    var loaded by remember { mutableIntStateOf(-1) }
    AndroidView(
        modifier = modifier,
        factory = { ctx ->
            WebView(ctx).apply {
                settings.apply {
                    javaScriptEnabled = true
                    domStorageEnabled = true
                    allowFileAccess = false
                    allowContentAccess = false
                    useWideViewPort = true
                    loadWithOverviewMode = true
                    setSupportZoom(true)
                    builtInZoomControls = true
                    displayZoomControls = false
                    mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
                }
                webViewClient = object : WebViewClient() {
                    override fun shouldOverrideUrlLoading(view: WebView, req: WebResourceRequest): Boolean {
                        val url = req.url.toString()
                        if (url.startsWith("$baseUrl/proxy/") || url.startsWith("$baseUrl/archive/")) return false
                        if (req.url.scheme == "http" || req.url.scheme == "https" || req.url.scheme == "mailto" || req.url.scheme == "tel") {
                            runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
                        }
                        return true
                    }

                    override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
                        state.currentUrl = url
                    }

                    override fun doUpdateVisitedHistory(view: WebView, url: String, isReload: Boolean) {
                        state.currentUrl = url
                        state.canGoBack = view.canGoBack()
                        state.canGoForward = view.canGoForward()
                    }

                    override fun onPageFinished(view: WebView, url: String) {
                        state.currentUrl = url
                        state.canGoBack = view.canGoBack()
                        state.canGoForward = view.canGoForward()
                    }
                }
                webChromeClient = object : WebChromeClient() {
                    override fun onProgressChanged(view: WebView, newProgress: Int) {
                        state.progress = newProgress
                    }

                    override fun onReceivedTitle(view: WebView, title: String?) {
                        state.title = title
                    }
                }
                state.webView = this
            }
        },
        update = { view ->
            if (request != null && request.id != loaded) {
                loaded = request.id
                view.loadUrl(request.url)
            }
        },
        onRelease = {
            state.webView = null
            it.stopLoading()
            it.destroy()
        },
    )
}
