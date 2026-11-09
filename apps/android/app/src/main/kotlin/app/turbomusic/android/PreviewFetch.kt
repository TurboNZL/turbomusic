package app.turbomusic.android

import android.util.Base64
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** Decisions of [PreviewFetch] that need no Android classes (JVM-testable). */
object PreviewPlan {
    /** `Content-Range: bytes 0-0/12345` -> 12345 */
    fun totalFromContentRange(header: String?): Long? = header?.substringAfterLast('/')?.trim()?.toLongOrNull()?.takeIf { it > 0 }

    /** The byte range centred on the middle of the file, or null when the file is small enough to take whole. */
    fun window(total: Long, sliceBytes: Long): LongRange? =
        if (total <= sliceBytes * 2) null else (total / 2 - sliceBytes / 2).let { it until it + sliceBytes }

    fun isMp3(type: String?): Boolean = Regex("mpeg|mp3", RegexOption.IGNORE_CASE).containsMatchIn(type ?: "")
}

/**
 * Rank previews inside the app. The WebView does not hand a page a seekable, sized stream when the answer comes out of `shouldInterceptRequest`
 * (and a fetch() with a Range header is not reliably answered with 206 either), so the page's preview started near the END of what had
 * arrived and took long to start. Here the phone itself asks the server for the piece the preview needs, with the library token and the
 * Cloudflare Access headers, and hands the bytes to the page: the middle of an MP3 (frames find their own start), or a whole small file.
 * The answer arrives as the page event `turbomusic-preview` `{id, ok, whole, type, b64}`.
 */
object PreviewFetch {
    private const val WHOLE_LIMIT = 25L * 1024 * 1024

    fun start(prefs: ServerPrefs, id: String, url: String, sliceBytes: Long, emit: (String) -> Unit) {
        Thread {
            val out = JSONObject().put("id", id)
            try {
                require(AccessRoute.isServerRequest(prefs.serverUrl, url)) { "not the library server" }
                val (total, type) = probe(prefs, url)
                val win = if (PreviewPlan.isMp3(type)) PreviewPlan.window(total, sliceBytes) else null
                if (win == null && total > WHOLE_LIMIT) throw IllegalStateException("file too big to preview whole")
                val bytes = get(prefs, url, win)
                out.put("ok", true).put("whole", win == null).put("type", if (PreviewPlan.isMp3(type)) "audio/mpeg" else type).put("b64", Base64.encodeToString(bytes, Base64.NO_WRAP))
            } catch (e: Exception) { out.put("ok", false).put("error", e.message ?: e.javaClass.simpleName) }
            emit(out.toString())
        }.start()
    }

    private fun open(prefs: ServerPrefs, url: String, range: String): HttpURLConnection {
        val c = URL(url).openConnection() as HttpURLConnection
        c.connectTimeout = 15_000; c.readTimeout = 60_000
        c.setRequestProperty("Range", range)
        prefs.accessHeaders().forEach { (k, v) -> c.setRequestProperty(k, v) }
        return c
    }

    /** total size and content type via a one-byte range request */
    private fun probe(prefs: ServerPrefs, url: String): Pair<Long, String?> {
        val c = open(prefs, url, "bytes=0-0")
        try {
            val code = c.responseCode
            check(code == 206 || code == 200) { "server answered $code" }
            val total = (if (code == 206) PreviewPlan.totalFromContentRange(c.getHeaderField("Content-Range")) else null) ?: c.contentLengthLong.takeIf { it > 0 } ?: Long.MAX_VALUE
            return total to c.contentType?.substringBefore(';')?.trim()
        } finally { c.disconnect() }
    }

    private fun get(prefs: ServerPrefs, url: String, win: LongRange?): ByteArray {
        val c = open(prefs, url, if (win == null) "bytes=0-" else "bytes=${win.first}-${win.last}")
        try {
            val code = c.responseCode
            check(code == 206 || code == 200) { "server answered $code" }
            return c.inputStream.use { it.readBytes() }
        } finally { c.disconnect() }
    }
}
