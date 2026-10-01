package app.webarchiver.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.webarchiver.R

/** Material-Icon aus den mitgelieferten Vektor-Drawables. */
@Composable
fun Icon(id: Int, contentDescription: String?, modifier: Modifier = Modifier, tint: androidx.compose.ui.graphics.Color = androidx.compose.material3.LocalContentColor.current) {
    Icon(painter = painterResource(id), contentDescription = contentDescription, modifier = modifier, tint = tint)
}

/** Runder Avatar mit Initiale (wie das Google-Konto-Symbol). */
@Composable
fun Avatar(initial: String, size: Dp = 32.dp, modifier: Modifier = Modifier) {
    Surface(shape = CircleShape, color = MaterialTheme.colorScheme.primaryContainer, contentColor = MaterialTheme.colorScheme.onPrimaryContainer, modifier = modifier.size(size)) {
        androidx.compose.foundation.layout.Box(contentAlignment = Alignment.Center) {
            Text(initial, fontSize = (size.value * 0.45f).sp, fontWeight = FontWeight.Medium)
        }
    }
}

/** Fehlerzeile in einer getönten Karte. */
@Composable
fun ErrorNote(text: String, modifier: Modifier = Modifier) {
    Surface(color = MaterialTheme.colorScheme.errorContainer, contentColor = MaterialTheme.colorScheme.onErrorContainer, shape = MaterialTheme.shapes.medium, modifier = modifier.fillMaxWidth()) {
        Row(Modifier.padding(horizontal = 14.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Icon(R.drawable.ic_error, null, Modifier.size(20.dp))
            Text(text, style = MaterialTheme.typography.bodyMedium)
        }
    }
}

@Composable
fun SectionLabel(text: String, modifier: Modifier = Modifier) {
    Text(text, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary, modifier = modifier.padding(horizontal = 16.dp, vertical = 8.dp))
}

@Composable
fun Gap(h: Dp) { Spacer(Modifier.padding(top = h)) }

