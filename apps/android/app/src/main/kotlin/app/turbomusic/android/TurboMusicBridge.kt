package app.turbomusic.android

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.view.HapticFeedbackConstants
import android.view.View
import android.webkit.JavascriptInterface
import app.turbomusic.android.update.AppUpdater

/** `window.TurboMusicAndroid` in the web client. Java interfaces carry strings only, so results are JSON and changes arrive as events. */
class TurboMusicBridge(private val context: Context, private val view: View) {
    private val prefs = ServerPrefs(context)

    @JavascriptInterface fun version(): String = BuildConfig.VERSION_NAME
    @JavascriptInterface fun updateState(): String = AppUpdater.state.json()
    @JavascriptInterface fun checkForUpdate() = AppUpdater.check(context)
    @JavascriptInterface fun installUpdate() = AppUpdater.install(context)
    @JavascriptInterface fun hasUpdateToken(): Boolean = prefs.updateToken.isNotEmpty()
    @JavascriptInterface fun setUpdateToken(token: String) { prefs.updateToken = token }
    /** the web client tells the native side which server it uses, so Android Auto can browse the same library */
    @JavascriptInterface fun setServer(url: String, token: String) { prefs.serverUrl = url; prefs.token = token }

    /** the Cloudflare Access service token the server needs, if it sits behind Cloudflare Access */
    @JavascriptInterface fun setAccess(id: String, secret: String) { prefs.cfId = id; prefs.cfSecret = secret }
    /** this app adds the service token to the page's own GET requests for the server (AccessProxy), so the page need not download media whole to send it */
    @JavascriptInterface fun accessInjected(): Boolean = true

    // ---- the server module (beta): the TurboMusic server running in Termux, see TermuxServer.kt
    @JavascriptInterface fun termuxStatus(): String = Termux.status(context)
    /** the one line to paste into Termux, once */
    @JavascriptInterface fun termuxOneTimeLine(): String = Termux.oneTimeLine(context)
    // bridge calls arrive on a background thread; the clipboard is set on the main one, and the line ends in a newline so pasting it runs it
    @JavascriptInterface fun termuxCopyLine() { view.post { Termux.copy(context, Termux.oneTimeLine(context) + "\n") } }
    @JavascriptInterface fun termuxOpenTermux(): Boolean = Termux.openTermux(context)
    @JavascriptInterface fun termuxOpenInstallPage() = Termux.openInstallPage(context)
    @JavascriptInterface fun termuxOpenAppSettings() { view.post { Termux.openAppSettings(context) } }
    @JavascriptInterface fun termuxRequestPermission() { (context as? android.app.Activity)?.let { a -> view.post { Termux.requestPermission(a) } } }
    /** runs a harmless command in Termux to prove the permission and the Termux switch work */
    @JavascriptInterface fun termuxCheck(): Boolean = Termux.check(context)
    @JavascriptInterface fun termuxInstall(): Boolean = Termux.install(context)
    @JavascriptInterface fun termuxStart(): Boolean = Termux.start(context)
    @JavascriptInterface fun termuxStop(): Boolean = Termux.stop(context)
    @JavascriptInterface fun termuxRemove(deleteLibrary: Boolean): Boolean = Termux.remove(context, deleteLibrary)
    @JavascriptInterface fun termuxSetOptions(autoStart: Boolean, wake: Boolean) { prefs.termuxAutoStart = autoStart; prefs.termuxWake = wake }

    // ---- the app's own player (notification, lock screen, Bluetooth and car controls): see NativeAudio
    @JavascriptInterface fun audioSync(json: String) = NativeAudio.sync(json)
    @JavascriptInterface fun audioPlay() = NativeAudio.play()
    @JavascriptInterface fun audioPause() = NativeAudio.pause()
    @JavascriptInterface fun audioSeek(ms: Double) = NativeAudio.seek(ms.toLong())
    @JavascriptInterface fun audioVolume(v: Double) = NativeAudio.setVolume(v.toFloat())
    @JavascriptInterface fun audioStop() = NativeAudio.stop()
    @JavascriptInterface fun audioState(): String = NativeAudio.lastState
    /** the equaliser curve as JSON ({on, bands[10], preamp, bass}); kept so the car's playback has it as well */
    @JavascriptInterface fun setEq(json: String) {
        prefs.eq = json
        Handler(Looper.getMainLooper()).post { AudioFx.current?.apply() }
    }

