import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { timingSafeEqual } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { pushSchema, RECORD_TABLES, sha256Hex, type PullResponse } from '@turbomusic/core';
import type { Config } from './config.ts';
import { Store } from './db.ts';
import { Acquirer } from './acquire.ts';
import { analyzeAudio } from './audioinfo.ts';
import { Matcher, type MatchAlbum } from './match.ts';
import { LyricsFinder } from './lyrics.ts';
import { similarArtists } from './recommend.ts';
import { lookupAlbumDate } from './dates.ts';
import { lookupAlbumGenres, lookupArtistImage } from './lookups.ts';
import { Soloist } from './soloist.ts';
import { ImportError, Importer } from './import.ts';
import { serveWeb } from './web.ts';
import { Updater } from './update.ts';
import { BundleUpdater } from './bundleUpdate.ts';
import { SpotifyAccount, SpotifyError, oembed, parseRef, resolveLink } from './spotify.ts';
import { streamSSE } from 'hono/streaming';
import { ConnectHub, parseCommand, parseSnapshot } from './connect.ts';
import { checkTools } from './tools.ts';
import { assessHealth, collectHealth } from './health.ts';
import { StorageError, StorageMover, describeStorage, isKind } from './storage.ts';
import { BackupError, databaseSnapshot, filesArchive, importFiles, readDatabaseRecords, readStream, saveUpload } from './backup.ts';
import { Readable } from 'node:stream';
import { Mirror, MirrorError } from './mirror.ts';
import { README, libraryJson, loadInput, planLayout, playlistFiles, tracksCsv } from './libraryExport.ts';
import { tarChunks, tarLength, type TarEntry } from './tar.ts';
import { rmSync } from 'node:fs';
import { diskUsage, filePath, parseRange, saveVerified, streamFile, UploadError } from './files.ts';

export const API_VERSION = 1;

