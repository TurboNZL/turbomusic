import { describe, it, expect } from 'vitest';
import { mkdtempSync, existsSync, lstatSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createApp } from '../src/app.ts';
import { Store } from '../src/db.ts';
import { loadConfig } from '../src/config.ts';
import { Mirror } from '../src/mirror.ts';
import { planLayout, playlistFiles, safeName, type LibraryInput } from '../src/libraryExport.ts';
import { readTar, tarChunks } from '../src/tar.ts';

const TOKEN = 't0ken';
const auth = { Authorization: `Bearer ${TOKEN}` };
const json = { ...auth, 'Content-Type': 'application/json' };
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

const lead = (a: string) => [{ artistId: a, role: ['Lead artist'] }];
const input = (over: Partial<LibraryInput> = {}): LibraryInput => ({
  artists: [{ id: 'a', data: { name: 'The Lanterns' } }, { id: 'b', data: { name: 'AC/DC' } }],
  albums: [{ id: 'al', data: { title: 'Paper: Planes?', credits: lead('a'), trackOrder: ['t2', 't1'] } }, { id: 'al2', data: { title: 'Other', credits: lead('b') } }],
  releases: [], playlists: [],
  tracks: [
    { id: 't1', data: { title: 'Static', credits: lead('a'), albums: [{ albumId: 'al', order: 0 }], file: 'h1', syncWithAlbumCredits: true } },
    { id: 't2', data: { title: 'Static', credits: lead('a'), albums: [{ albumId: 'al', order: 1 }], file: 'h2', syncWithAlbumCredits: true } },
    { id: 't3', data: { title: 'Alone', credits: lead('b'), albums: [], file: 'h3' } },
    { id: 't4', data: { title: 'No audio', credits: lead('a'), albums: [], file: null } },
  ],
  mime: (h) => (h === 'h3' ? 'audio/flac' : 'audio/mpeg'), ...over,
});

describe('the readable layout', () => {
  it('names songs Artist/Album/NN Title.ext, numbering by the album order and leaving songs without audio out', () => {
    const items = planLayout(input());
    const by = Object.fromEntries(items.map((i) => [i.trackId, i.path]));
    expect(by.t2).toBe('The Lanterns/Paper_ Planes_/01 Static.mp3');
    expect(by.t1).toBe('The Lanterns/Paper_ Planes_/02 Static.mp3');
    expect(by.t3).toBe('AC_DC/Singles/Alone.flac');
    expect(by.t4).toBeUndefined();
  });
  it('never gives two songs one path', () => {
    const t = (id: string) => ({ id, data: { title: 'Same', credits: lead('a'), albums: [], file: id } });
    const paths = planLayout(input({ tracks: [t('x'), t('y'), t('z')] })).map((i) => i.path);
    expect(new Set(paths.map((p) => p.toLowerCase())).size).toBe(3);
  });
  it('makes safe names', () => {
    expect(safeName('a/b:c*d?')).toBe('a_b_c_d_');
    expect(safeName('  ..Hidden. ')).toBe('Hidden');
    expect(safeName('CON')).toBe('_CON');
    expect(safeName('')).toBe('Unknown');
  });
  it('writes playlists relative to the Playlists folder', () => {
    const inp = input({ playlists: [{ id: 'p', data: { name: 'Road/trip', trackIds: ['t1', 't4', 't3'] } }] });
    const [p] = playlistFiles(inp, planLayout(inp));
    expect(p.name).toBe('Road_trip.m3u8');
    expect(p.text).toContain('../Music/The Lanterns/Paper_ Planes_/02 Static.mp3');
    expect(p.text).not.toContain('No audio');
  });
});

function world() {
  const dir = mkdtempSync(join(tmpdir(), 'turbomusic-mir-'));
  const config = loadConfig({ TURBOMUSIC_DATA_DIR: dir, TURBOMUSIC_TOKEN: TOKEN } as never);
  const store = new Store(config.dataDir);
  const app = createApp(config, store);
  return { dir, store, app };
}
async function seed(w: ReturnType<typeof world>) {
  const bufs = [Buffer.from('song-one'), Buffer.from('song-two')];
  for (const b of bufs) await w.app.request(`/api/files/${sha(b)}`, { method: 'PUT', headers: { ...auth, 'Content-Type': 'audio/mpeg' }, body: b });
  const rec = (table: string, id: string, data: object) => ({ table, id, updatedAt: Date.now(), deviceId: 'd', deleted: false, data });
  await w.app.request('/api/sync/push', { method: 'POST', headers: json, body: JSON.stringify({ records: [
    rec('artists', 'a', { name: 'Nova Sky', image: null }), rec('albums', 'al', { title: 'First', credits: lead('a'), genres: [], cover: null, trackOrder: ['t1', 't2'] }),
    rec('tracks', 't1', { title: 'One', credits: lead('a'), genres: [], albums: [{ albumId: 'al', order: 0 }], file: sha(bufs[0]), syncWithAlbumCredits: true, initialRating: null, memories: 0 }),
    rec('tracks', 't2', { title: 'Two', credits: lead('a'), genres: [], albums: [{ albumId: 'al', order: 1 }], file: sha(bufs[1]), syncWithAlbumCredits: true, initialRating: null, memories: 0 }),
    rec('playlists', 'p', { name: 'Mix', description: null, cover: null, createdAt: 1, trackIds: ['t2', 't1'] }),
  ] }) });
  return bufs;
}

