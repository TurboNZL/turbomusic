import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { SpotifyAccount, SpotifyError, decodeEntities, oembed, parseEmbed, parseRef, resolveLink } from '../src/spotify.ts';

const ID = '37i9dQZF1DXcBWIGoYBM5M';
const embedHtml = (entity: unknown) => `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { state: { data: { entity } } } } })}</script></html>`;
const json = (o: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', ...headers } });

describe('links', () => {
  it('parses links and uris', () => {
    expect(parseRef(`https://open.spotify.com/playlist/${ID}?si=abc`)).toEqual({ kind: 'playlist', id: ID });
    expect(parseRef(`spotify:track:${ID}`)).toEqual({ kind: 'track', id: ID });
    expect(parseRef(`https://open.spotify.com/embed/playlist/${ID}`)?.kind).toBe('playlist');
    expect(parseRef('https://example.com/x')).toBeNull();
    expect(parseRef(5)).toBeNull();
  });
  it('decodes the entities oEmbed titles come with', () => { expect(decodeEntities('Don&#x27;t &amp; Stop &quot;Me&quot; &#8217;')).toBe('Don\'t & Stop "Me" ’'); });
});

describe('oEmbed', () => {
  it('reads the title and cover, decoded', async () => {
    let asked = '';
    const f = (async (u: string) => { asked = String(u); return json({ title: 'Get It Together &amp; More', thumbnail_url: 'https://i.scdn.co/image/abc' }); }) as unknown as typeof fetch;
    expect(await oembed({ kind: 'track', id: ID }, f)).toEqual({ title: 'Get It Together & More', cover: 'https://i.scdn.co/image/abc' });
    expect(decodeURIComponent(asked)).toContain(`url=spotify:track:${ID}`);
  });
  it('explains a 404', async () => {
    await expect(oembed({ kind: 'playlist', id: ID }, (async () => new Response('', { status: 404 })) as unknown as typeof fetch)).rejects.toThrow(/public/);
  });
});

describe('embed page', () => {
  const entity = { name: 'songs i care for', subtitle: 'someone', coverArt: { sources: [{ url: 'https://i.scdn.co/small', width: 64 }, { url: 'https://i.scdn.co/big', width: 640 }] },
    trackList: [{ uri: 'spotify:track:7y6c07pgjZvtHI9kuMVqk1', title: 'Get It Together', subtitle: 'Drake, Black Coffee', duration: 250337 }, { uri: 'spotify:episode:7y6c07pgjZvtHI9kuMVqk1', title: 'Podcast' }, { uri: 'spotify:track:2tPcTFiQF9MbVUyjZ3zDhA', title: 'Paramedic!', subtitle: 'SOB X RBE' }] };
  it('reads the track list wherever it is nested', () => {
    const l = parseEmbed(embedHtml(entity), ID);
    expect(l.name).toBe('songs i care for');
    expect(l.cover).toBe('https://i.scdn.co/big');
    expect(l.tracks.map((t) => [t.title, t.artists])).toEqual([['Get It Together', ['Drake', 'Black Coffee']], ['Paramedic!', ['SOB X RBE']]]);
    expect(l.tracks[0].durationMs).toBe(250337);
  });
  it('says so when the page has no data', () => {
    expect(() => parseEmbed('<html></html>', ID)).toThrow(SpotifyError);
    expect(() => parseEmbed(embedHtml({ nothing: 1 }), ID)).toThrow(/no track list/);
  });
  it('resolves a playlist link through the page', async () => {
    const f = (async (u: string) => (String(u).includes('/embed/playlist/') ? new Response(embedHtml(entity)) : new Response('', { status: 404 }))) as unknown as typeof fetch;
    expect((await resolveLink(`https://open.spotify.com/playlist/${ID}`, { fetchImpl: f })).tracks).toHaveLength(2);
    await expect(resolveLink('nope')).rejects.toThrow(/Spotify link/);
  });
});

describe('sign-in', () => {
  const dir = () => mkdtempSync(join(tmpdir(), 'sp-'));
  const CLIENT = 'a'.repeat(32);
  it('builds a PKCE authorize link, then exchanges the pasted address', async () => {
    const d = dir(); const bodies: URLSearchParams[] = [];
    const f = (async (_u: string, init?: RequestInit) => { bodies.push(init!.body as URLSearchParams); return json({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600, scope: 'x' }); }) as unknown as typeof fetch;
    const a = new SpotifyAccount(d, { fetchImpl: f, now: () => 1000 });
    expect(() => a.authUrl()).toThrow(/client id/);
    expect(() => a.configure('short')).toThrow(SpotifyError);
    a.configure(CLIENT);
    const u = new URL(a.authUrl());
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('client_id')).toBe(CLIENT);
    const state = u.searchParams.get('state')!;
    const verifier = JSON.parse(readFileSync(join(d, 'spotify.json'), 'utf8')).pending.verifier;
    expect(u.searchParams.get('code_challenge')).toBe(createHash('sha256').update(verifier).digest('base64url'));
    await expect(a.exchange(`http://127.0.0.1:47813/api/spotify/callback?code=C&state=wrong`)).rejects.toThrow(/different sign-in/);
    await a.exchange(`http://127.0.0.1:47813/api/spotify/callback?code=THECODE&state=${state}`);
    expect(bodies[0].get('code')).toBe('THECODE');
    expect(bodies[0].get('code_verifier')).toBe(verifier);
    expect(a.status().signedIn).toBe(true);
    a.signOut();
    expect(a.status().signedIn).toBe(false);
  });
  it('lists playlists and reads one, falling back from /items to /tracks and skipping local files', async () => {
    const d = dir(); const seen: string[] = [];
    let now = 1000;
    const f = (async (u: string, init?: RequestInit) => {
      const url = String(u); seen.push(url);
      if (url.includes('accounts.spotify.com')) return json({ access_token: 'AT2', refresh_token: 'RT2', expires_in: 3600 });
      if (url.endsWith('/me')) return json({ id: 'me' });
      if (url.includes('/me/playlists')) return json({ items: [{ id: 'p1', name: 'Mine', tracks: { total: 2 }, owner: { id: 'me', display_name: 'Me' } }, { id: 'p2', name: 'Theirs', owner: { id: 'x' } }], next: null });
      if (url.includes('/playlists/p1?fields')) return json({ name: 'Mine', images: [{ url: 'https://i.scdn.co/c' }] });
      if (url.includes('/playlists/p1/items')) return new Response('', { status: 404 });
      if (url.includes('/playlists/p1/tracks')) return json({ items: [
        { track: { id: 'aaaaaaaaaaaaaaaaaaaaaa', name: 'Song', duration_ms: 1000, artists: [{ name: 'A' }], album: { name: 'Alb', uri: 'spotify:album:b', release_date: '2020-01-01', images: [{ url: 'https://i.scdn.co/a' }], artists: [{ name: 'A' }] } } },
        { track: { id: 'x', name: 'Local', is_local: true } }, { track: null }], next: null });
      return new Response('', { status: 500 });
    }) as unknown as typeof fetch;
    const a = new SpotifyAccount(d, { fetchImpl: f, now: () => now });
    a.configure(CLIENT); a.authUrl();
    const st = JSON.parse(readFileSync(join(d, 'spotify.json'), 'utf8')).pending.state;
    await a.exchange(`http://x/?code=C&state=${st}`);
    expect((await a.playlists()).map((p) => [p.name, p.mine])).toEqual([['Mine', true], ['Theirs', false]]);
    const l = await a.playlist('p1');
    expect(l.tracks).toHaveLength(1);
    expect(l.tracks[0]).toMatchObject({ title: 'Song', album: 'Alb', albumArtist: 'A', releaseDate: '2020-01-01' });
    expect(seen.some((u) => u.includes('/playlists/p1/items'))).toBe(true);
    now = 10_000_000; // expired: refreshes by itself
    await expect(a.playlists()).resolves.toBeTruthy();
  });
});

