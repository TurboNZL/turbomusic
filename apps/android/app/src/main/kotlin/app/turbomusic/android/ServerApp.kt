package app.turbomusic.android

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import org.json.JSONObject
import java.security.SecureRandom

/**
 * Drives the TurboMusic Server app (package app.turbomusic.server): a second app with no screen whose foreground service runs the server.
 * This app starts and stops it with an explicit intent (the service demands a permission only apps with this app's signing key hold), and
 * hands it the access token, so it never has to read a token back out of the server's files.
 */
object ServerApp {
    const val PKG = "app.turbomusic.server"
    private const val SERVICE = "$PKG.ServerService"
    const val DEFAULT_PORT = 47813

    private fun version(ctx: Context): String? = try { ctx.packageManager.getPackageInfo(PKG, 0).versionName } catch (_: PackageManager.NameNotFoundException) { null }

    private fun newToken(): String { val a = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"; val r = SecureRandom(); return (1..32).map { a[r.nextInt(a.length)] }.joinToString("") }

    /** the token this app gives the server app (made once, kept) */
    fun token(ctx: Context): String { val p = ServerPrefs(ctx); if (p.serverAppToken.length < 16) p.serverAppToken = newToken(); return p.serverAppToken }

    fun status(ctx: Context): String {
        val p = ServerPrefs(ctx); val v = version(ctx)
        return JSONObject().put("installed", v != null).put("version", v ?: JSONObject.NULL).put("port", DEFAULT_PORT)
            .put("token", if (v != null) token(ctx) else "").put("autoStart", p.serverAppAuto).put("wake", p.serverAppWake).toString()
    }

    fun start(ctx: Context): Boolean {
        if (version(ctx) == null) return false
        val p = ServerPrefs(ctx)
        return try {
            ctx.startForegroundService(Intent().setComponent(ComponentName(PKG, SERVICE)).putExtra("token", token(ctx)).putExtra("port", DEFAULT_PORT).putExtra("wake", p.serverAppWake))
            true
        } catch (_: Exception) { false } // not allowed (the permission, or the app is in the background): the page says so
    }

    fun stop(ctx: Context): Boolean = try {
        ctx.startService(Intent().setComponent(ComponentName(PKG, SERVICE)).setAction("$PKG.STOP")); true
    } catch (_: Exception) { false }
}
