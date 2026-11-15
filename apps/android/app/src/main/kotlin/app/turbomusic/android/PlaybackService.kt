package app.turbomusic.android

import android.app.PendingIntent
import android.content.Intent
import android.os.Bundle
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.ForwardingPlayer
import androidx.media3.common.Player
import androidx.media3.session.DefaultMediaNotificationProvider
import androidx.media3.database.StandaloneDatabaseProvider
import androidx.media3.datasource.DataSourceBitmapLoader
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.ResolvingDataSource
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.datasource.cache.LeastRecentlyUsedCacheEvictor
import androidx.media3.datasource.cache.SimpleCache
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.session.LibraryResult
import androidx.media3.session.MediaLibraryService
import androidx.media3.session.MediaSession
import app.turbomusic.android.library.LibraryIndex
import app.turbomusic.android.library.ServerLibrary
import app.turbomusic.android.library.Track
import com.google.common.collect.ImmutableList
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.MoreExecutors
import com.google.common.util.concurrent.SettableFuture
import java.io.File
import java.util.concurrent.Executors

/**
 * The part of the app Android Auto talks to (it can only show a native media app, not a web page). It offers the library as a browse
 * tree (Albums, Artists, Playlists, Singles), plays the audio from the user's server, and gives the notification, lock screen and
 * Bluetooth/steering-wheel controls for free through Media3. Android Auto draws its own screen: there is no custom UI here.
 */
class PlaybackService : MediaLibraryService() {
    private var session: MediaLibrarySession? = null
    private val io = Executors.newSingleThreadExecutor()
    private lateinit var library: ServerLibrary
    private var cache: SimpleCache? = null
    private var fx: AudioFx? = null
    private var focus: FocusKeeper? = null

    override fun onCreate() {
        super.onCreate()
        library = ServerLibrary(ServerPrefs(this))
        // Everything played is kept on the phone (512 MB, oldest dropped first): replaying a track, or seeking back in it, does not download it again
        val simpleCache = SimpleCache(File(cacheDir, "audio"), LeastRecentlyUsedCacheEvictor(512L * 1024 * 1024), StandaloneDatabaseProvider(this))
        cache = simpleCache
        // a server behind Cloudflare Access wants the service token on every request (read when the request is made, so a change in Settings applies at once)
        val prefsForHeaders = ServerPrefs(this)
        val upstream = ResolvingDataSource.Factory(DefaultDataSource.Factory(this)) { spec ->
            val extra = prefsForHeaders.accessHeaders()
            if (extra.isEmpty()) spec else spec.withAdditionalHeaders(extra)
        }
        val sources = CacheDataSource.Factory().setCache(simpleCache).setUpstreamDataSourceFactory(upstream)
            .setFlags(CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR)
        // start sooner: ExoPlayer's default waits for 2.5 s of audio before the first sound (which over a tunnel is the "delay" a tap felt like);
        // a short wait is enough for a music stream, and the longer buffers keep the following tracks loading ahead so back-to-back stays gapless
        val loadControl = androidx.media3.exoplayer.DefaultLoadControl.Builder()
            .setBufferDurationsMs(20_000, 60_000, 700, 2_000)
            .setPrioritizeTimeOverSizeThresholds(true)
            .build()
        val player = ExoPlayer.Builder(this)
            .setLoadControl(loadControl)
            .setMediaSourceFactory(DefaultMediaSourceFactory(sources))
            .setAudioAttributes(AudioAttributes.Builder().setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).setUsage(C.USAGE_MEDIA).build(), false) // audio focus is FocusKeeper's: Play must also work during a call
            .setHandleAudioBecomingNoisy(true)
            .build()
        focus = FocusKeeper(this, player)
        // Next and Previous are always offered (notification, lock screen, headset, car). When the app's player has nothing after the current
        // track (its window is only a dozen tracks, and a track only the page can play ends it) the page, which owns the queue, decides what is next.
        val offered = object : ForwardingPlayer(player) {
            private val always = setOf(Player.COMMAND_SEEK_TO_NEXT, Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM, Player.COMMAND_SEEK_TO_PREVIOUS, Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM)
            override fun getAvailableCommands(): Player.Commands = super.getAvailableCommands().buildUpon().apply { always.forEach { add(it) } }.build()
            override fun isCommandAvailable(command: Int): Boolean = command in always || super.isCommandAvailable(command)
            override fun seekToNext() { if (hasNextMediaItem()) super.seekToNext() else NativeAudio.requestNext() }
            override fun seekToNextMediaItem() = seekToNext()
            override fun seekToPrevious() { if (currentPosition > 3000 || hasPreviousMediaItem()) super.seekToPrevious() else NativeAudio.requestPrevious() }
            override fun seekToPreviousMediaItem() = seekToPrevious()
        }
        val effects = AudioFx(ServerPrefs(this))
        fx = effects
        AudioFx.current = effects
        player.addListener(object : Player.Listener {
            override fun onAudioSessionIdChanged(audioSessionId: Int) { effects.attach(audioSessionId) }
        })
        effects.attach(player.audioSessionId)
        // tapping the notification opens the app
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        // the notification's small icon: the default is Media3's generic play-in-a-circle, which One UI shows as is
        setMediaNotificationProvider(DefaultMediaNotificationProvider.Builder(this).build().also { it.setSmallIcon(R.drawable.ic_stat_turbomusic) })
        // The notification and lock-screen cover is fetched by the session's bitmap loader, whose default has no way to send the Access service token,
        // so behind Cloudflare Access it got the login page and no picture. It uses the player's own upstream (same headers) on its own thread.
        val artLoader = DataSourceBitmapLoader(MoreExecutors.listeningDecorator(Executors.newFixedThreadPool(2)), upstream)
        session = MediaLibrarySession.Builder(this, offered, Callback()).setSessionActivity(open).setBitmapLoader(ArtLoader(artLoader)).build()
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaLibrarySession? = session