    /**
     * Saves a PNG the page made (base64) to the phone's Pictures/TurboMusic folder (Android 10 and up, no permission needed). On older
     * Android, or if that fails, opens the share sheet instead. Returns "saved", "shared" or "error: <reason>". The WebView cannot
     * download a blob: link itself, which is why a web "Save picture" button did nothing in the app.
     */
    @JavascriptInterface fun saveImage(name: String, base64: String): String = try {
        val bytes = android.util.Base64.decode(base64, android.util.Base64.DEFAULT)
        val safe = name.replace(Regex("[^A-Za-z0-9._-]"), "_").ifEmpty { "turbomusic" }
        if (android.os.Build.VERSION.SDK_INT >= 29 && saveToPictures(safe, bytes)) "saved" else { shareBytes(safe, bytes); "shared" }
    } catch (e: Exception) { "error: ${e.message}" }

    /** Opens the share sheet with the picture. */
    @JavascriptInterface fun shareImage(name: String, base64: String): String = try {
        shareBytes(name.replace(Regex("[^A-Za-z0-9._-]"), "_").ifEmpty { "turbomusic" }, android.util.Base64.decode(base64, android.util.Base64.DEFAULT)); "shared"
    } catch (e: Exception) { "error: ${e.message}" }

    private fun saveToPictures(name: String, bytes: ByteArray): Boolean {
        val resolver = context.contentResolver
        val values = android.content.ContentValues().apply {
            put(android.provider.MediaStore.Images.Media.DISPLAY_NAME, "$name.png")
            put(android.provider.MediaStore.Images.Media.MIME_TYPE, "image/png")
            put(android.provider.MediaStore.Images.Media.RELATIVE_PATH, "Pictures/TurboMusic")
            put(android.provider.MediaStore.Images.Media.IS_PENDING, 1)
        }
        val uri = resolver.insert(android.provider.MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values) ?: return false
        return try {
            resolver.openOutputStream(uri)?.use { it.write(bytes) } ?: error("no output stream")
            values.clear(); values.put(android.provider.MediaStore.Images.Media.IS_PENDING, 0)
            resolver.update(uri, values, null, null)
            true
        } catch (e: Exception) { resolver.delete(uri, null, null); false }
    }

    private fun shareBytes(name: String, bytes: ByteArray) {
        val dir = java.io.File(context.cacheDir, "shared").apply { mkdirs() }
        val file = java.io.File(dir, "$name.png").apply { writeBytes(bytes) }
        val uri = androidx.core.content.FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
        val send = android.content.Intent(android.content.Intent.ACTION_SEND).apply {
            type = "image/png"
            putExtra(android.content.Intent.EXTRA_STREAM, uri)
            addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        val chooser = android.content.Intent.createChooser(send, name).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
        view.post { context.startActivity(chooser) }
    }

    /** Fetches what a Rank preview needs (see [PreviewFetch]); the answer comes back as the page event `turbomusic-preview`. */
    @JavascriptInterface fun fetchPreview(id: String, url: String, sliceBytes: Double) {
        PreviewFetch.start(prefs, id, url, sliceBytes.toLong()) { json ->
            view.post { (view as? android.webkit.WebView)?.evaluateJavascript("window.dispatchEvent(new CustomEvent('turbomusic-preview',{detail:$json}))", null) }
        }
    }

    /** Haptic feedback with the phone's own engine; follows the system "touch feedback" setting. */
    @JavascriptInterface fun haptic(kind: String) {
        val type = when (kind) {
            "tick" -> HapticFeedbackConstants.CLOCK_TICK
            "confirm" -> if (android.os.Build.VERSION.SDK_INT >= 30) HapticFeedbackConstants.CONFIRM else HapticFeedbackConstants.VIRTUAL_KEY
            "reject" -> if (android.os.Build.VERSION.SDK_INT >= 30) HapticFeedbackConstants.REJECT else HapticFeedbackConstants.LONG_PRESS
            "heavy" -> HapticFeedbackConstants.LONG_PRESS
            else -> HapticFeedbackConstants.VIRTUAL_KEY
        }
        view.post { view.performHapticFeedback(type) }
    }
}
