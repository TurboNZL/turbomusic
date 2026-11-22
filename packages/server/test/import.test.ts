import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Store } from '../src/db.ts';
import { createApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { cleanTitle, coverCandidates, Importer, parsePreview, pickItunesArtwork } from '../src/import.ts';
import { filePath } from '../src/files.ts';

let dir: string, store: Store;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'turbomusic-imp-')); mkdirSync(join(dir, 'data', 'tmp'), { recursive: true }); store = new Store(join(dir, 'data')); });
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });

const PLAYLIST = {
  _type: 'playlist', title: 'Album - Love Sick', uploader: 'Don Toliver - Topic',
  thumbnails: [{ url: 'https://i.ytimg.com/vi/a/small.jpg' }, { url: 'https://i.ytimg.com/vi/a/big.jpg' }],
  entries: [
    { id: 'aaa', title: 'Don Toliver - Leather Coat (Official Audio)', url: 'https://www.youtube.com/watch?v=aaa', duration: 181 },
    { id: 'bbb', title: 'Bus Stop [Lyrics]', webpage_url: 'https://music.youtube.com/watch?v=bbb', duration: 150 },
    null, { title: 'no id' },
  ],
};

describe('cleanTitle', () => {
  it('strips known noise and a leading "Artist - ", nothing else', () => {
    expect(cleanTitle('Don Toliver - Leather Coat (Official Audio)', 'Don Toliver')).toBe('Leather Coat');
    expect(cleanTitle('Bus Stop [Lyrics]')).toBe('Bus Stop');
    expect(cleanTitle('Song (feat. Someone)', 'X')).toBe('Song (feat. Someone)');
    expect(cleanTitle('Other Artist - Song', 'Don Toliver')).toBe('Other Artist - Song');
    expect(cleanTitle('(Official Audio)')).toBe('(Official Audio)'); // never return empty
  });
});

describe('coverCandidates', () => {
  it('puts real square album art first (enlarged), then playlist thumbnails by size, then per-id fallbacks, no duplicates', () => {
    const info = { thumbnails: [{ url: 'https://i.ytimg.com/vi/a/hqdefault.jpg', width: 480, height: 360 }, { url: 'https://lh3.googleusercontent.com/abc=w544-h544-l90-rj', width: 544, height: 544 }, { url: 'https://i.ytimg.com/vi/a/maxresdefault.jpg', width: 1280, height: 720 }] };
    const c = coverCandidates(info, [{ id: 'aaa' }]);
    expect(c[0]).toBe('https://lh3.googleusercontent.com/abc=w1200-h1200-l90-rj');
    expect(c.slice(1, 3)).toEqual(['https://i.ytimg.com/vi/a/maxresdefault.jpg', 'https://i.ytimg.com/vi/a/hqdefault.jpg']);
    expect(c).toContain('https://i.ytimg.com/vi/aaa/hq720.jpg');
    expect(new Set(c).size).toBe(c.length);
  });
  it('still offers the standard thumbnails when yt-dlp lists none', () => {
    expect(coverCandidates({}, [{ id: 'xyz' }])[0]).toBe('https://i.ytimg.com/vi/xyz/maxresdefault.jpg');
  });
});

describe('parsePreview', () => {
  it('maps a playlist: drops entries without ids, cleans artist/title, picks the biggest thumbnail', () => {
    const p = parsePreview(PLAYLIST);
    expect(p).toMatchObject({ title: 'Love Sick', artist: 'Don Toliver', thumbnail: 'https://i.ytimg.com/vi/a/big.jpg' });
    expect(p.entries.map((e) => [e.id, e.title, e.url])).toEqual([
      ['aaa', 'Leather Coat', 'https://www.youtube.com/watch?v=aaa'], ['bbb', 'Bus Stop', 'https://music.youtube.com/watch?v=bbb']]);
    expect(p.entries[0].rawTitle).toContain('Official Audio');
  });
  it('treats a single video as a one-track album', () => {
    const p = parsePreview({ id: 'zzz', title: 'Solo', uploader: 'Someone', duration: 10, thumbnail: 'https://i.ytimg.com/x.jpg' });
    expect(p.entries).toHaveLength(1);
    expect(p).toMatchObject({ title: 'Solo', artist: 'Someone', thumbnail: 'https://i.ytimg.com/x.jpg' });
  });
});