import { ALGORITHMS, parseMusicBrainzSearch, parseSimilar, similarArtists } from '../src/recommend.ts';
describe('player', () => {
  const CLIENT = 'b'.repeat(32);
  async function signedIn(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
    const d = mkdtempSync(join(tmpdir(), 'sp-'));
    const f = (async (u: string, init?: RequestInit) => (String(u).includes('accounts.spotify.com') ? json({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 }) : handler(String(u), init))) as unknown as typeof fetch;
    const a = new SpotifyAccount(d, { fetchImpl: f, now: () => 1000 });
    a.configure(CLIENT); a.authUrl();
    await a.exchange(`http://x/?code=C&state=${JSON.parse(readFileSync(join(d, 'spotify.json'), 'utf8')).pending.state}`);
    return a;
  }
  it('asks for playback permission when signing in', () => {
    const a = new SpotifyAccount(mkdtempSync(join(tmpdir(), 'sp-'))); a.configure(CLIENT);
    expect(new URL(a.authUrl()).searchParams.get('scope')).toContain('user-modify-playback-state');
  });
  it('keeps the old permissions by default and asks for the in-app player\'s only on request', () => {
    const a = new SpotifyAccount(mkdtempSync(join(tmpdir(), 'sp-'))); a.configure(CLIENT);
    const plain = new URL(a.authUrl()).searchParams.get('scope')!.split(' ');
    for (const p of ['streaming', 'user-read-email', 'user-read-private']) expect(plain).not.toContain(p);
    expect(plain).toContain('user-read-playback-state');
    const sdk = new URL(a.authUrl({ streaming: true })).searchParams.get('scope')!.split(' ');
    for (const p of ['streaming', 'user-read-email', 'user-read-private', 'user-read-playback-state']) expect(sdk).toContain(p);
  });
  it('hands the page a short-lived token for the in-app player, only with the streaming permission', async () => {
    async function withScope(scope: string) {
      const d = mkdtempSync(join(tmpdir(), 'sp-'));
      const f = (async () => json({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600, scope })) as unknown as typeof fetch;
      const a = new SpotifyAccount(d, { fetchImpl: f, now: () => 1000 });
      a.configure(CLIENT); a.authUrl();
      await a.exchange(`http://x/?code=C&state=${JSON.parse(readFileSync(join(d, 'spotify.json'), 'utf8')).pending.state}`);
      return a;
    }
    const ok = await withScope('user-modify-playback-state streaming');
    expect(ok.status().streaming).toBe(true);
    expect(await ok.sdkToken()).toEqual({ token: 'AT', expiresInMs: 3600 * 1000 - 60_000 });
    const old = await withScope('user-modify-playback-state');
    expect(old.status().streaming).toBe(false);
    await expect(old.sdkToken()).rejects.toThrow(/sign in again/);
  });
  it('asks to change playlists only on request, and creates / fills a playlist through the /items endpoints', async () => {
    const d = mkdtempSync(join(tmpdir(), 'sp-'));
    const calls: { method: string; url: string; body: unknown }[] = [];
    const f = (async (u: string, init?: RequestInit) => {
      if (String(u).includes('/api/token')) return json({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600, scope: 'playlist-modify-private playlist-modify-public' });
      calls.push({ method: init?.method ?? 'GET', url: String(u), body: init?.body ? JSON.parse(String(init.body)) : null });
      return json(String(u).endsWith('/me/playlists') ? { id: 'P'.repeat(22), external_urls: { spotify: 'https://open.spotify.com/playlist/x' } } : { snapshot_id: 'z' });
    }) as unknown as typeof fetch;
    const a = new SpotifyAccount(d, { fetchImpl: f, now: () => 1000 }); a.configure(CLIENT);
    expect(new URL(a.authUrl()).searchParams.get('scope')).not.toContain('playlist-modify');
    expect(new URL(a.authUrl({ write: true })).searchParams.get('scope')).toContain('playlist-modify-private');
    await a.exchange(`http://x/?code=C&state=${JSON.parse(readFileSync(join(d, 'spotify.json'), 'utf8')).pending.state}`);
    expect(a.status().canWrite).toBe(true);
    const made = await a.createPlaylist('Mine', 'x');
    expect(made.id).toBe('P'.repeat(22));
    const uris = Array.from({ length: 230 }, (_, i) => `spotify:track:${String(i).padStart(22, '0')}`);
    await a.setPlaylistTracks(made.id, uris);
    expect(calls[0]).toMatchObject({ method: 'POST', body: { name: 'Mine', public: false } });
    expect(calls.slice(1).map((c) => [c.method, (c.body as { uris: string[] }).uris.length])).toEqual([['PUT', 100], ['POST', 100], ['POST', 30]]);
    expect(calls[1].url).toContain(`/playlists/${made.id}/items`);
  });
  it('explains a 403 on a playlist change in terms of the permission', async () => {
    const d = mkdtempSync(join(tmpdir(), 'sp-'));
    const f = (async (u: string) => (String(u).includes('/api/token') ? json({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600, scope: 'x' }) : json({ error: { message: 'Insufficient client scope' } }, 403))) as unknown as typeof fetch;
    const a = new SpotifyAccount(d, { fetchImpl: f, now: () => 1000 }); a.configure(CLIENT); a.authUrl();
    await a.exchange(`http://x/?code=C&state=${JSON.parse(readFileSync(join(d, 'spotify.json'), 'utf8')).pending.state}`);
    expect(a.status().canWrite).toBe(false);
    await expect(a.setPlaylistTracks('P'.repeat(22), [])).rejects.toThrow(/Allow changing my playlists/);
  });
  it('does not crash on an old saved sign-in without a scope field', () => {
    const d = mkdtempSync(join(tmpdir(), 'sp-'));
    writeFileSync(join(d, 'spotify.json'), JSON.stringify({ clientId: CLIENT, token: { access: 'A', refresh: 'R', expiresAt: 1 } }));
    expect(new SpotifyAccount(d).status()).toMatchObject({ signedIn: true, streaming: false });
  });
  it('says what Spotify said when it refuses a read, not a generic message', async () => {
    const a = await signedIn(() => json({ error: { status: 403, message: 'Insufficient client scope' } }, 403));
    await expect(a.devices()).rejects.toThrow(/Spotify refused \(403: Insufficient client scope\)/);
  });
  it('shows the raw body of a refusal that is not JSON', async () => {
    const a = await signedIn(() => new Response('Forbidden', { status: 403 }));
    await expect(a.devices()).rejects.toThrow(/Spotify refused \(403: Forbidden\)/);
  });
  it('diagnoses a connection: permissions held, and what /me and the device list answer, without the token', async () => {
    const a = await signedIn((u) => (u.endsWith('/me') ? json({ product: 'premium', country: 'NZ', id: 'secret-id' }) : json({ error: { status: 403, message: 'Forbidden' } }, 403)));
    const d = await a.diagnose();
    expect(d).toMatchObject({ signedIn: true, me: { status: 200, product: 'premium', country: 'NZ' }, devices: { status: 403 } });
    expect((d.devices as { body: string }).body).toContain('Forbidden');
    expect(JSON.stringify(d)).not.toMatch(/AT|RT|secret-id/); // no token, no account id
  });
  it('lists devices, plays tracks on one and sends commands', async () => {
    const calls: string[] = [];
    const a = await signedIn((u, init) => {
      calls.push(`${init?.method ?? 'GET'} ${u.replace('https://api.spotify.com/v1', '')} ${init?.body ?? ''}`);
      if (u.endsWith('/me/player/devices')) return json({ devices: [{ id: 'd1', name: 'Soloist (pi)', type: 'Speaker', is_active: false, volume_percent: 50 }, { id: 'd2', name: 'Locked', type: 'x', is_active: false, is_restricted: true }, { id: null, name: 'Echo Dot', type: 'CastAudio', is_active: false }] });
      return new Response(null, { status: 204 });
    });
    // restricted devices (Spotify accepts no commands for them) and ones without an id stay in the list, marked, so they are not mistaken for missing ones
    expect(await a.devices()).toEqual([
      { id: 'd1', name: 'Soloist (pi)', type: 'Speaker', active: false, volume: 50, restricted: false },
      { id: 'd2', name: 'Locked', type: 'x', active: false, volume: null, restricted: true },
      { id: '', name: 'Echo Dot', type: 'CastAudio', active: false, volume: null, restricted: true },
    ]);
    await a.play({ uris: ['spotify:track:aaaaaaaaaaaaaaaaaaaaaa'], deviceId: 'd1', positionMs: 1500.4 });
    await a.command({ type: 'seek', value: 30000, deviceId: 'd1' });
    await a.command({ type: 'volume', value: 150 });
    await a.command({ type: 'next' });
    expect(calls).toContain('PUT /me/player/play?device_id=d1 {"uris":["spotify:track:aaaaaaaaaaaaaaaaaaaaaa"],"position_ms":1500}');
    expect(calls).toContain('PUT /me/player/seek?position_ms=30000&device_id=d1 ');
    expect(calls).toContain('PUT /me/player/volume?volume_percent=100 ');
    expect(calls).toContain('POST /me/player/next ');
  });
  it('explains a missing device and Premium', async () => {
    const a = await signedIn(() => json({ error: { reason: 'NO_ACTIVE_DEVICE', message: 'x' } }, 404));
    await expect(a.command({ type: 'pause' })).rejects.toThrow(/device is awake/);
    const b = await signedIn(() => json({ error: { reason: 'PREMIUM_REQUIRED' } }, 403));
    await expect(b.command({ type: 'pause' })).rejects.toThrow(/Premium/);
  });
  it('reads the player state, and null when nothing plays', async () => {
    const a = await signedIn(() => json({ is_playing: true, progress_ms: 4000, device: { id: 'd1', name: 'Pi' }, item: { uri: 'spotify:track:aaaaaaaaaaaaaaaaaaaaaa', id: 'aaaaaaaaaaaaaaaaaaaaaa', name: 'Song', duration_ms: 200000, artists: [{ name: 'A' }], album: { name: 'Alb', images: [{ url: 'https://i.scdn.co/x' }] } } }));
    expect(await a.playerState()).toMatchObject({ playing: true, progressMs: 4000, track: { title: 'Song', durationMs: 200000, artists: ['A'] } });
    const b = await signedIn(() => new Response(null, { status: 204 }));
    expect(await b.playerState()).toBeNull();
  });
  it('searches tracks', async () => {
    const a = await signedIn((u) => json({ tracks: { items: [{ id: 'aaaaaaaaaaaaaaaaaaaaaa', uri: 'spotify:track:aaaaaaaaaaaaaaaaaaaaaa', name: 'Song', artists: [{ name: 'A' }], album: { name: 'Alb' } }] } }));
    expect((await a.search('A Song'))[0]).toMatchObject({ title: 'Song', artists: ['A'], album: 'Alb' });
  });
});

