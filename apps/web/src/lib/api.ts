import type { Command, PlaybackSnapshot, PullResponse, SyncRecord } from '@turbomusic/core';
import type { DeviceSettings } from './settings.ts';

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export interface ServerStatus {
  apiVersion: number; cursor: number;
  files: { count: number; bytes: number };
  disk: { free: number; total: number } | Record<string, number>;
  /** versions of the programs YouTube import needs, null when the server cannot run them */
  tools?: { ytdlp: string | null; ffmpeg: string | null; /** a cookies file is configured for yt-dlp */ cookies?: boolean };
}

/** "Update server": the server pulls the newest code, rebuilds the web client and restarts itself (only on a service install of the checkout). */
export interface ServerUpdate {
  available: boolean; restarts: boolean;
  status: 'idle' | 'running' | 'done' | 'error'; log: string[]; restarting: boolean;
}

/** What GET /api/admin/health returns (packages/server/src/health.ts): a cheap look at the machine the server runs on. */
export interface ServerHealth {
  snapshot: {
    at: number; host: string; platform: string; arch: string; node: string; uptimeS: number; processUptimeS: number;
    cpu: { cores: number; load1: number; load5: number; load15: number };
    memory: { totalBytes: number; availableBytes: number; rssBytes: number };
    swap: { totalBytes: number; usedBytes: number } | null;
    tempC: number | null;
    throttle: { underVoltage: boolean; frequencyCapped: boolean; throttled: boolean; underVoltageEver: boolean } | null;
    disks: { label: string; path: string; freeBytes: number; totalBytes: number; system: boolean }[];
    probe: { writeMs: number; readMs: number } | null;
    db: { bytes: number; walBytes: number };
  };
  warnings: { level: 'warn' | 'bad'; id: string; message: string }[];
}
export interface StorageEntry { kind: 'files' | 'tmp' | 'cache'; label: string; hint: string; link: string; path: string; moved: boolean; freeBytes: number; totalBytes: number; system: boolean }
export interface StorageInfo {
  entries: StorageEntry[]; dataDir: string;
  job: { status: 'idle' | 'running' | 'done' | 'error'; kind?: StorageEntry['kind']; message?: string; progress?: { phase: string; copiedBytes: number; totalBytes: number; files: number } };
}

export interface ImportPreview {
  title: string; artist: string; thumbnail: string | null;
  /** every cover candidate, best first */
  thumbnails?: string[];
  /** when the album came out, if an exact match was found online */
  releaseDate?: string | null;
  entries: { id: string; title: string; rawTitle: string; url: string; duration: number | null }[];
}

/** The headers a server behind Cloudflare Access wants on every request (blank when no service token is set). */
export const accessHeaders = (s: Partial<Pick<DeviceSettings, 'cfAccessId' | 'cfAccessSecret'>>): Record<string, string> =>
  s.cfAccessId?.trim() && s.cfAccessSecret?.trim() ? { 'CF-Access-Client-Id': s.cfAccessId.trim(), 'CF-Access-Client-Secret': s.cfAccessSecret.trim() } : {};

export class Api {
  constructor(private s: Pick<DeviceSettings, 'serverUrl' | 'token'> & Partial<Pick<DeviceSettings, 'cfAccessId' | 'cfAccessSecret'>>) {}

  /** the service-token headers, for the few callers that fetch a server link themselves */
  get access() { return accessHeaders(this.s); }
  /** true when the server is another origin than this page, so a service token cannot ride on a cookie and `<img>`/`<audio>` links would be refused */
  get needsHeaderFetch() {
    if (!Object.keys(this.access).length) return false;
    // the desktop app puts the token on the requests itself (apps/electron/src/accessHeaders.ts): links work, and audio streams
    if (typeof window !== 'undefined' && (window as unknown as { turbomusicDesktop?: { setAccess?: unknown } }).turbomusicDesktop?.setAccess) return false;
    // the Android app does the same for the page's GET requests (AccessProxy.kt)
    try { if (typeof window !== 'undefined' && (window as unknown as { TurboMusicAndroid?: { accessInjected?: () => boolean } }).TurboMusicAndroid?.accessInjected?.()) return false; } catch { /* old app */ }
    try { return !!this.s.serverUrl && new URL(this.s.serverUrl, location.href).origin !== location.origin; } catch { return true; }
  }
  /** fetch a server link with the service token (and, same-origin, keep the cookie Access answers with) */
  fetchLink(url: string, init: RequestInit = {}) { return fetch(url, { ...init, headers: { ...this.access, ...(init.headers as Record<string, string> | undefined) } }); }

  private url(path: string) { return `${this.s.serverUrl.replace(/\/+$/, '')}${path}`; }

