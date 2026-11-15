package app.turbomusic.android.update

import android.content.Context
import app.turbomusic.android.BuildConfig
import app.turbomusic.android.ServerPrefs
import org.json.JSONArray
import java.io.File
import java.util.concurrent.Executors

/**
 * Gets the TurboMusic Server app (a separate, screen-less app that runs the server) from the newest GitHub release that carries it, the
 * same way the app updates itself: download, then Android's own installer asks the user to confirm. Both apps are signed with one key,
 * which is what lets this app start the server app's service.
 */
object ServerAppInstaller {
    @Volatile var state = AppUpdater.State("idle"); private set
    private val io = Executors.newSingleThreadExecutor()
    private fun set(s: AppUpdater.State) { state = s }

    fun fetch(context: Context) {
        val ctx = context.applicationContext
        if (state.status == "checking" || state.status == "downloading") return
        set(AppUpdater.State("checking"))
        io.execute {
            val prefs = ServerPrefs(ctx)
            try {
                val releases = JSONArray(AppUpdater.get("https://api.github.com/repos/${BuildConfig.REPO_OWNER}/${BuildConfig.REPO_NAME}/releases?per_page=20", prefs.updateToken, "application/vnd.github+json").bytes.toString(Charsets.UTF_8))
                val found = Releases.newestWithApk(releases, Releases.SERVER_SUFFIX)
                if (found == null) { set(AppUpdater.State("none", message = "No release with the server app has been published yet.")); return@execute }
                val version = found.first.removePrefix("v")
                set(AppUpdater.State("downloading", version, 0))
                val dir = File(ctx.cacheDir, "updates").apply { mkdirs() }
                val out = File(dir, "server.apk")
                AppUpdater.download(found.second, prefs.updateToken, out) { pct -> if (pct != state.percent) set(AppUpdater.State("downloading", version, pct)) }
                set(AppUpdater.State("ready", version))
            } catch (e: java.net.UnknownHostException) {
                set(AppUpdater.State("error", message = "No connection to GitHub. Check the phone's internet."))
            } catch (e: Exception) {
                set(AppUpdater.State("error", message = e.message ?: e.javaClass.simpleName))
            }
        }
    }

    fun install(context: Context) = AppUpdater.installFile(context, File(context.cacheDir, "updates/server.apk"))
}