describe('recommendation sources', () => {
  it('picks the exact artist from MusicBrainz and ignores lookalikes', () => {
    expect(parseMusicBrainzSearch({ artists: [{ id: 'x', name: 'Drake Bell', score: 80 }, { id: 'abc', name: 'Drake', score: 100 }] }, 'drake')).toBe('abc');
    expect(parseMusicBrainzSearch({ artists: [{ id: 'x', name: 'Other', score: 100 }] }, 'Drake')).toBeNull();
  });
  it('reads similar artists in either shape, best first', () => {
    expect(parseSimilar([{ name: 'B', artist_mbid: 'm2', score: 3 }, { name: 'A', artist_mbid: 'm1', score: 9 }, { name: 'no id' }]).map((a) => a.name)).toEqual(['A', 'B']);
    expect(parseSimilar({ data: [{ name: 'C', artist_mbid: 'm3', score: 1 }] })).toHaveLength(1);
    expect(parseSimilar(null)).toEqual([]);
  });
});

describe('similar artists lookup', () => {
  it('falls back to the older algorithm when the first returns nothing', async () => {
    const urls: string[] = [];
    const f = (async (u: string) => {
      urls.push(u);
      if (u.includes('musicbrainz')) return new Response(JSON.stringify({ artists: [{ id: 'm1', name: 'Drake', score: 100 }] }));
      return new Response(u.includes(ALGORITHMS[0]) ? '[]' : JSON.stringify([{ artist_mbid: 'x', name: 'Future', score: 5 }]));
    }) as unknown as typeof fetch;
    expect((await similarArtists('Drake', f)).map((a) => a.name)).toEqual(['Future']);
    expect(urls.filter((u) => u.includes('labs.api'))).toHaveLength(2);
  });
  it('accepts a single exact-name match even when MusicBrainz scores it below 90', () => {
    expect(parseMusicBrainzSearch({ artists: [{ id: 'z', name: 'Tyler, The Creator', score: 85 }] }, 'Tyler, the Creator')).toBe('z');
  });
});