  private async req<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(this.url(path), {
      ...init,
      headers: { ...this.access, Authorization: `Bearer ${this.s.token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
    });
    if (!res.ok) {
      const detail = res.status === 401 ? 'Wrong token' : ((await res.json().catch(() => null)) as { error?: string } | null)?.error;
      throw new ApiError(res.status, detail ?? `Server said ${res.status}`);
    }
    return res.json() as Promise<T>;
  }

  health() { return fetch(this.url('/api/health'), { headers: this.access }).then((r) => (r.ok ? r.json() : Promise.reject(new ApiError(r.status, 'No server')))); }
  status() { return this.req<ServerStatus>('/api/status'); }
  releaseDates(albums: { id: string; album: string; artist: string }[]) { return this.req<{ results: { id: string; answer: DateAnswerRes | null }[] }>('/api/dates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ albums }) }); }
  artistImages(artists: { id: string; name: string; aliases?: string[] }[]) { return this.req<{ results: { id: string; hash: string | null; source: string | null; matched: string | null }[] }>('/api/artist-images', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ artists }) }); }
  albumGenres(albums: { id: string; album: string; artist: string }[]) { return this.req<{ results: { id: string; genres: { name: string; source: 'itunes' | 'musicbrainz' }[] }[] }>('/api/album-genres', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ albums }) }); }
  soloist() { return this.req<SoloistInfo>('/api/soloist'); }
  soloistConfig(c: { deviceName?: string; apiKey?: string; autoStart?: boolean; outputDevice?: string; beam?: boolean }) { return this.req<SoloistInfo>('/api/soloist/config', { method: 'POST', body: JSON.stringify(c) }); }
  soloistInstall() { return this.req<SoloistInfo>('/api/soloist/install', { method: 'POST' }); }
  soloistStart() { return this.req<SoloistInfo>('/api/soloist/start', { method: 'POST' }); }
  soloistStop() { return this.req<SoloistInfo>('/api/soloist/stop', { method: 'POST' }); }
  soloistRemove() { return this.req<SoloistInfo>('/api/soloist', { method: 'DELETE' }); }
  serverHealth() { return this.req<ServerHealth>('/api/admin/health'); }
  storageInfo() { return this.req<StorageInfo>('/api/admin/storage'); }
  moveStorage(kind: StorageEntry['kind'], target: string) { return this.req<{ ok: true }>('/api/admin/storage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, target }) }); }
  updateInfo() { return this.req<ServerUpdate>('/api/admin/update'); }
  startUpdate() { return this.req<{ ok: true }>('/api/admin/update', { method: 'POST' }); }
  pull(since: number, limit = 1000) { return this.req<PullResponse>(`/api/sync/pull?since=${since}&limit=${limit}`); }
  push(records: SyncRecord[]) {
    return this.req<{ applied: number; cursor: number }>('/api/sync/push', { method: 'POST', body: JSON.stringify({ records }) });
  }
  async putFile(hash: string, blob: Blob) {
    const res = await fetch(this.url(`/api/files/${hash}`), { method: 'PUT', headers: { ...this.access, Authorization: `Bearer ${this.s.token}`, 'Content-Type': blob.type || 'application/octet-stream' }, body: blob });
    if (!res.ok) throw new ApiError(res.status, `Upload failed (${res.status})`);
  }
  importPreview(url: string) {
    return this.req<ImportPreview>('/api/import/preview', { method: 'POST', body: JSON.stringify({ url }) });
  }
  /** the server tries the links in order and keeps the first image that downloads */
  importCover(urls: string | string[]) { return this.req<{ hash: string; url: string }>('/api/import/cover', { method: 'POST', body: JSON.stringify(Array.isArray(urls) ? { urls } : { url: urls }) }); }
  analyzeAudio(hash: string) { return this.req<{ codec: string; kbps: number; sampleRate: number; durationSec: number; cutoffHz: number; looksLike: number; verdict: 'ok' | 'transcode' | 'unknown' }>('/api/audio/analyze', { method: 'POST', body: JSON.stringify({ hash }) }); }
  // ---- Spotify (server/src/spotify.ts) and YouTube matching (match.ts) ----
  spotifyStatus() { return this.req<{ clientId: string; redirectUri: string; signedIn: boolean; streaming?: boolean; canWrite?: boolean; configured: boolean }>('/api/spotify/status'); }
  spotifyDiagnose() { return this.req<SpotifyDiagnosis>('/api/spotify/diagnose'); }
  spotifySdkToken() { return this.req<{ token: string; expiresInMs: number }>('/api/spotify/sdk-token'); }
  spotifyConfig(clientId: string, redirectUri?: string) { return this.req<{ clientId: string; redirectUri: string; signedIn: boolean; configured: boolean }>('/api/spotify/config', { method: 'POST', body: JSON.stringify({ clientId, redirectUri }) }); }
  spotifyAuthUrl(streaming = false, write = false) { return this.req<{ url: string }>(`/api/spotify/auth-url?${[streaming && 'streaming=1', write && 'write=1'].filter(Boolean).join('&')}`); }
  spotifyCreatePlaylist(name: string, description: string, uris: string[]) { return this.req<{ id: string; url: string }>('/api/spotify/playlists', { method: 'POST', body: JSON.stringify({ name, description, uris }) }); }
  spotifySetPlaylistTracks(id: string, uris: string[]) { return this.req<{ ok: true }>(`/api/spotify/playlist/${id}/tracks`, { method: 'PUT', body: JSON.stringify({ uris }) }); }
  spotifyExchange(url: string) { return this.req<{ signedIn: boolean }>('/api/spotify/exchange', { method: 'POST', body: JSON.stringify({ url }) }); }
  spotifySignOut() { return this.req<{ signedIn: boolean }>('/api/spotify/signout', { method: 'POST' }); }
  spotifyPlaylists() { return this.req<{ playlists: { id: string; name: string; tracks: number | null; owner: string; cover: string | null; mine: boolean }[] }>('/api/spotify/playlists'); }
  spotifyPlaylist(id: string) { return this.req<SpotifyList>(`/api/spotify/playlist/${id}`); }
  spotifyResolve(url: string) { return this.req<SpotifyList>('/api/spotify/resolve', { method: 'POST', body: JSON.stringify({ url }) }); }
  spotifyCover(uri: string) { return this.req<{ hash: string; url: string }>('/api/spotify/cover', { method: 'POST', body: JSON.stringify({ uri }) }); }
  lyrics(q: { artist: string; title: string; album?: string; duration?: number }) {
    const p = new URLSearchParams({ artist: q.artist, title: q.title, ...(q.album ? { album: q.album } : {}), ...(q.duration ? { duration: String(Math.round(q.duration)) } : {}) });
    return this.req<{ lyrics: { synced: string | null; plain: string | null; instrumental: boolean; source: string } | null }>(`/api/lyrics?${p}`);
  }
  matchAlbums(albums: MatchAlbumReq[]) { return this.req<{ results: MatchResultRes[] }>('/api/match-album', { method: 'POST', body: JSON.stringify({ albums }) }); }
  spotifyDevices() { return this.req<{ devices: SpotifyDeviceInfo[] }>('/api/spotify/player/devices'); }
  spotifyPlayerState() { return this.req<{ state: SpotifyPlayerInfo | null }>('/api/spotify/player/state'); }
  spotifyPlay(uris: string[], deviceId: string, positionMs = 0) { return this.req<{ ok: true }>('/api/spotify/player/play', { method: 'POST', body: JSON.stringify({ uris, deviceId, positionMs }) }); }
  spotifyCommand(type: 'pause' | 'resume' | 'next' | 'previous' | 'seek' | 'volume' | 'shuffle' | 'queue' | 'transfer', deviceId: string, value?: number | boolean | string) { return this.req<{ ok: true }>('/api/spotify/player/command', { method: 'POST', body: JSON.stringify({ type, deviceId, value }) }); }
  spotifySearch(q: string) { return this.req<{ tracks: SpotifyImportTrack[] }>(`/api/spotify/search?q=${encodeURIComponent(q)}`); }
  similarArtists(artist: string) { return this.req<{ artists: { name: string; mbid: string; score: number }[] }>(`/api/recommend/similar?artist=${encodeURIComponent(artist)}`); }
  acquire(trackIds?: string[]) { return this.req<{ queued: number }>('/api/acquire', { method: 'POST', body: JSON.stringify({ trackIds }) }); }
  acquireStatus() {
    return this.req<{ queued: number; running: number; done: number; failed: number; failures: { trackId: string; error: string; dead?: boolean }[]; active?: { trackId: string; stage: 'downloading' | 'converting'; percent: number }[] }>('/api/acquire');
  }
  /** direct download links (the browser saves them to disk without holding them in memory) */
  exportUrl(what: 'database' | 'files') { return this.url(`/api/export/${what}?token=${encodeURIComponent(this.s.token)}`); }
  /** the readable library: `?audio=0` leaves the songs out; `data` is the JSON or CSV */
  libraryExportUrl(audio: boolean) { return this.url(`/api/export/library?${audio ? '' : 'audio=0&'}token=${encodeURIComponent(this.s.token)}`); }
  dataExportUrl(format: 'json' | 'csv') { return this.url(`/api/export/data?format=${format}&token=${encodeURIComponent(this.s.token)}`); }
  mirrorStatus() { return this.req<MirrorInfo>('/api/admin/mirror'); }
  mirrorSet(body: { enabled?: boolean; mode?: string; dir?: string | null; now?: boolean }) { return this.req<MirrorInfo>('/api/admin/mirror', { method: 'POST', body: JSON.stringify(body) }); }
  importDatabase(file: Blob, mode: 'merge' | 'replace') {
    return this.req<{ mode: string; read?: number; applied?: number; written?: number; removed?: number }>(`/api/import/database?mode=${mode}`, { method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream' } });
  }
  importFiles(file: Blob) {
    return this.req<{ added: number; existed: number; corrupt: number; ignored: number; bytes: number }>('/api/import/files', { method: 'POST', body: file, headers: { 'Content-Type': 'application/x-tar' } });
  }
  /** Connect: an event stream per device (EventSource cannot send headers, hence ?token=) */
  connectStreamUrl(device: string, name: string, kind: string) {
    return this.url(`/api/connect/stream?device=${encodeURIComponent(device)}&name=${encodeURIComponent(name)}&kind=${kind}&token=${encodeURIComponent(this.s.token)}`);
  }
  connectState(device: string, name: string, state: PlaybackSnapshot | null) { return this.req<{ ok: true }>('/api/connect/state', { method: 'POST', body: JSON.stringify({ device, name, state }) }); }
  connectCommand(from: string, to: string, command: Command) { return this.req<{ ok: true }>('/api/connect/command', { method: 'POST', body: JSON.stringify({ from, to, command }) }); }
  /** `<audio src>` / `<img src>` cannot send headers, hence ?token= */
  /** the live stream of the server's Soloist (server/src/beam.ts); plays like internet radio */
  beamUrl() { return this.url(`/api/soloist/stream?token=${encodeURIComponent(this.s.token)}`); }
  fileUrl(hash: string) { return this.url(`/api/files/${hash}?token=${encodeURIComponent(this.s.token)}`); }
}

export interface MirrorInfo { enabled: boolean; mode: 'symlink' | 'hardlink' | 'copy'; dir: string | null; defaultDir: string; effectiveDir: string; last: { linked: number; removed: number; skipped: number; at: number } | null; error: string | null; running: boolean }
export interface SpotifyImportTrack { uri: string; id: string; title: string; artists: string[]; album: string; albumUri: string | null; albumArtist: string | null; durationMs: number | null; cover: string | null; releaseDate: string | null; trackNumber: number | null; isrc: string | null }
export interface SpotifyList { kind: 'playlist' | 'album' | 'track'; name: string; description: string | null; cover: string | null; owner: string | null; tracks: SpotifyImportTrack[]; source: 'embed' | 'api' | 'oembed' | 'file'; note?: string }
export interface MatchAlbumReq { id: string; title: string; artist: string; trackCount?: number | null }
export interface MatchCandidate { url: string; title: string; channel: string; count: number | null; score: number; owner?: string; thumbnail?: string; coverHash?: string; edition?: string }
export interface DateAnswerRes { date: string; source: 'spotify' | 'itunes' | 'musicbrainz' }
export interface MatchResultRes { id: string; candidates: MatchCandidate[]; error?: string }

export interface SoloistInfo {
  supported: boolean; reason?: string; installed: boolean; version: string | null; configured: boolean; deviceName: string; hasKey: boolean; autoStart: boolean; outputDevice: string;
  /** the machine Soloist runs on (the server) */
  host: { name: string; model: string | null; isPi: boolean };
  audio: { ok: boolean; server: 'pipewire' | 'pulseaudio' | null; runtimeDir: string | null; hint: string | null };
  beam: { enabled: boolean; sink: 'ready' | 'missing' | 'error' | 'unchecked'; sinkMessage: string | null; streamPath: string; listeners: number; running: boolean; error: string | null; bytes: number };
  running: boolean; state: 'stopped' | 'starting' | 'running' | 'expired' | 'installing' | 'error'; message: string | null; log: string[]; downloadsUrl: string;
}
export interface SpotifyDiagnosis { signedIn: boolean; permissions: string[]; clientIdStart: string; refresh?: string; me?: { status: number; product?: string | null; country?: string | null; body?: string }; devices?: { status: number; devices?: string[]; body?: string } }
export interface SpotifyDeviceInfo { id: string; name: string; type: string; active: boolean; volume: number | null; /** Spotify accepts no commands from other apps for this device */ restricted?: boolean }
export interface SpotifyPlayerInfo { playing: boolean; progressMs: number; shuffle: boolean; device: { id: string; name: string; volume: number | null }; track: { uri: string; id: string; title: string; artists: string[]; album: string; cover: string | null; durationMs: number } | null }
