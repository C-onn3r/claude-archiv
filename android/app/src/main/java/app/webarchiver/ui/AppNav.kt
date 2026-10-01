package app.webarchiver.ui

import android.net.Uri
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import app.webarchiver.WebArchiverApp
import app.webarchiver.ui.account.AccountScreen
import app.webarchiver.ui.account.UsersScreen
import app.webarchiver.ui.home.HomeScreen
import app.webarchiver.ui.login.LoginScreen
import app.webarchiver.ui.viewer.ArchiveViewerScreen
import app.webarchiver.ui.viewer.LiveViewerScreen

object Routes {
    const val LOGIN = "login"
    const val HOME = "home"
    const val ACCOUNT = "account"
    const val USERS = "users"
    const val LIVE = "live/{url}"
    const val ARCHIVE = "archive/{id}"
    fun live(url: String) = "live/${Uri.encode(url)}"
    fun archive(id: String) = "archive/$id"
}

@Composable
fun AppNav(app: WebArchiverApp) {
    val nav = rememberNavController()
    val session by app.store.state.collectAsStateWithLifecycle()
    val start = remember { if (app.store.state.value != null) Routes.HOME else Routes.LOGIN }

    // Sitzung beendet (Logout oder abgelaufenes Refresh-Token) -> zurück zum Login, Verlauf leeren.
    LaunchedEffect(session == null) {
        val current = nav.currentDestination?.route
        if (session == null && current != null && current != Routes.LOGIN) {
            nav.navigate(Routes.LOGIN) { popUpTo(0) { inclusive = true } }
        }
    }

    NavHost(navController = nav, startDestination = start) {
        composable(Routes.LOGIN) {
            LoginScreen(app) {
                nav.navigate(Routes.HOME) { popUpTo(Routes.LOGIN) { inclusive = true } }
            }
        }
        composable(Routes.HOME) {
            HomeScreen(
                app = app,
                onOpenLive = { nav.navigate(Routes.live(it)) },
                onOpenArchive = { nav.navigate(Routes.archive(it)) },
                onAccount = { nav.navigate(Routes.ACCOUNT) },
                onUsers = { nav.navigate(Routes.USERS) },
            )
        }
        composable(Routes.ACCOUNT) { AccountScreen(app, onBack = { nav.popBackStack() }) }
        composable(Routes.USERS) { UsersScreen(app, onBack = { nav.popBackStack() }) }
        composable(Routes.LIVE, arguments = listOf(navArgument("url") { type = NavType.StringType })) { entry ->
            LiveViewerScreen(app, initialUrl = entry.arguments?.getString("url").orEmpty(), onBack = { nav.popBackStack() })
        }
        composable(Routes.ARCHIVE, arguments = listOf(navArgument("id") { type = NavType.StringType })) { entry ->
            ArchiveViewerScreen(app, archiveId = entry.arguments?.getString("id").orEmpty(), onBack = { nav.popBackStack() })
        }
    }
}