    override fun onDestroy() {
        session?.run { player.release(); release() }
        session = null
        AudioFx.current = null
        fx?.release()
        focus?.release()
        cache?.release()
        io.shutdown()
        super.onDestroy()
    }

    // ids: "root", "albums", "artists", "playlists", "singles", "album/<id>", "artist/<id>", "playlist/<id>",
    // and for a track "t/<trackId>/<context>" where the context ("album/<id>", "playlist/<id>", "singles") says what to queue with it
    private fun folder(id: String, title: String) = MediaItem.Builder().setMediaId(id).setMediaMetadata(
        MediaMetadata.Builder().setTitle(title).setIsBrowsable(true).setIsPlayable(false).setMediaType(MediaMetadata.MEDIA_TYPE_FOLDER_MIXED).build()).build()

    private fun folderWithArt(id: String, title: String, subtitle: String?, cover: String?, type: Int) = MediaItem.Builder().setMediaId(id).setMediaMetadata(
        MediaMetadata.Builder().setTitle(title).setArtist(subtitle).setIsBrowsable(true).setIsPlayable(false).setMediaType(type)
            .apply { cover?.let { setArtworkUri(android.net.Uri.parse(library.fileUrl(it))) } }.build()).build()

    private fun trackItem(t: Track, context: String) = MediaItem.Builder()
        .setMediaId("t/${t.id}/$context")
        .setUri(library.fileUrl(t.file))
        .setMediaMetadata(MediaMetadata.Builder().setTitle(t.title).setArtist(t.artistName).setAlbumTitle(t.albumTitle)
            .setIsBrowsable(false).setIsPlayable(true).setMediaType(MediaMetadata.MEDIA_TYPE_MUSIC)
            .apply { t.cover?.let { setArtworkUri(android.net.Uri.parse(library.fileUrl(it))) } }.build())
        .build()

    private fun tracksOf(context: String, lib: LibraryIndex): List<Track> = when {
        context.startsWith("album/") -> lib.albumTracks(context.removePrefix("album/"))
        context.startsWith("playlist/") -> lib.playlistTracks(context.removePrefix("playlist/"))
        context == "singles" -> lib.singles()
        else -> emptyList()
    }

    private fun children(parent: String, lib: LibraryIndex): List<MediaItem> = when {
        parent == "root" -> listOf(folder("albums", "Albums"), folder("artists", "Artists"), folder("playlists", "Playlists"), folder("singles", "Singles"))
        parent == "albums" -> lib.albums().map { a -> folderWithArt("album/${a.id}", a.title, lib.artists().firstOrNull { it.id == a.artistId }?.name, a.cover, MediaMetadata.MEDIA_TYPE_ALBUM) }
        parent == "artists" -> lib.artists().map { folder("artist/${it.id}", it.name) }
        parent == "playlists" -> lib.playlists().map { folderWithArt("playlist/${it.id}", it.name, null, it.cover, MediaMetadata.MEDIA_TYPE_PLAYLIST) }
        parent == "singles" -> lib.singles().map { trackItem(it, "singles") }
        parent.startsWith("artist/") -> lib.artistAlbums(parent.removePrefix("artist/")).map { a -> folderWithArt("album/${a.id}", a.title, null, a.cover, MediaMetadata.MEDIA_TYPE_ALBUM) }
        else -> tracksOf(parent, lib).map { trackItem(it, parent) }
    }

