import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Everything TurboMusic can ask Spotify, in separate sources so one breaking does not take the others down:
 *  - oEmbed (open.spotify.com/oembed): title and cover of a track, album or playlist link. Public, no key.
 *  - the public embed page of a playlist (open.spotify.com/embed/playlist/<id>): the track list, no key. UNOFFICIAL: Spotify can change it.
 *  - the Web API with the user's own sign-in (Authorization Code + PKCE, a client id from their own developer app): their playlists with
 *    full details (album, duration). Since Feb 2026, in Development Mode, playlist contents are only returned for playlists the user owns
 *    or collaborates on, so this is for "my playlists"; other people's go through the embed page.
 *  The account's own data export (Playlist1.json) is read in the browser and never reaches this file.
 */
export type SpotifyKind = 'track' | 'album' | 'artist' | 'playlist' | 'episode' | 'show';
export interface SpotifyRef { kind: SpotifyKind; id: string }

export function parseRef(input: unknown): SpotifyRef | null {
  if (typeof input !== 'string') return null;
  const m = /(?:spotify\.com\/(?:intl-[a-z]{2}\/)?(?:embed\/)?|spotify:)(track|album|artist|playlist|episode|show)[/:]([A-Za-z0-9]{22})/.exec(input.trim().split('?')[0].split('#')[0]);
  return m ? { kind: m[1] as SpotifyKind, id: m[2] } : null;
}

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#x27;': "'", '&apos;': "'", '&#x2F;': '/', '&nbsp;': ' ' };
/** Spotify's oEmbed HTML-encodes titles (&amp;, &#x27;, …). */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, g: string) => {
    if (ENTITIES[m]) return ENTITIES[m];
    const n = g[0] === '#' ? (g[1].toLowerCase() === 'x' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10)) : NaN;
    return Number.isFinite(n) ? String.fromCodePoint(n) : m;
  });
}

export interface SpotifyTrack {
  uri: string; id: string; title: string; artists: string[]; album: string; albumUri: string | null; albumArtist: string | null;
  durationMs: number | null; cover: string | null; releaseDate: string | null; trackNumber: number | null; isrc: string | null;
}
export interface SpotifyList { kind: 'playlist' | 'album' | 'track'; name: string; description: string | null; cover: string | null; owner: string | null; tracks: SpotifyTrack[]; source: 'embed' | 'api' | 'oembed'; note?: string }

/** `restricted`: Spotify says this device accepts no commands from other apps (Echo and other smart speakers are sometimes reported so); it is listed so it is not mistaken for a missing one */
export interface SpotifyDevice { id: string; name: string; type: string; active: boolean; volume: number | null; restricted: boolean }
export interface SpotifyPlayerState {
  playing: boolean; progressMs: number; shuffle: boolean; device: { id: string; name: string; volume: number | null };
  track: { uri: string; id: string; title: string; artists: string[]; album: string; cover: string | null; durationMs: number } | null;
}

export class SpotifyError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

type Fetch = typeof fetch;
const UA = 'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0';

export async function oembed(ref: SpotifyRef, f: Fetch = fetch): Promise<{ title: string; cover: string | null }> {
  let res: Response;
  try { res = await f(`https://open.spotify.com/oembed?url=${encodeURIComponent(`spotify:${ref.kind}:${ref.id}`)}`, { signal: AbortSignal.timeout(10_000) }); }
  catch (e) { throw new SpotifyError(502, `Could not reach Spotify (${(e as Error).message})`); }
  if (!res.ok) throw new SpotifyError(res.status === 404 ? 404 : 502, res.status === 404 ? 'Spotify does not know that link (is the playlist public?)' : `Spotify answered ${res.status}`);
  const j = (await res.json().catch(() => null)) as { title?: string; thumbnail_url?: string } | null;
  if (!j?.title) throw new SpotifyError(502, 'Spotify returned nothing readable');
  return { title: decodeEntities(j.title), cover: j.thumbnail_url ?? null };
}