function fakeYtdlp(json: object | null) {
  const path = join(dir, 'fake-yt-dlp');
  writeFileSync(path, json ? `#!/bin/sh\necho "$@" > "${dir}/argv.log"\ncat <<'EOF_JSON'\n${JSON.stringify(json)}\nEOF_JSON\n` : `#!/bin/sh\necho "ERROR: Unsupported URL" >&2\nexit 1\n`);
  chmodSync(path, 0o755);
  return path;
}
const appWith = (importer: Importer) => {
  const cfg = loadConfig({ TURBOMUSIC_DATA_DIR: join(dir, 'data'), TURBOMUSIC_TOKEN: 'tok' } as never);
  return createApp(cfg, store, undefined, importer);
};
const post = (app: ReturnType<typeof createApp>, path: string, body: unknown) =>
  app.request(path, { method: 'POST', headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

describe('iTunes cover fallback', () => {
  const results = [
    { collectionName: 'Love Sick (Deluxe)', artistName: 'Don Toliver', artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/Music/x/100x100bb.jpg' },
    { collectionName: 'Other', artistName: 'Someone', artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/Music/y/100x100bb.jpg' },
  ];
  it('takes a 600 px cover only when title and artist both match', () => {
    expect(pickItunesArtwork(results, 'Love Sick', 'Don Toliver')).toBe('https://is1-ssl.mzstatic.com/image/thumb/Music/x/600x600bb.jpg');
    expect(pickItunesArtwork(results, 'Love Sick', 'Somebody Else')).toBeNull();
    expect(pickItunesArtwork(results, 'Love', 'Don Toliver')).toBeNull();
    expect(pickItunesArtwork([], 'x', 'y')).toBeNull();
  });
  it('adds it after YouTube\'s square art and before video frames; a failing lookup changes nothing', async () => {
    const ok = (async () => new Response(JSON.stringify({ results }), { status: 200 })) as unknown as typeof fetch;
    const info = { ...PLAYLIST, title: 'Album - Love Sick', thumbnails: [{ url: 'https://i.ytimg.com/vi/a/hqdefault.jpg', width: 480, height: 360 }, { url: 'https://lh3.googleusercontent.com/abc=w544-h544', width: 544, height: 544 }] };
    const app = appWith(new Importer({ dataDir: join(dir, 'data'), store, ytdlp: fakeYtdlp(info), fetchImpl: ok }));
    const p = (await (await post(app, '/api/import/preview', { url: 'https://youtu.be/x' })).json()) as { thumbnails: string[] };
    expect(p.thumbnails[0]).toContain('googleusercontent.com');
    expect(p.thumbnails[1]).toBe('https://is1-ssl.mzstatic.com/image/thumb/Music/x/600x600bb.jpg');
    const down = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    const app2 = appWith(new Importer({ dataDir: join(dir, 'data'), store, ytdlp: fakeYtdlp(info), fetchImpl: down }));
    const q = (await (await post(app2, '/api/import/preview', { url: 'https://youtu.be/x' })).json()) as { thumbnails: string[] };
    expect(q.thumbnails.some((u) => u.includes('mzstatic'))).toBe(false);
  });
});

describe('POST /api/import/preview', () => {
  it('runs yt-dlp flat (no download), passes the URL after `--`, returns the review data', async () => {
    const app = appWith(new Importer({ dataDir: join(dir, 'data'), store, ytdlp: fakeYtdlp(PLAYLIST), fetchImpl: (async () => new Response('{}')) as unknown as typeof fetch }));
    const res = await post(app, '/api/import/preview', { url: 'https://www.youtube.com/playlist?list=abc' });
    expect(res.status).toBe(200);
    expect((await res.json() as { entries: unknown[] }).entries).toHaveLength(2);
    const argv = (await import('node:fs')).readFileSync(join(dir, 'argv.log'), 'utf8');
    expect(argv).toContain('--flat-playlist');
    expect(argv).toMatch(/-- https:\/\/www\.youtube\.com\/playlist\?list=abc/);
  });
  it('rejects non-URLs and option-looking input, requires the token, and reports yt-dlp failures', async () => {
    const app = appWith(new Importer({ dataDir: join(dir, 'data'), store, ytdlp: fakeYtdlp(null) }));
    expect((await post(app, '/api/import/preview', { url: '--exec evil' })).status).toBe(400);
    expect((await post(app, '/api/import/preview', {})).status).toBe(400);
    const failed = await post(app, '/api/import/preview', { url: 'https://example.com/x' });
    expect(failed.status).toBe(502);
    expect(((await failed.json()) as { error: string }).error).toContain('Unsupported URL');
    expect((await app.request('/api/import/preview', { method: 'POST' })).status).toBe(401);
  });
  it('says so when yt-dlp is not installed', async () => {
    const app = appWith(new Importer({ dataDir: join(dir, 'data'), store, ytdlp: join(dir, 'nope') }));
    const res = await post(app, '/api/import/preview', { url: 'https://youtu.be/x' });
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: string }).error).toContain('yt-dlp not found');
  });
});

describe('POST /api/import/cover, when the network is down', () => {
  it('says what failed instead of an internal error, and the first working link still wins', async () => {
    const down = (async () => { throw Object.assign(new TypeError('fetch failed'), { cause: new Error('getaddrinfo ENOTFOUND i.ytimg.com') }); }) as unknown as typeof fetch;
    const app = appWith(new Importer({ dataDir: join(dir, 'data'), store, fetchImpl: down }));
    const res = await post(app, '/api/import/cover', { urls: ['https://i.ytimg.com/vi/a/maxresdefault.jpg', 'https://i.ytimg.com/vi/a/hqdefault.jpg'] });
    expect(res.status).toBe(502);
    const { error } = (await res.json()) as { error: string };
    expect(error).toContain('No cover could be downloaded');
    expect(error).toContain('i.ytimg.com');
    expect(error).toContain('ENOTFOUND');
  });
});

describe('POST /api/import/cover', () => {
  it('with several links, uses the first one that downloads', async () => {
    const bytes = Buffer.from('second-wins');
    const flaky = (async (url: string) => url.includes('dead')
      ? { ok: false, status: 404, headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(0) }
      : { ok: true, status: 200, headers: new Headers({ 'content-type': 'image/jpeg' }), arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) }) as unknown as typeof fetch;
    const app = appWith(new Importer({ dataDir: join(dir, 'data'), store, fetchImpl: flaky }));
    const res = await post(app, '/api/import/cover', { urls: ['https://i.ytimg.com/vi/dead/maxresdefault.jpg', 'https://evil.example.com/x.jpg', 'https://i.ytimg.com/vi/ok/hqdefault.jpg'] });
    expect(await res.json()).toEqual({ hash: createHash('sha256').update(bytes).digest('hex'), url: 'https://i.ytimg.com/vi/ok/hqdefault.jpg' });
  });
  const png = Buffer.from('fake-image-bytes');
  const fakeFetch = (async (url: string) => ({ ok: true, status: 200, headers: new Headers({ 'content-type': 'image/jpeg' }), arrayBuffer: async () => png.buffer.slice(png.byteOffset, png.byteOffset + png.length), url })) as unknown as typeof fetch;
  it('stores an image from a YouTube image host, content-addressed, and is idempotent', async () => {
    const app = appWith(new Importer({ dataDir: join(dir, 'data'), store, fetchImpl: fakeFetch }));
    const expected = createHash('sha256').update(png).digest('hex');
    for (let i = 0; i < 2; i++) {
      const res = await post(app, '/api/import/cover', { url: 'https://i.ytimg.com/vi/abc/maxresdefault.jpg' });
      expect(await res.json()).toEqual({ hash: expected, url: 'https://i.ytimg.com/vi/abc/maxresdefault.jpg' });
    }
    expect(existsSync(filePath(join(dir, 'data'), expected))).toBe(true);
    expect(store.fileInfo(expected)?.size).toBe(png.length);
  });
  it('refuses other hosts (no server-side request forgery), http, and non-images', async () => {
    const app = appWith(new Importer({ dataDir: join(dir, 'data'), store, fetchImpl: fakeFetch }));
    for (const url of ['https://evil.example/x.jpg', 'http://i.ytimg.com/x.jpg', 'https://ytimg.com.evil.example/x.jpg', 'https://169.254.169.254/latest', 'file:///etc/passwd'])
      expect((await post(app, '/api/import/cover', { url })).status).toBe(400);
    const html = (async () => ({ ok: true, status: 200, headers: new Headers({ 'content-type': 'text/html' }), arrayBuffer: async () => new ArrayBuffer(1) })) as unknown as typeof fetch;
    const app2 = appWith(new Importer({ dataDir: join(dir, 'data'), store, fetchImpl: html }));
    expect((await post(app2, '/api/import/cover', { url: 'https://i.ytimg.com/x.jpg' })).status).toBe(502);
  });
});

import { entryArtists } from '../src/import.ts';
describe('per-track artists', () => {
  it('reads yt-dlp artists lists and "A, B" text, and ignores the uploader', () => {
    expect(entryArtists({ artists: ['Justice - Topic', 'SZA'] })).toEqual(['Justice', 'SZA']);
    expect(entryArtists({ artist: 'Yung Lean, Future' })).toEqual(['Yung Lean', 'Future']);
    expect(entryArtists({ uploader: 'Grand Theft Auto VI' })).toEqual([]);
  });
});