function tokenOk(given: string | undefined, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createApp(
  config: Config, store: Store,
  acquirer = new Acquirer({ dataDir: config.dataDir, store, ytdlp: config.ytdlp, ytdlpArgs: config.ytdlpArgs, ffmpegDir: config.ffmpegDir }),
  importer = new Importer({ dataDir: config.dataDir, store, ytdlp: config.ytdlp, ytdlpArgs: config.ytdlpArgs }),
  hub = new ConnectHub(),
  updater: Pick<Updater, 'available' | 'restarts' | 'state' | 'start'> = config.installRoot
    ? new BundleUpdater({ root: config.installRoot, token: config.githubToken, currentVersion: process.env.TURBOMUSIC_VERSION, exit: () => process.exit(1) })
    : new Updater({ script: config.updateScript, restart: config.updateRestart, exit: () => process.exit(1) }),
  spotify = new SpotifyAccount(config.dataDir, { env: process.env }),
  matcher = new Matcher({ ytdlp: config.ytdlp, ytdlpArgs: config.ytdlpArgs, cover: (urls) => importer.fetchFirstCover(urls) }),
  mover = new StorageMover(config.dataDir),
  soloist = new Soloist(config.dataDir, { ffmpegDir: config.ffmpegDir }),
  lyricsFinder = new LyricsFinder(),
  mirror = new Mirror(config.dataDir, store),
) {
  const app = new Hono();

  // Native apps ignore CORS; browsers need it because the web client may be served from another origin.
  app.use('*', cors({ origin: '*', allowHeaders: ['Authorization', 'Content-Type', 'Range', 'CF-Access-Client-Id', 'CF-Access-Client-Secret'], exposeHeaders: ['Content-Range', 'Accept-Ranges'] }));

  // Unauthenticated, reveals nothing but liveness, so clients can probe "is the server reachable?".
  app.get('/api/health', (c) => c.json({ ok: true, apiVersion: API_VERSION }));

  // Everything else needs the token. `?token=` exists because <audio src> cannot set headers.
  app.use('/api/*', async (c, next) => {
    // Spotify sends the browser here after the user allows access; the secret `state` in the address is what authorises it
    if (c.req.path === '/api/spotify/callback') return next();
    const bearer = c.req.header('Authorization')?.replace(/^Bearer\s+/i, '');
    if (!tokenOk(bearer ?? c.req.query('token'), config.token)) return c.json({ error: 'unauthorized' }, 401);
    await next();
  });

  app.get('/api/status', async (c) => {
    const files = store.listFiles();
    return c.json({
      apiVersion: API_VERSION,
      cursor: store.cursor(),
      files: { count: files.length, bytes: files.reduce((n, f) => n + f.size, 0) },
      disk: diskUsage(config.dataDir),
      tools: { ...(await checkTools({ ytdlp: config.ytdlp, ffmpegDir: config.ffmpegDir })), cookies: !!config.ytdlpArgs?.includes('--cookies') },
    });
  });

  // ---- Server health (health.ts): cheap enough to ask every few seconds ----
  app.get('/api/admin/health', async (c) => {
    const snapshot = await collectHealth(config.dataDir);
    return c.json({ snapshot, warnings: assessHealth(snapshot) });
  });

  // ---- Storage locations (storage.ts): move the library files, temp files or yt-dlp cache to another drive ----
  app.get('/api/admin/storage', (c) => c.json({ entries: describeStorage(config.dataDir), job: mover.state(), dataDir: config.dataDir }));
  app.post('/api/admin/storage', async (c) => {
    const b = (await c.req.json().catch(() => null)) as { kind?: unknown; target?: unknown } | null;
    if (!isKind(b?.kind) || typeof b?.target !== 'string') return c.json({ error: 'kind and target are required' }, 400);
    try { mover.start(b.kind, b.target); } catch (e) { return c.json({ error: (e as Error).message }, e instanceof StorageError ? 409 : 500); }
    return c.json({ ok: true }, 202);
  });


  // ---- Update server (update.ts): only offered when this is a service install of a git checkout ----
  app.get('/api/admin/update', (c) => c.json({ available: updater.available, restarts: updater.restarts, ...updater.state() }));
  app.post('/api/admin/update', (c) => {
    if (!updater.available) return c.json({ error: 'This server cannot update itself (it is not the self-contained install, nor a service install of the git checkout).' }, 404);
    if (!updater.start()) return c.json({ error: 'An update is already running.' }, 409);
    return c.json({ ok: true }, 202);
  });

  // ---- Connect: see the other devices, control them, move playback between them (connect.ts) ----
  app.get('/api/connect/stream', (c) => {
    const id = c.req.query('device') ?? '';
    if (!id) return c.json({ error: 'device missing' }, 400);
    return streamSSE(c, async (stream) => {
      const queue: string[] = [];
      let wake: (() => void) | null = null;
      const close = hub.connect({ id, name: c.req.query('name') ?? '', kind: c.req.query('kind') ?? 'web' }, (ev) => { queue.push(JSON.stringify(ev)); wake?.(); });
      let open = true;
      stream.onAbort(() => { open = false; wake?.(); });
      try {
        while (open) {
          while (queue.length) await stream.writeSSE({ event: 'connect', data: queue.shift()! });
          // a comment-sized ping every 20 s keeps proxies from closing an idle stream
          await Promise.race([new Promise<void>((r) => { wake = r; }), new Promise<void>((r) => setTimeout(r, 20_000))]);
          if (open && !queue.length) await stream.writeSSE({ event: 'ping', data: '1' });
        }
      } finally { close(); }
    });
  });
  app.get('/api/connect/devices', (c) => c.json({ devices: hub.list() }));
  app.post('/api/connect/state', async (c) => {
    const b = (await c.req.json().catch(() => null)) as { device?: unknown; name?: unknown; state?: unknown } | null;
    if (typeof b?.device !== 'string') return c.json({ error: 'device missing' }, 400);
    const state = b.state == null ? null : parseSnapshot(b.state);
    if (b.state != null && !state) return c.json({ error: 'bad state' }, 400);
    return hub.report(b.device, state, typeof b.name === 'string' ? b.name : undefined) ? c.json({ ok: true }) : c.json({ error: 'device not connected' }, 404);
  });
  app.post('/api/connect/command', async (c) => {
    const b = (await c.req.json().catch(() => null)) as { from?: unknown; to?: unknown; command?: unknown } | null;
    const command = parseCommand(b?.command);
    if (typeof b?.from !== 'string' || typeof b.to !== 'string' || !command) return c.json({ error: 'invalid command' }, 400);
    return hub.command(b.from, b.to, command) ? c.json({ ok: true }) : c.json({ error: 'That device is offline' }, 404);
  });

  app.get('/api/sync/pull', (c) => {
    const since = Number(c.req.query('since') ?? 0);
    const limit = Math.min(Number(c.req.query('limit') ?? 1000), 5000);
    if (!Number.isFinite(since) || since < 0) return c.json({ error: 'bad since' }, 400);
    const res: PullResponse = store.pull(since, limit);
    return c.json(res);
  });

  app.post('/api/sync/push', async (c) => {
    const parsed = pushSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid body', issues: parsed.error.issues.slice(0, 5) }, 400);
    const pushed = store.push(parsed.data.records);
    mirror.touch();
    return c.json(pushed);
  });

  // Re-download audio for tracks that have a source URL but no file (e.g. after losing the old uploads folder).
  // ---- audio check: what a file really is (bit rate, codec, highest frequency with sound), for the "fake 320" check in Health ----
  app.post('/api/audio/analyze', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { hash?: unknown };
    const hash = typeof body.hash === 'string' ? body.hash : '';
    if (!/^[0-9a-f]{64}$/.test(hash)) return c.json({ error: 'bad hash' }, 400);
    const path = store.hasFile(hash) && filePath(config.dataDir, hash);
    if (!path || !existsSync(path)) return c.json({ error: 'no such file' }, 404);
    return c.json(await analyzeAudio(path, { ffmpegDir: config.ffmpegDir }));
  });

  app.post('/api/acquire', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { trackIds?: unknown };
    const ids = Array.isArray(body.trackIds) ? body.trackIds.filter((x): x is string => typeof x === 'string') : undefined;
    return c.json({ queued: acquirer.enqueueMissing(ids).length });
  });
  app.get('/api/acquire', (c) => {
    const jobs = [...acquirer.jobs.values()];
    const count = (s: string) => jobs.filter((j) => j.state === s).length;
    return c.json({ queued: count('queued'), running: count('running'), done: count('done'), failed: count('failed'),
      failures: jobs.filter((j) => j.state === 'failed').slice(-20).map(({ trackId, error, dead }) => ({ trackId, error, dead: !!dead })),
      // what is downloading right now, with how far along it is
      active: jobs.filter((j) => j.state === 'running').map(({ trackId, stage, percent }) => ({ trackId, stage: stage ?? 'downloading', percent: percent ?? 0 })) });
  });

  // ---- lyrics (lyrics.ts, from LRCLIB) ----
  app.get('/api/lyrics', async (c) => {
    const artist = (c.req.query('artist') ?? '').slice(0, 200), title = (c.req.query('title') ?? '').slice(0, 200);
    if (!artist || !title) return c.json({ error: 'artist and title are needed' }, 400);
    const duration = Number(c.req.query('duration'));
    const lyrics = await lyricsFinder.find({ artist, title, album: (c.req.query('album') ?? '').slice(0, 200) || undefined, duration: Number.isFinite(duration) && duration > 0 ? duration : undefined }).catch(() => null);
    return c.json({ lyrics });
  });

  // ---- find the YouTube Music album of albums that have no link (match.ts): a few albums per request, the page asks again for the next batch ----
  app.post('/api/match-album', async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { albums?: unknown };
    const albums = (Array.isArray(b.albums) ? b.albums : []).slice(0, 6).flatMap((a: any): MatchAlbum[] => typeof a?.id === 'string' && typeof a.title === 'string'
      ? [{ id: a.id, title: a.title.slice(0, 200), artist: String(a.artist ?? '').slice(0, 200), trackCount: typeof a.trackCount === 'number' ? a.trackCount : null }] : []);
    if (!albums.length) return c.json({ error: 'nothing to match' }, 400);
    const out = [];
    for (let i = 0; i < albums.length; i += 3) out.push(...(await Promise.all(albums.slice(i, i + 3).map((a) => matcher.album(a)))));
    return c.json({ results: out });
  });

  // ---- release dates (dates.ts): when albums came out, a few per request (MusicBrainz asks for about one request a second) ----
  app.post('/api/dates', async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { albums?: unknown };
    const albums = (Array.isArray(b.albums) ? b.albums : []).slice(0, 8).flatMap((a: any) => typeof a?.id === 'string' && typeof a.album === 'string' && typeof a.artist === 'string' ? [{ id: a.id, album: a.album.slice(0, 200), artist: a.artist.slice(0, 200) }] : []);
    if (!albums.length) return c.json({ error: 'nothing to look up' }, 400);
    const useSpotify = spotify.status().signedIn ? spotify : null;
    const results = [];
    for (const a of albums) results.push({ id: a.id, answer: await lookupAlbumDate(a, { spotify: useSpotify }) });
    return c.json({ results });
  });

  // ---- gaps in the library (lookups.ts): an artist's picture (downloaded into the file store) and an album's genres, a few per request ----
  app.post('/api/artist-images', async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { artists?: unknown };
    const artists = (Array.isArray(b.artists) ? b.artists : []).slice(0, 6).flatMap((a: any) => typeof a?.id === 'string' && typeof a.name === 'string' ? [{ id: a.id, names: [a.name, ...(Array.isArray(a.aliases) ? a.aliases : [])].filter((x: unknown): x is string => typeof x === 'string').map((x) => x.slice(0, 200)) }] : []);
    if (!artists.length) return c.json({ error: 'nothing to look up' }, 400);
    const results = [];
    for (const a of artists) {
      const hit = await lookupArtistImage(a.names);
      let hash: string | null = null;
      if (hit) { try { hash = await importer.fetchCover(hit.image); } catch { /* the picture could not be downloaded: counts as not found */ } }
      results.push({ id: a.id, hash, source: hit?.source ?? null, matched: hit?.name ?? null });
    }
    return c.json({ results });
  });
  app.post('/api/album-genres', async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { albums?: unknown };
    const albums = (Array.isArray(b.albums) ? b.albums : []).slice(0, 6).flatMap((a: any) => typeof a?.id === 'string' && typeof a.album === 'string' && typeof a.artist === 'string' ? [{ id: a.id, album: a.album.slice(0, 200), artist: a.artist.slice(0, 200) }] : []);
    if (!albums.length) return c.json({ error: 'nothing to look up' }, 400);
    const results = [];
    for (const a of albums) results.push({ id: a.id, genres: await lookupAlbumGenres(a) });
    return c.json({ results });
  });

  // ---- Soloist (soloist.ts): Spotify's own headless Connect client, installed and run by this server so TurboMusic plays Spotify tracks itself ----
  app.get('/api/soloist', async (c) => c.json(await soloist.status()));
  app.post('/api/soloist/config', async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { deviceName?: unknown; apiKey?: unknown; autoStart?: unknown; outputDevice?: unknown; beam?: unknown };
    const before = soloist.config();
    try { soloist.configure({ deviceName: typeof b.deviceName === 'string' ? b.deviceName : undefined, apiKey: typeof b.apiKey === 'string' ? b.apiKey : undefined, autoStart: typeof b.autoStart === 'boolean' ? b.autoStart : undefined, beam: typeof b.beam === 'boolean' ? b.beam : undefined, outputDevice: typeof b.outputDevice === 'string' ? b.outputDevice : undefined }); const now = soloist.config();
      // Soloist is started pointed at its output, so a change of output (speakers or the stream) needs a restart to take effect
      if ((now.beam !== before.beam || now.outputDevice !== before.outputDevice) && (await soloist.status()).running) { await soloist.stop(); try { soloist.start(); } catch { /* shown in the status */ } }
      return c.json(await soloist.status()); }
    catch (e) { return c.json({ error: (e as Error).message }, 400); }
  });
  // the live stream of Soloist's sound (beam.ts): the apps play it like internet radio
  app.get('/api/soloist/stream', (c) => {
    if (!soloist.config().beam) return c.json({ error: 'Beaming is off: turn on "Send the sound to the apps" in Settings > Spotify > Soloist.' }, 404);
    let stop = () => {};
    const body = new ReadableStream<Uint8Array>({
      start(ctrl) {
        const h = soloist.beam.listen((chunk) => {
          // a client that cannot keep up is dropped instead of filling the server's memory
          if ((ctrl.desiredSize ?? 0) < -4_000_000) { stop(); try { ctrl.close(); } catch { /* gone */ } return; }
          try { ctrl.enqueue(new Uint8Array(chunk)); } catch { /* the client has gone */ }
        }, () => { try { ctrl.close(); } catch { /* already closed */ } });
        stop = h.stop;
      },
      cancel() { stop(); },
    });
    return new Response(body, { headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', 'Accept-Ranges': 'none' } });
  });
  app.post('/api/soloist/install', async (c) => { try { await soloist.install(); return c.json(await soloist.status()); } catch (e) { return c.json({ error: (e as Error).message }, 502); } });
  app.post('/api/soloist/start', async (c) => { try { soloist.start(); return c.json(await soloist.status()); } catch (e) { return c.json({ error: (e as Error).message }, 400); } });
  app.post('/api/soloist/stop', async (c) => { await soloist.stop(); return c.json(await soloist.status()); });
  app.delete('/api/soloist', async (c) => { soloist.uninstall(); return c.json(await soloist.status()); });

  // ---- Spotify (spotify.ts): links, public playlists, and the user's own sign-in for their playlists ----
  const spotifyFail = (e: unknown) => { if (e instanceof SpotifyError) return c_json(e); throw e; };
  const c_json = (e: SpotifyError) => new Response(JSON.stringify({ error: e.message }), { status: e.status, headers: { 'content-type': 'application/json' } });
  app.get('/api/spotify/status', (c) => c.json(spotify.status()));
  app.post('/api/spotify/config', async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { clientId?: unknown; redirectUri?: unknown };
    try { spotify.configure(String(b.clientId ?? ''), typeof b.redirectUri === 'string' && b.redirectUri ? b.redirectUri : undefined); return c.json(spotify.status()); } catch (e) { return spotifyFail(e); }
  });
  app.get('/api/spotify/auth-url', (c) => { try { return c.json({ url: spotify.authUrl({ streaming: c.req.query('streaming') === '1', write: c.req.query('write') === '1' }) }); } catch (e) { return spotifyFail(e); } });
  app.post('/api/spotify/exchange', async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { url?: unknown };
    try { await spotify.exchange(String(b.url ?? '')); return c.json(spotify.status()); } catch (e) { return spotifyFail(e); }
  });
  app.get('/api/spotify/callback', async (c) => {
    try { await spotify.exchange(c.req.url); return c.html('<!doctype html><meta charset="utf-8"><title>TurboMusic</title><body style="font-family:system-ui;padding:2rem"><h2>Connected to Spotify</h2><p>You can close this tab and go back to TurboMusic.</p>'); }
    catch (e) { return c.html(`<!doctype html><meta charset="utf-8"><title>TurboMusic</title><body style="font-family:system-ui;padding:2rem"><h2>Could not connect</h2><p>${String((e as Error).message).replace(/[<&]/g, ' ')}</p>`, 400); }
  });
  // playback: Spotify plays, TurboMusic sends commands (the web API; Soloist on the Pi is just one more device in this list)
  app.get('/api/spotify/diagnose', async (c) => { try { return c.json(await spotify.diagnose()); } catch (e) { return spotifyFail(e); } });
  app.get('/api/spotify/sdk-token', async (c) => { try { return c.json(await spotify.sdkToken()); } catch (e) { return spotifyFail(e); } });
  app.get('/api/spotify/player/devices', async (c) => { try { return c.json({ devices: await spotify.devices() }); } catch (e) { return spotifyFail(e); } });
  app.get('/api/spotify/player/state', async (c) => { try { return c.json({ state: await spotify.playerState() }); } catch (e) { return spotifyFail(e); } });
  app.post('/api/spotify/player/play', async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { uris?: unknown; deviceId?: unknown; positionMs?: unknown };
    const uris = (Array.isArray(b.uris) ? b.uris : []).filter((u): u is string => typeof u === 'string' && /^spotify:track:[A-Za-z0-9]{22}$/.test(u));
    if (!uris.length) return c.json({ error: 'no Spotify tracks to play' }, 400);
    try { await spotify.play({ uris, deviceId: typeof b.deviceId === 'string' && b.deviceId ? b.deviceId : undefined, positionMs: typeof b.positionMs === 'number' ? b.positionMs : undefined }); return c.json({ ok: true }); } catch (e) { return spotifyFail(e); }
  });
  app.post('/api/spotify/player/command', async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { type?: unknown; deviceId?: unknown; value?: unknown };
    const types = ['pause', 'resume', 'next', 'previous', 'seek', 'volume', 'shuffle', 'queue', 'transfer'] as const;
    const type = types.find((t) => t === b.type);
    if (!type) return c.json({ error: 'unknown command' }, 400);
    try { await spotify.command({ type, deviceId: typeof b.deviceId === 'string' && b.deviceId ? b.deviceId : undefined, value: b.value as number | boolean | string | undefined }); return c.json({ ok: true }); } catch (e) { return spotifyFail(e); }
  });
  app.get('/api/spotify/search', async (c) => {
    const q = (c.req.query('q') ?? '').trim().slice(0, 200);
    if (!q) return c.json({ error: 'empty search' }, 400);
    try { return c.json({ tracks: await spotify.search(q) }); } catch (e) { return spotifyFail(e); }
  });
  app.get('/api/recommend/similar', async (c) => {
    const artist = (c.req.query('artist') ?? '').trim().slice(0, 120);
    if (!artist) return c.json({ error: 'artist missing' }, 400);
    return c.json({ artists: await similarArtists(artist) });
  });
  app.post('/api/spotify/signout', (c) => { spotify.signOut(); return c.json(spotify.status()); });
  app.get('/api/spotify/playlists', async (c) => { try { return c.json({ playlists: await spotify.playlists() }); } catch (e) { return spotifyFail(e); } });
  app.get('/api/spotify/playlist/:id', async (c) => {
    const id = c.req.param('id');
    if (!/^[A-Za-z0-9]{22}$/.test(id)) return c.json({ error: 'bad playlist id' }, 400);
    try { return c.json(await spotify.playlist(id)); } catch (e) { return spotifyFail(e); }
  });
  // synced playlists: make one on the account, or make one hold exactly these tracks (needs the "change my playlists" permission)
  const trackUris = (v: unknown) => (Array.isArray(v) ? v : []).filter((u): u is string => typeof u === 'string' && /^spotify:track:[A-Za-z0-9]{22}$/.test(u)).slice(0, 5000);
  app.post('/api/spotify/playlists', async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { name?: unknown; description?: unknown; uris?: unknown };
    const name = typeof b.name === 'string' ? b.name.trim().slice(0, 100) : '';
    if (!name) return c.json({ error: 'name missing' }, 400);
    try {
      const made = await spotify.createPlaylist(name, typeof b.description === 'string' ? b.description.slice(0, 300) : '');
      const uris = trackUris(b.uris);
      if (uris.length) await spotify.setPlaylistTracks(made.id, uris);
      return c.json(made);
    } catch (e) { return spotifyFail(e); }
  });
  app.put('/api/spotify/playlist/:id/tracks', async (c) => {
    const id = c.req.param('id');
    if (!/^[A-Za-z0-9]{22}$/.test(id)) return c.json({ error: 'bad playlist id' }, 400);
    const b = (await c.req.json().catch(() => ({}))) as { uris?: unknown };
    try { await spotify.setPlaylistTracks(id, trackUris(b.uris)); return c.json({ ok: true }); } catch (e) { return spotifyFail(e); }
  });
  app.post('/api/spotify/resolve', async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { url?: unknown };
    try { return c.json(await resolveLink(b.url, { account: spotify })); } catch (e) { return spotifyFail(e); }
  });
  app.post('/api/spotify/cover', async (c) => {
    // a track or album link -> its cover saved in the file store (what oEmbed's thumbnail is)
    const b = (await c.req.json().catch(() => ({}))) as { uri?: unknown };
    const ref = parseRef(b.uri);
    if (!ref) return c.json({ error: 'bad link' }, 400);
    try { const m = await oembed(ref); if (!m.cover) return c.json({ error: 'Spotify gave no cover' }, 404); return c.json(await importer.fetchFirstCover([m.cover])); }
    catch (e) { if (e instanceof ImportError) return c.json({ error: e.message }, e.status as 400); return spotifyFail(e); }
  });

  // Album import step 1: look up a YouTube/playlist link (metadata only) so the user can review before anything downloads.
  app.post('/api/import/preview', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { url?: unknown };
    try { return c.json(await importer.preview(body.url)); }
    catch (e) { if (e instanceof ImportError) return c.json({ error: e.message }, e.status as 400); throw e; }
  });
  // Step 2: save the suggested cover image (YouTube image hosts only) and return its file hash.
  app.post('/api/import/cover', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { url?: unknown; urls?: unknown };
    try { return c.json(await importer.fetchFirstCover(Array.isArray(body.urls) ? body.urls : [body.url])); }
    catch (e) { if (e instanceof ImportError) return c.json({ error: e.message }, e.status as 400); throw e; }
  });

  // Backups. The database (the library: records only) and the data folder (audio and images) are separate downloads and uploads.
  // `?token=` works here too, so the browser can save a download straight to disk without holding it in memory.
  const stamp = () => new Date().toISOString().slice(0, 10);
  app.get('/api/export/database', (c) => {
    const snap = databaseSnapshot(config.dataDir, store);
    const stream = readStream(snap.path);
    stream.on('close', () => rmSync(snap.path, { force: true }));
    return new Response(Readable.toWeb(stream) as unknown as ReadableStream, { headers: {
      'Content-Type': 'application/vnd.sqlite3', 'Content-Length': String(snap.size), 'Content-Disposition': `attachment; filename="turbomusic-database-${stamp()}.db"` } });
  });
  app.post('/api/import/database', async (c) => {
    const mode = c.req.query('mode') === 'replace' ? 'replace' : 'merge';
    if (!c.req.raw.body) return c.json({ error: 'empty body' }, 400);
    let path: string | undefined;
    try {
      path = await saveUpload(config.dataDir, c.req.raw.body as never, 2 * 1024 * 1024 * 1024);
      const records = readDatabaseRecords(path);
      if (mode === 'replace') return c.json({ mode, ...store.replaceWith(records), cursor: store.cursor() });
      const done = store.push(records);
      return c.json({ mode, read: records.length, applied: done.applied, cursor: done.cursor });
    } catch (e) {
      if (e instanceof BackupError) return c.json({ error: e.message }, e.status as 400 | 413);
      throw e;
    } finally { if (path) rmSync(path, { force: true }); }
  });
  app.get('/api/export/files', (c) => {
    const archive = filesArchive(config.dataDir, store);
    return new Response(Readable.toWeb(Readable.from(archive.chunks)) as unknown as ReadableStream, { headers: {
      'Content-Type': 'application/x-tar', 'Content-Length': String(archive.length), 'Content-Disposition': `attachment; filename="turbomusic-files-${stamp()}.tar"` } });
  });
  app.post('/api/import/files', async (c) => {
    if (!c.req.raw.body) return c.json({ error: 'empty body' }, 400);
    try { return c.json(await importFiles(config.dataDir, store, Readable.fromWeb(c.req.raw.body as never))); }
    catch (e) { if (e instanceof BackupError) return c.json({ error: e.message }, e.status as 400 | 413); throw e; }
  });

  // The library as people can read it: a mirror of links (Artist/Album/Title) and exports for taking it elsewhere (libraryExport.ts)
  app.get('/api/admin/mirror', (c) => c.json(mirror.status()));
  app.post('/api/admin/mirror', async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { enabled?: unknown; mode?: unknown; dir?: unknown; now?: unknown };
    try {
      mirror.configure({ ...(typeof b.enabled === 'boolean' ? { enabled: b.enabled } : {}), ...(typeof b.mode === 'string' ? { mode: b.mode as never } : {}), ...(typeof b.dir === 'string' || b.dir === null ? { dir: b.dir as string | null } : {}) });
      if (mirror.settings().enabled || b.now === true) mirror.run();
      return c.json(mirror.status());
    } catch (e) { if (e instanceof MirrorError) return c.json({ error: e.message }, 400); return c.json({ error: (e as Error).message, status: mirror.status() }, 500); }
  });
  app.get('/api/export/library', (c) => {
    const input = loadInput(store);
    const items = planLayout(input);
    const withAudio = c.req.query('audio') !== '0';
    const text = (name: string, body: string): TarEntry => ({ name, size: Buffer.byteLength(body), data: Buffer.from(body) });
    const entries: TarEntry[] = [text('README.txt', README), text('tracks.csv', tracksCsv(store, input, items)), text('library.json', libraryJson(store, RECORD_TABLES as never)), ...playlistFiles(input, items).map((p) => text(`Playlists/${p.name}`, p.text))];
    if (withAudio) {
      for (const it of items) { const p = filePath(config.dataDir, it.hash); if (existsSync(p)) entries.push({ name: `Music/${it.path}`, size: statSync(p).size, path: p }); }
      // one cover.jpg beside each album's songs
      const done = new Set<string>();
      for (const it of items) {
        if (!it.album) continue;
        const dir = it.path.slice(0, it.path.lastIndexOf('/'));
        if (done.has(dir)) continue;
        done.add(dir);
        const album = input.albums.find((a) => a.data.title === it.album);
        const rel = input.releases.find((r) => r.id === album?.data.defaultReleaseId) ?? input.releases.find((r) => r.data.albumId === album?.id && r.data.cover);
        const hash = (album?.data.coverPicked ? album.data.cover : undefined) ?? rel?.data.cover ?? album?.data.cover;
        const p = hash ? filePath(config.dataDir, hash) : '';
        if (p && existsSync(p)) entries.push({ name: `Music/${dir}/cover.jpg`, size: statSync(p).size, path: p });
      }
    }
    return new Response(Readable.toWeb(Readable.from(tarChunks(entries))) as unknown as ReadableStream, { headers: {
      'Content-Type': 'application/x-tar', 'Content-Length': String(tarLength(entries)), 'Content-Disposition': `attachment; filename="turbomusic-library-${withAudio ? 'with-audio-' : ''}${stamp()}.tar"` } });
  });
  app.get('/api/export/data', (c) => {
    const csv = c.req.query('format') === 'csv';
    const body = csv ? (() => { const input = loadInput(store); return tracksCsv(store, input, planLayout(input)); })() : libraryJson(store, RECORD_TABLES as never);
    return new Response(body, { headers: { 'Content-Type': csv ? 'text/csv; charset=utf-8' : 'application/json', 'Content-Disposition': `attachment; filename="turbomusic-${csv ? 'tracks' : 'library'}-${stamp()}.${csv ? 'csv' : 'json'}"` } });
  });

  app.get('/api/files', (c) => c.json(store.listFiles()));

  app.on('HEAD', '/api/files/:hash', (c) => {
    const info = sha256Hex.test(c.req.param('hash')) ? store.fileInfo(c.req.param('hash')) : undefined;
    return info ? new Response(null, { status: 200, headers: { 'Content-Length': String(info.size), 'Content-Type': info.mime } }) : c.body(null, 404);
  });

  app.put('/api/files/:hash', async (c) => {
    const hash = c.req.param('hash');
    if (!sha256Hex.test(hash)) return c.json({ error: 'hash must be lowercase sha256 hex' }, 400);
    if (store.hasFile(hash)) return c.json({ ok: true, existed: true });
    if (!c.req.raw.body) return c.json({ error: 'empty body' }, 400);
    const declared = Number(c.req.header('Content-Length'));
    if (declared > config.maxUploadBytes) return c.json({ error: 'File too large' }, 413);
    try {
      const size = await saveVerified(config.dataDir, hash, c.req.raw.body as never, config.maxUploadBytes);
      store.addFile(hash, size, c.req.header('Content-Type') ?? 'application/octet-stream');
      return c.json({ ok: true, existed: false, size });
    } catch (e) {
      if (e instanceof UploadError) return c.json({ error: e.message }, e.status as 413 | 422);
      throw e;
    }
  });

  app.get('/api/files/:hash', (c) => {
    const hash = c.req.param('hash');
    const info = sha256Hex.test(hash) ? store.fileInfo(hash) : undefined;
    const path = info && filePath(config.dataDir, hash);
    if (!info || !path || !existsSync(path)) return c.json({ error: 'not found' }, 404);

    const headers: Record<string, string> = {
      'Content-Type': info.mime, 'Accept-Ranges': 'bytes',
      // content-addressed => the bytes can never change
      'Cache-Control': 'public, max-age=31536000, immutable', ETag: `"${hash}"`,
    };
    const range = parseRange(c.req.header('Range'), info.size);
    if (range === 'invalid') return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${info.size}` } });
    if (range) {
      return new Response(streamFile(path, range), {
        status: 206,
        headers: { ...headers, 'Content-Length': String(range.end - range.start + 1), 'Content-Range': `bytes ${range.start}-${range.end}/${info.size}` },
      });
    }
    return new Response(streamFile(path), { status: 200, headers: { ...headers, 'Content-Length': String(info.size) } });
  });

  if (config.webDir) serveWeb(app, config.webDir);

  app.notFound((c) => c.json({ error: 'not found' }, 404));
  app.onError((e, c) => {
    console.error(e);
    return c.json({ error: 'internal error' }, 500);
  });
  return app;
}