import { cleanDate, lookupAlbumDate, pickItunesDate, pickMusicBrainzDate } from '../src/dates.ts';
describe('release dates', () => {
  it('only well-formed dates pass', () => {
    expect(cleanDate('2024-06-14T07:00:00Z')).toBe('2024-06-14'); expect(cleanDate('2019-06')).toBe('2019-06'); expect(cleanDate('1999')).toBe('1999');
    expect(cleanDate('0000-00-00')).toBeNull(); expect(cleanDate('soon')).toBeNull(); expect(cleanDate(undefined)).toBeNull();
  });
  it('iTunes: exact album and artist only', () => {
    const results = [{ collectionName: 'HABIBTI (Deluxe)', artistName: 'Drake', releaseDate: '2026-09-05T07:00:00Z' }, { collectionName: 'Other', artistName: 'Drake', releaseDate: '2020-01-01T08:00:00Z' }];
    expect(pickItunesDate(results, 'HABIBTI', 'Drake')).toBe('2026-09-05');
    expect(pickItunesDate(results, 'HABIBTI', 'Someone Else')).toBeNull();
    expect(pickItunesDate(results, 'Nope', 'Drake')).toBeNull();
  });
  it('MusicBrainz: strong exact matches only', () => {
    const j = { 'release-groups': [{ score: 100, title: 'Nevermind', 'first-release-date': '1991-09-24', 'artist-credit': [{ name: 'Nirvana' }] }, { score: 60, title: 'Nevermind', 'first-release-date': '2011', 'artist-credit': [{ name: 'Nirvana' }] }] };
    expect(pickMusicBrainzDate(j, 'Nevermind', 'Nirvana')).toBe('1991-09-24');
    expect(pickMusicBrainzDate({ 'release-groups': [j['release-groups'][1]] }, 'Nevermind', 'Nirvana')).toBeNull();
  });
  it('tries Spotify, then iTunes, then MusicBrainz', async () => {
    const calls: string[] = [];
    const f = (async (u: string) => { calls.push(u.includes('itunes') ? 'itunes' : 'mb'); return new Response(u.includes('itunes') ? '{"results":[]}' : JSON.stringify({ 'release-groups': [{ score: 98, title: 'A', 'first-release-date': '2001-02', 'artist-credit': [{ name: 'B' }] }] })); }) as unknown as typeof fetch;
    const spotify = { search: async () => [{ album: 'A', artists: ['B'], releaseDate: null }] } as never;
    expect(await lookupAlbumDate({ album: 'A', artist: 'B' }, { fetchImpl: f, spotify })).toEqual({ date: '2001-02', source: 'musicbrainz' });
    expect(calls).toEqual(['itunes', 'mb']);
    const sp = { search: async () => [{ album: 'A', artists: ['B'], releaseDate: '2003-04-05' }] } as never;
    expect(await lookupAlbumDate({ album: 'A', artist: 'B' }, { fetchImpl: f, spotify: sp })).toEqual({ date: '2003-04-05', source: 'spotify' });
    expect(await lookupAlbumDate({ album: 'A', artist: 'Unknown artist' }, { fetchImpl: f })).toBeNull();
  });
});