/** Find the playlist's `trackList` in the embed page's `__NEXT_DATA__`, wherever Spotify has nested it this month. Pure; tested with a fixture. */
export function parseEmbed(html: string, id: string): SpotifyList {
  const m = /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!m) throw new SpotifyError(502, 'The Spotify page had no playlist data (Spotify may have changed it; try your account data file or sign-in instead)');
  let data: unknown;
  try { data = JSON.parse(m[1]); } catch { throw new SpotifyError(502, 'The Spotify page data was unreadable'); }
  let found: unknown = null;
  const walk = (n: unknown, depth: number) => {
    if (found || depth > 12 || !n || typeof n !== 'object') return;
    if (!Array.isArray(n) && Array.isArray((n as { trackList?: unknown }).trackList)) { found = n; return; }
    for (const v of Object.values(n as object)) walk(v, depth + 1);
  };
  walk(data, 0);
  const e = found as { trackList: { uri?: string; title?: string; subtitle?: string; duration?: number }[]; name?: string; title?: string; subtitle?: string; coverArt?: { sources?: { url: string; width?: number }[] } } | null;
  if (!e) throw new SpotifyError(502, 'The Spotify page had no track list');
  const tracks: SpotifyTrack[] = [];
  for (const t of e.trackList) {
    const ref = parseRef(t.uri ?? '');
    if (!ref || ref.kind !== 'track' || !t.title) continue;
    tracks.push({ uri: `spotify:track:${ref.id}`, id: ref.id, title: decodeEntities(String(t.title)), artists: String(t.subtitle ?? '').split(/,\s*| /).map((a) => decodeEntities(a).trim()).filter(Boolean),
      album: '', albumUri: null, albumArtist: null, durationMs: typeof t.duration === 'number' ? t.duration : null, cover: null, releaseDate: null, trackNumber: null, isrc: null });
  }
  const cover = [...(e.coverArt?.sources ?? [])].sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url ?? null;
  return { kind: 'playlist', name: decodeEntities(String(e.name ?? e.title ?? `Playlist ${id}`)), description: null, cover, owner: e.subtitle ? decodeEntities(String(e.subtitle)) : null, tracks, source: 'embed',
    note: 'The public page does not say which album a track is on; the albums are made from the track titles and can be completed later.' };
}

export async function embedPlaylist(id: string, f: Fetch = fetch): Promise<SpotifyList> {
  let res: Response;
  try { res = await f(`https://open.spotify.com/embed/playlist/${id}`, { headers: { 'User-Agent': UA, 'Accept-Language': 'en' }, signal: AbortSignal.timeout(15_000) }); }
  catch (e) { throw new SpotifyError(502, `Could not reach Spotify (${(e as Error).message})`); }
  if (res.status === 404) throw new SpotifyError(404, 'That playlist is private or does not exist');
  if (!res.ok) throw new SpotifyError(502, `Spotify answered ${res.status}`);
  return parseEmbed(await res.text(), id);
}

// ---- the user's own sign-in (Authorization Code with PKCE; no client secret) ----
export interface SpotifyAuthState {
  clientId?: string; redirectUri?: string;
  pending?: { verifier: string; state: string };
  token?: { access: string; refresh: string; expiresAt: number; scope: string };
}

const SCOPES = 'playlist-read-private playlist-read-collaborative user-library-read user-read-playback-state user-modify-playback-state user-read-currently-playing';
/** only asked for when the in-app player is wanted (Web Playback SDK): a plain sign-in keeps the permissions it always had */
const STREAMING_SCOPES = 'streaming user-read-email user-read-private';
/** only asked for when playlists are to be changed on Spotify (synced playlists): a plain sign-in stays read-only */
const WRITE_SCOPES = 'playlist-modify-public playlist-modify-private';
export const DEFAULT_REDIRECT = 'http://127.0.0.1:47813/api/spotify/callback';
const b64url = (b: Buffer) => b.toString('base64url');