    private fun <T> background(work: () -> T): ListenableFuture<T> {
        val f = SettableFuture.create<T>()
        io.execute { try { f.set(work()) } catch (e: Throwable) { f.setException(e) } }
        return f
    }

    private inner class Callback : MediaLibrarySession.Callback {
        override fun onGetLibraryRoot(session: MediaLibrarySession, browser: MediaSession.ControllerInfo, params: LibraryParams?): ListenableFuture<LibraryResult<MediaItem>> =
            Futures.immediateFuture(LibraryResult.ofItem(folder("root", "TurboMusic"), params))

        override fun onGetChildren(session: MediaLibrarySession, browser: MediaSession.ControllerInfo, parentId: String, page: Int, pageSize: Int, params: LibraryParams?): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> =
            background {
                val all = children(parentId, library.get())
                val from = (page * pageSize).coerceAtMost(all.size)
                LibraryResult.ofItemList(ImmutableList.copyOf(all.subList(from, (from + pageSize).coerceAtMost(all.size))), params)
            }

        override fun onGetItem(session: MediaLibrarySession, browser: MediaSession.ControllerInfo, mediaId: String): ListenableFuture<LibraryResult<MediaItem>> =
            background {
                val lib = library.get()
                val item = if (mediaId.startsWith("t/")) lib.track(mediaId.split('/')[1])?.let { trackItem(it, mediaId.split('/', limit = 3).getOrElse(2) { "" }) } else folder(mediaId, mediaId)
                if (item == null) LibraryResult.ofError(LibraryResult.RESULT_ERROR_BAD_VALUE) else LibraryResult.ofItem(item, null)
            }

        // Android Auto asks to play one track: queue the whole album / playlist from it, like the app does
        override fun onSetMediaItems(mediaSession: MediaSession, controller: MediaSession.ControllerInfo, mediaItems: MutableList<MediaItem>, startIndex: Int, startPositionMs: Long): ListenableFuture<MediaSession.MediaItemsWithStartPosition> {
            // The page's own queue (NativeAudio) carries stream URLs already: hand it straight to the player. Fetching the library first
            // (the whole /api/sync/pull) made every play wait ~10 s for nothing. Only Android Auto's "t/<id>/<context>" ids need the library.
            if (mediaItems.none { it.mediaId.startsWith("t/") } && mediaItems.all { it.localConfiguration != null }) {
                return Futures.immediateFuture(MediaSession.MediaItemsWithStartPosition(mediaItems, startIndex, startPositionMs))
            }
            return background {
                val lib = library.get()
                val first = mediaItems.firstOrNull()
                val parts = first?.mediaId?.split('/', limit = 3)
                if (mediaItems.size == 1 && parts != null && parts.size == 3 && parts[0] == "t") {
                    val context = parts[2]
                    val list = tracksOf(context, lib)
                    val at = list.indexOfFirst { it.id == parts[1] }
                    if (at >= 0) return@background MediaSession.MediaItemsWithStartPosition(list.map { trackItem(it, context) }, at, startPositionMs)
                }
                // "t/<id>/<context>" ids come from the Android Auto browse tree and are resolved from the library; any other item is one
                // the page (NativeAudio) queued, already carrying its stream URL, and must pass through untouched (dropping them left the player silent)
                val resolved = mediaItems.mapNotNull { m ->
                    val p = m.mediaId.split('/', limit = 3)
                    if (p.size >= 2 && p[0] == "t") lib.track(p[1])?.let { trackItem(it, p.getOrElse(2) { "" }) }
                    else if (m.localConfiguration != null) m else null
                }
                MediaSession.MediaItemsWithStartPosition(resolved, startIndex.coerceIn(0, (resolved.size - 1).coerceAtLeast(0)), startPositionMs)
            }
        }
    }
}