describe('the mirror', () => {
  it('links the songs by name, writes playlists, follows changes and prunes what went away', async () => {
    const w = world(); await seed(w);
    const root = join(w.dir, 'mirror');
    const mirror = new Mirror(w.dir, w.store, 5);
    mirror.configure({ enabled: true, dir: root });
    const r = mirror.run();
    expect(r.linked).toBe(2);
    const one = join(root, 'Music/Nova Sky/First/01 One.mp3');
    expect(lstatSync(one).isSymbolicLink()).toBe(true);
    expect(readFileSync(one, 'utf8')).toBe('song-one');
    expect(readFileSync(join(root, 'Playlists/Mix.m3u8'), 'utf8')).toContain('../Music/Nova Sky/First/02 Two.mp3');
    // running again changes nothing
    expect(mirror.run().linked).toBe(0);
    // a track loses its audio: its link goes, and the folder it leaves empty goes too once nothing is left in it
    w.store.push([{ table: 'tracks', id: 't1', updatedAt: Date.now() + 1000, deviceId: 'd', deleted: true, data: {} } as never]);
    const r3 = mirror.run();
    expect(r3.removed).toBe(1);
    expect(existsSync(one)).toBe(false);
    expect(readdirSync(join(root, 'Music/Nova Sky/First'))).toEqual(['02 Two.mp3']);
  });
  it('refuses a folder that already holds other things, and the library itself', () => {
    const w = world();
    const mirror = new Mirror(w.dir, w.store);
    const busy = join(w.dir, 'busy'); mkdirSync(busy); writeFileSync(join(busy, 'mine.txt'), 'x');
    expect(() => mirror.configure({ dir: busy })).toThrow(/not empty/);
    expect(() => mirror.configure({ dir: w.dir })).toThrow(/library itself/);
    expect(() => mirror.configure({ dir: 'relative/path' })).toThrow(/full path/);
  });
  it('works through the API', async () => {
    const w = world(); await seed(w);
    const on = await w.app.request('/api/admin/mirror', { method: 'POST', headers: json, body: JSON.stringify({ enabled: true, dir: join(w.dir, 'm2') }) });
    const s = await on.json() as { enabled: boolean; last: { linked: number } };
    expect(s.enabled).toBe(true); expect(s.last.linked).toBe(2);
    const bad = await w.app.request('/api/admin/mirror', { method: 'POST', headers: json, body: JSON.stringify({ dir: 'nope' }) });
    expect(bad.status).toBe(400);
  });
});

describe('exports', () => {
  it('the readable archive holds the tree, playlists, csv and json (long paths too)', async () => {
    const w = world(); await seed(w);
    const res = await w.app.request('/api/export/library', { headers: auth });
    expect(res.status).toBe(200);
    const tar = Buffer.from(await res.arrayBuffer());
    expect(Number(res.headers.get('Content-Length'))).toBe(tar.length);
    const got = new Map<string, string>();
    for await (const e of readTar((async function* () { yield tar; })())) { const o: Buffer[] = []; for await (const c of e.body) o.push(c); got.set(e.name, Buffer.concat(o).toString()); }
    expect(got.get('Music/Nova Sky/First/01 One.mp3')).toBe('song-one');
    expect(got.get('Playlists/Mix.m3u8')).toContain('#EXTM3U');
    expect(got.get('tracks.csv')).toContain('One,Nova Sky,First,1,');
    expect(JSON.parse(got.get('library.json')!).tables.tracks).toHaveLength(2);
    expect(got.has('README.txt')).toBe(true);
    const lite = Buffer.from(await (await w.app.request('/api/export/library?audio=0', { headers: auth })).arrayBuffer());
    expect(lite.length).toBeLessThan(tar.length);
  });
  it('data downloads: json and csv', async () => {
    const w = world(); await seed(w);
    const j = await (await w.app.request('/api/export/data', { headers: auth })).json() as { format: string };
    expect(j.format).toBe('turbomusic-export');
    const csv = await (await w.app.request('/api/export/data?format=csv', { headers: auth })).text();
    expect(csv.split('\n')[0]).toContain('title,artist,album');
  });
  it('tar keeps names over 100 characters by splitting them at a folder', async () => {
    const long = `${'a'.repeat(60)}/${'b'.repeat(60)}/${'c'.repeat(50)}.mp3`;
    const chunks: Buffer[] = [];
    for await (const c of tarChunks([{ name: long, size: 3, data: Buffer.from('abc') }])) chunks.push(c);
    const names: string[] = [];
    for await (const e of readTar((async function* () { yield Buffer.concat(chunks); })())) { names.push(e.name); for await (const _ of e.body) void _; }
    expect(names).toEqual([long]);
  });
});