export class SpotifyAccount {
  private file: string;
  private f: Fetch;
  private now: () => number;
  constructor(dataDir: string, o: { fetchImpl?: Fetch; now?: () => number; env?: NodeJS.ProcessEnv } = {}) {
    this.file = join(dataDir, 'spotify.json'); this.f = o.fetchImpl ?? fetch; this.now = o.now ?? Date.now;
    this.envClient = o.env?.TURBOMUSIC_SPOTIFY_CLIENT_ID;
  }
  private envClient?: string;
  private load(): SpotifyAuthState { try { return JSON.parse(readFileSync(this.file, 'utf8')) as SpotifyAuthState; } catch { return {}; } }
  private save(s: SpotifyAuthState) { mkdirSync(dirname(this.file), { recursive: true }); writeFileSync(this.file, JSON.stringify(s, null, 2), { mode: 0o600 }); }

  status() { const s = this.load(); return { clientId: this.envClient || s.clientId || '', redirectUri: s.redirectUri || DEFAULT_REDIRECT, signedIn: !!s.token, streaming: !!(s.token?.scope ?? '').split(' ').includes('streaming'), canWrite: (s.token?.scope ?? '').split(' ').includes('playlist-modify-private'), configured: !!(this.envClient || s.clientId) }; }
  configure(clientId: string, redirectUri?: string) {
    if (!/^[0-9a-f]{32}$/i.test(clientId.trim())) throw new SpotifyError(400, 'A Spotify client id is 32 letters and digits (from your app on developer.spotify.com/dashboard)');
    const s = this.load(); s.clientId = clientId.trim(); if (redirectUri) s.redirectUri = redirectUri.trim(); this.save(s);
  }
  signOut() { const s = this.load(); delete s.token; delete s.pending; this.save(s); }

