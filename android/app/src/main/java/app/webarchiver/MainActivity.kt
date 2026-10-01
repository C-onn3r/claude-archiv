package app.webarchiver

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import app.webarchiver.ui.AppNav
import app.webarchiver.ui.theme.WebArchiverTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val app = application as WebArchiverApp
        handleShare(intent)
        setContent {
            WebArchiverTheme {
                AppNav(app)
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleShare(intent)
    }

    private fun handleShare(intent: Intent?) {
        if (intent?.action != Intent.ACTION_SEND) return
        val text = intent.getStringExtra(Intent.EXTRA_TEXT) ?: return
        val url = Regex("https?://\\S+").find(text)?.value ?: text.trim().takeIf { it.contains('.') && !it.contains(' ') }
        (application as WebArchiverApp).incomingUrl.value = url
    }
}