  /** Step 1: the page the user opens to allow TurboMusic to read their playlists. */
  authUrl(opts: { streaming?: boolean; write?: boolean } = {}): string {
    const s = this.load(); const clientId = this.envClient || s.clientId;
    if (!clientId) throw new SpotifyError(400, 'Enter your Spotify client id first');
    const verifier = b64url(randomBytes(48)), state = b64url(randomBytes(12));
    s.pending = { verifier, state }; this.save(s);
    const q = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: s.redirectUri || DEFAULT_REDIRECT, scope: [SCOPES, ...(opts.streaming ? [STREAMING_SCOPES] : []), ...(opts.write ? [WRITE_SCOPES] : [])].join(' '), state, code_challenge_method: 'S256', code_challenge: b64url(createHash('sha256').update(verifier).digest()) });
    return `https://accounts.spotify.com/authorize?${q}`;
  }
  /** Step 2: Spotify sent the browser to `redirectUri?code=…&state=…`; give that address (or just the code) here. Works even if the page itself did not load. */
  async exchange(codeOrUrl: string): Promise<void> {
    const s = this.load();
    if (!s.pending) throw new SpotifyError(400, 'Start the sign-in again (there is no sign-in in progress)');
    let code = codeOrUrl.trim();
    try { const u = new URL(code); if (u.searchParams.get('error')) throw new SpotifyError(400, `Spotify said: ${u.searchParams.get('error')}`); const st = u.searchParams.get('state'); if (st && st !== s.pending.state) throw new SpotifyError(400, 'That address belongs to a different sign-in. Start again.'); code = u.searchParams.get('code') ?? ''; }
    catch (e) { if (e instanceof SpotifyError) throw e; }
    if (!code) throw new SpotifyError(400, 'No code found in that address');
    await this.token({ grant_type: 'authorization_code', code, redirect_uri: s.redirectUri || DEFAULT_REDIRECT, code_verifier: s.pending.verifier });
  }
  private async token(body: Record<string, string>): Promise<void> {
    const s = this.load(); const clientId = this.envClient || s.clientId;
    let res: Response;
    try { res = await this.f('https://accounts.spotify.com/api/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...body, client_id: clientId ?? '' }), signal: AbortSignal.timeout(15_000) }); }
    catch (e) { throw new SpotifyError(502, `Could not reach Spotify (${(e as Error).message})`); }
    const j = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error_description?: string; error?: string };
    if (!res.ok || !j.access_token) throw new SpotifyError(res.status === 400 ? 400 : 502, `Spotify refused the sign-in: ${j.error_description ?? j.error ?? res.status}`);
    s.token = { access: j.access_token, refresh: j.refresh_token ?? s.token?.refresh ?? '', expiresAt: this.now() + (j.expires_in ?? 3600) * 1000 - 60_000, scope: j.scope ?? '' };
    delete s.pending; this.save(s);
  }
  private async access(): Promise<string> {
    const s = this.load();
    if (!s.token) throw new SpotifyError(401, 'Not signed in to Spotify');
    if (this.now() >= s.token.expiresAt) { if (!s.token.refresh) throw new SpotifyError(401, 'The Spotify sign-in expired; sign in again'); await this.token({ grant_type: 'refresh_token', refresh_token: s.token.refresh }); }
    return this.load().token!.access;
  }
  /**
   * What Spotify says about this sign-in, for the "Check the connection" button: the permissions the saved token holds and the raw answers
   * of the calls TurboMusic depends on. Never returns the token itself.
   */
  async diagnose(): Promise<Record<string, unknown>> {
    const s = this.load();
    const out: Record<string, unknown> = { signedIn: !!s.token, permissions: s.token?.scope ? s.token.scope.split(' ') : [], clientIdStart: (this.envClient || s.clientId || '').slice(0, 6) };
    if (!s.token) return out;
    let access: string;
    try { access = await this.access(); } catch (e) { out.refresh = (e as Error).message; return out; }
    const probe = async (path: string) => {
      try {
        const r = await this.f(`https://api.spotify.com/v1${path}`, { headers: { Authorization: `Bearer ${access}` }, signal: AbortSignal.timeout(15_000) });
        const text = await r.text().catch(() => '');
        if (!r.ok) return { status: r.status, body: text.replace(/\s+/g, ' ').trim().slice(0, 300) };
        let j: Record<string, unknown> = {}; try { j = JSON.parse(text) as Record<string, unknown>; } catch { /* empty body */ }
        return { status: r.status, ...(path === '/me' ? { product: j.product ?? null, country: j.country ?? null } : {}), ...(path.endsWith('/devices') ? { devices: ((j.devices as { name: string; type: string; is_restricted?: boolean }[] | undefined) ?? []).map((d) => `${d.name} (${d.type}${d.is_restricted ? ', restricted' : ''})`) } : {}) };
      } catch (e) { return { status: 0, body: (e as Error).message }; }
    };
    out.me = await probe('/me');
    out.devices = await probe('/me/player/devices');
    return out;
  }

  /**
   * A short-lived access token for Spotify's Web Playback SDK, which runs in the page and plays the audio there. The SDK has to hold the
   * token itself; the refresh token never leaves the server. Needs the `streaming` permission (added to the sign-in later than the rest,
   * so an older sign-in has to be repeated once).
   */
  async sdkToken(): Promise<{ token: string; expiresInMs: number }> {
    const access = await this.access();
    const t = this.load().token!;
    if (!(t.scope ?? '').split(' ').includes('streaming')) throw new SpotifyError(403, 'Playing inside the app needs one more Spotify permission: sign out of Spotify in Settings and sign in again');
    return { token: access, expiresInMs: Math.max(0, t.expiresAt - this.now()) };
  }
  private async get<T>(path: string): Promise<T> {
    const url = path.startsWith('http') ? path : `https://api.spotify.com/v1${path}`;
    for (let attempt = 0; attempt < 3; attempt++) {
      let res: Response;
      try { res = await this.f(url, { headers: { Authorization: `Bearer ${await this.access()}` }, signal: AbortSignal.timeout(20_000) }); }
      catch (e) { if (e instanceof SpotifyError) throw e; throw new SpotifyError(502, `Could not reach Spotify (${(e as Error).message})`); }
      if (res.status === 429) { await new Promise((r) => setTimeout(r, Math.min(5000, (Number(res.headers.get('retry-after')) || 1) * 1000))); continue; }
      if (res.status === 401) throw new SpotifyError(401, 'The Spotify sign-in is no longer valid; sign in again');
      if (res.ok) return (await res.json()) as T;
      const raw = await res.text().catch(() => '');
      let said: { message?: string } | string | undefined;
      try { said = (JSON.parse(raw) as { error?: { message?: string } | string }).error; } catch { /* not JSON */ }
      const why = (typeof said === 'string' ? said : said?.message) || raw.replace(/\s+/g, ' ').trim().slice(0, 160) || undefined;
      if (res.status === 403) throw new SpotifyError(403, `Spotify refused (403${why ? `: ${why}` : ''}). In Development Mode an app can only read the account of its owner and the people added under User Management in the Spotify dashboard, and an older sign-in may lack a permission: signing out and in again fixes that.`);
      if (res.status === 404) throw new SpotifyError(404, `Spotify cannot find that${why ? ` (${why})` : ''}`);
      throw new SpotifyError(502, `Spotify answered ${res.status}${why ? `: ${why}` : ''}`);
    }
    throw new SpotifyError(429, 'Spotify is rate limiting this app; try again in a minute');
  }

  /** Any call that changes something, or answers 204 (the player endpoints). */
  private async call(method: 'PUT' | 'POST', path: string, body?: unknown): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt++) {
      let res: Response;
      try { res = await this.f(`https://api.spotify.com/v1${path}`, { method, headers: { Authorization: `Bearer ${await this.access()}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15_000) }); }
      catch (e) { if (e instanceof SpotifyError) throw e; throw new SpotifyError(502, `Could not reach Spotify (${(e as Error).message})`); }
      if (res.status === 429) { await new Promise((r) => setTimeout(r, Math.min(3000, (Number(res.headers.get('retry-after')) || 1) * 1000))); continue; }
      if (res.ok) return;
      const msg = ((await res.json().catch(() => null)) as { error?: { message?: string; reason?: string } } | null)?.error;
      if (res.status === 404 || msg?.reason === 'NO_ACTIVE_DEVICE') throw new SpotifyError(404, 'No Spotify device is awake. Open Spotify on a device (or start Soloist on the Pi) and pick it as the device.');
      if (res.status === 403) throw new SpotifyError(403, msg?.reason === 'PREMIUM_REQUIRED' ? 'Spotify Premium is required to control playback' : `Spotify refused: ${msg?.message ?? 'forbidden'}. Sign in again so TurboMusic gets playback permission.`);
      if (res.status === 401) throw new SpotifyError(401, 'The Spotify sign-in is no longer valid; sign in again');
      throw new SpotifyError(502, `Spotify answered ${res.status}${msg?.message ? `: ${msg.message}` : ''}`);
    }
    throw new SpotifyError(429, 'Spotify is rate limiting this app; try again in a minute');
  }

  /** Spotify Connect devices of the account: the phone, the PC app, Soloist on the Pi, a speaker. */
  async devices(): Promise<SpotifyDevice[]> {
    const j = await this.get<{ devices?: { id: string | null; name: string; type: string; is_active: boolean; volume_percent?: number | null; is_restricted?: boolean }[] }>('/me/player/devices');
    return (j.devices ?? []).filter((d) => d.name).map((d) => ({ id: d.id ?? '', name: d.name, type: d.type, active: d.is_active, volume: d.volume_percent ?? null, restricted: !!d.is_restricted || !d.id }));
  }

  /** What Spotify is playing now (null when nothing is, which Spotify reports as 204). */
  async playerState(): Promise<SpotifyPlayerState | null> {
    const token = await this.access();
    let res: Response;
    try { res = await this.f('https://api.spotify.com/v1/me/player?additional_types=track', { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) }); }
    catch (e) { throw new SpotifyError(502, `Could not reach Spotify (${(e as Error).message})`); }
    if (res.status === 204) return null;
    if (res.status === 401) throw new SpotifyError(401, 'The Spotify sign-in is no longer valid; sign in again');
    if (!res.ok) throw new SpotifyError(res.status === 429 ? 429 : 502, `Spotify answered ${res.status}`);
    const j = (await res.json().catch(() => null)) as { is_playing?: boolean; progress_ms?: number; shuffle_state?: boolean; device?: { id?: string; name?: string; volume_percent?: number | null };
      item?: { uri?: string; id?: string; name?: string; duration_ms?: number; artists?: { name: string }[]; album?: { name?: string; images?: { url: string }[] } } | null } | null;
    if (!j) return null;
    const t = j.item;
    return { playing: !!j.is_playing, progressMs: j.progress_ms ?? 0, shuffle: !!j.shuffle_state, device: { id: j.device?.id ?? '', name: j.device?.name ?? '', volume: j.device?.volume_percent ?? null },
      track: t?.uri ? { uri: t.uri, id: t.id ?? '', title: t.name ?? '', artists: (t.artists ?? []).map((a) => a.name), album: t.album?.name ?? '', cover: t.album?.images?.[0]?.url ?? null, durationMs: t.duration_ms ?? 0 } : null };
  }

  /** Start these tracks (in order) on a device, optionally from a position. Spotify keeps playing the list after the first. */
  play(o: { uris: string[]; deviceId?: string; positionMs?: number }) {
    return this.call('PUT', `/me/player/play${o.deviceId ? `?device_id=${encodeURIComponent(o.deviceId)}` : ''}`, { uris: o.uris.slice(0, 50), ...(o.positionMs ? { position_ms: Math.round(o.positionMs) } : {}) });
  }
  command(c: { type: 'pause' | 'resume' | 'next' | 'previous' | 'seek' | 'volume' | 'shuffle' | 'queue' | 'transfer'; deviceId?: string; value?: number | boolean | string }) {
    const dev = c.deviceId ? `${'?'}device_id=${encodeURIComponent(c.deviceId)}` : '';
    const withDev = (q: string) => `${q}${dev ? (q.includes('?') ? '&' : '?') + dev.slice(1) : ''}`;
    switch (c.type) {
      case 'pause': return this.call('PUT', `/me/player/pause${dev}`);
      case 'resume': return this.call('PUT', `/me/player/play${dev}`);
      case 'next': return this.call('POST', `/me/player/next${dev}`);
      case 'previous': return this.call('POST', `/me/player/previous${dev}`);
      case 'seek': return this.call('PUT', withDev(`/me/player/seek?position_ms=${Math.max(0, Math.round(Number(c.value) || 0))}`));
      case 'volume': return this.call('PUT', withDev(`/me/player/volume?volume_percent=${Math.min(100, Math.max(0, Math.round(Number(c.value) || 0)))}`));
      case 'shuffle': return this.call('PUT', withDev(`/me/player/shuffle?state=${c.value ? 'true' : 'false'}`));
      case 'queue': return this.call('POST', withDev(`/me/player/queue?uri=${encodeURIComponent(String(c.value ?? ''))}`));
      case 'transfer': return this.call('PUT', '/me/player', { device_ids: [c.deviceId ?? ''], play: true });
    }
  }

  /** Find tracks by text (Development Mode returns few results per query). */
  /** A call that changes a playlist; answers its JSON (or {}). Explains a refusal in terms of the permission, which is the usual cause. */
  private async write<T>(method: 'POST' | 'PUT', path: string, body: unknown): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      let res: Response;
      try { res = await this.f(`https://api.spotify.com/v1${path}`, { method, headers: { Authorization: `Bearer ${await this.access()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) }); }
      catch (e) { if (e instanceof SpotifyError) throw e; throw new SpotifyError(502, `Could not reach Spotify (${(e as Error).message})`); }
      if (res.status === 429) { await new Promise((r) => setTimeout(r, Math.min(5000, (Number(res.headers.get('retry-after')) || 1) * 1000))); continue; }
      if (res.ok) return ((await res.json().catch(() => ({}))) as T);
      const msg = ((await res.json().catch(() => null)) as { error?: { message?: string } } | null)?.error?.message;
      if (res.status === 401) throw new SpotifyError(401, 'The Spotify sign-in is no longer valid; sign in again');
      if (res.status === 403) throw new SpotifyError(403, `Spotify will not let TurboMusic change that playlist${msg ? ` (${msg})` : ''}. Sign in again with “Allow changing my playlists”, and only playlists you own or collaborate on can be changed.`);
      if (res.status === 404) throw new SpotifyError(404, `Spotify cannot find that playlist${msg ? ` (${msg})` : ''}`);
      throw new SpotifyError(502, `Spotify answered ${res.status}${msg ? `: ${msg}` : ''}`);
    }
    throw new SpotifyError(429, 'Spotify is rate limiting this app; try again in a minute');
  }

  /** Make a new, private playlist on the account (POST /me/playlists, which replaced /users/{id}/playlists in Feb 2026). */
  async createPlaylist(name: string, description = ''): Promise<{ id: string; url: string }> {
    const j = await this.write<{ id: string; external_urls?: { spotify?: string } }>('POST', '/me/playlists', { name, description, public: false });
    return { id: j.id, url: j.external_urls?.spotify ?? `https://open.spotify.com/playlist/${j.id}` };
  }

  /** Make the playlist hold exactly these tracks, in this order (PUT /playlists/{id}/items replaces up to 100, the rest are added after). */
  async setPlaylistTracks(id: string, uris: string[]): Promise<void> {
    await this.write('PUT', `/playlists/${id}/items`, { uris: uris.slice(0, 100) });
    for (let i = 100; i < uris.length; i += 100) await this.write('POST', `/playlists/${id}/items`, { uris: uris.slice(i, i + 100) });
  }

  async search(q: string, limit = 10): Promise<SpotifyTrack[]> {
    const j = await this.get<{ tracks?: { items: { id: string; uri: string; name: string; duration_ms?: number; artists?: { name: string }[]; album?: { name?: string; uri?: string; release_date?: string; images?: { url: string }[]; artists?: { name: string }[] } }[] } }>(`/search?type=track&limit=${Math.min(10, limit)}&q=${encodeURIComponent(q)}`);
    return (j.tracks?.items ?? []).map((t) => ({ uri: t.uri, id: t.id, title: t.name, artists: (t.artists ?? []).map((a) => a.name), album: t.album?.name ?? '', albumUri: t.album?.uri ?? null, albumArtist: t.album?.artists?.[0]?.name ?? null,
      durationMs: t.duration_ms ?? null, cover: t.album?.images?.[0]?.url ?? null, releaseDate: t.album?.release_date ?? null, trackNumber: null, isrc: null }));
  }

  async playlists(): Promise<{ id: string; name: string; tracks: number | null; owner: string; cover: string | null; mine: boolean }[]> {
    const me = await this.get<{ id: string }>('/me');
    const out: { id: string; name: string; tracks: number | null; owner: string; cover: string | null; mine: boolean }[] = [];
    let next: string | null = '/me/playlists?limit=50';
    while (next && out.length < 500) {
      const page: { items: { id: string; name: string; tracks?: { total?: number }; items?: { total?: number }; owner?: { id?: string; display_name?: string }; images?: { url: string }[] }[]; next: string | null } = await this.get(next);
      for (const p of page.items ?? []) if (p?.id) out.push({ id: p.id, name: p.name, tracks: p.items?.total ?? p.tracks?.total ?? null, owner: p.owner?.display_name ?? p.owner?.id ?? '', cover: p.images?.[0]?.url ?? null, mine: p.owner?.id === me.id });
      next = page.next;
    }
    return out;
  }

  async playlist(id: string): Promise<SpotifyList> {
    type Item = { track?: { id?: string; uri?: string; name?: string; duration_ms?: number; track_number?: number; is_local?: boolean; artists?: { name: string }[]; external_ids?: { isrc?: string };
      album?: { uri?: string; name?: string; release_date?: string; images?: { url: string }[]; artists?: { name: string }[] } } | null };
    const head = await this.get<{ name: string; description?: string; images?: { url: string }[]; owner?: { display_name?: string } }>(`/playlists/${id}?fields=name,description,images,owner(display_name)`);
    const tracks: SpotifyTrack[] = [];
    // the list of items was renamed from /tracks to /items in Feb 2026: ask for the new one first
    let next: string | null = `/playlists/${id}/items?limit=100`, legacy = false;
    while (next && tracks.length < 5000) {
      let page: { items: Item[]; next: string | null };
      try { page = await this.get(next); }
      catch (e) { if (!legacy && e instanceof SpotifyError && e.status === 404) { legacy = true; next = `/playlists/${id}/tracks?limit=100`; continue; } throw e; }
      for (const it of page.items ?? []) {
        const t = it.track;
        if (!t || t.is_local || !t.id || !t.name) continue;
        tracks.push({ uri: t.uri ?? `spotify:track:${t.id}`, id: t.id, title: t.name, artists: (t.artists ?? []).map((a) => a.name), album: t.album?.name ?? '', albumUri: t.album?.uri ?? null, albumArtist: t.album?.artists?.[0]?.name ?? null,
          durationMs: t.duration_ms ?? null, cover: t.album?.images?.[0]?.url ?? null, releaseDate: t.album?.release_date ?? null, trackNumber: t.track_number ?? null, isrc: t.external_ids?.isrc ?? null });
      }
      next = page.next;
    }
    return { kind: 'playlist', name: head.name, description: head.description || null, cover: head.images?.[0]?.url ?? null, owner: head.owner?.display_name ?? null, tracks, source: 'api' };
  }
}

/** Any Spotify link -> what it holds. Public playlists use the embed page; a track or album link gives its title and cover (oEmbed). */
export async function resolveLink(input: unknown, o: { fetchImpl?: Fetch; account?: SpotifyAccount } = {}): Promise<SpotifyList> {
  const ref = parseRef(input);
  if (!ref) throw new SpotifyError(400, 'That does not look like a Spotify link');
  if (ref.kind === 'playlist') {
    // the user's own sign-in knows more (albums, durations) when it is allowed to read that playlist
    if (o.account?.status().signedIn) { try { return await o.account.playlist(ref.id); } catch { /* not readable with the account: use the public page */ } }
    return embedPlaylist(ref.id, o.fetchImpl);
  }
  if (ref.kind === 'track' || ref.kind === 'album') {
    const m = await oembed(ref, o.fetchImpl);
    if (ref.kind === 'track') return { kind: 'track', name: m.title, description: null, cover: m.cover, owner: null, source: 'oembed', note: 'A track link only gives its title; add the artist yourself or use a playlist.',
      tracks: [{ uri: `spotify:track:${ref.id}`, id: ref.id, title: m.title, artists: [], album: '', albumUri: null, albumArtist: null, durationMs: null, cover: m.cover, releaseDate: null, trackNumber: null, isrc: null }] };
    return { kind: 'album', name: m.title, description: null, cover: m.cover, owner: null, source: 'oembed', tracks: [], note: 'An album link only gives its name and cover here. Sign in to Spotify to read its tracks.' };
  }
  throw new SpotifyError(400, `A Spotify ${ref.kind} link cannot be imported`);
}
