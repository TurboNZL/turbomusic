import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createApp } from '../src/app.ts';
import { Store } from '../src/db.ts';
import { loadConfig } from '../src/config.ts';

let dir: string, store: Store, app: ReturnType<typeof createApp>;
const TOKEN = 't0ken';
const auth = { Authorization: `Bearer ${TOKEN}` };
const rec = (id: string, updatedAt: number, deviceId = 'd1', extra: object = {}) =>
  ({ table: 'tracks', id, updatedAt, deviceId, deleted: false, data: { title: id, ...extra } });
const push = (records: unknown[]) =>
  app.request('/api/sync/push', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ records }) });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'turbomusic-'));
  const config = loadConfig({ TURBOMUSIC_DATA_DIR: dir, TURBOMUSIC_TOKEN: TOKEN } as never);
  store = new Store(config.dataDir);
  app = createApp(config, store);
});
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });

describe('now playing widget', () => {
  it('serves the page only with the token, and the API says nothing is playing', async () => {
    expect((await app.request('/widget')).status).toBe(401);
    expect((await app.request('/widget?token=wrong')).status).toBe(401);
    const page = await app.request(`/widget?token=${TOKEN}`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('/api/nowplaying');
    expect((await app.request('/api/nowplaying')).status).toBe(401);
    expect(await (await app.request(`/api/nowplaying?token=${TOKEN}`)).json()).toEqual({ track: null });
    const post = (type: string) => app.request('/api/nowplaying/command', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ type }) });
    expect((await post('toggle')).status).toBe(404); // nothing connected
    expect((await post('volume')).status).toBe(400);
  });
});

describe('config', () => {
  it('defaults to an obscure port and generates a persisted token', () => {
    const d = mkdtempSync(join(tmpdir(), 'turbomusic-cfg-'));
    const a = loadConfig({ TURBOMUSIC_DATA_DIR: d } as never), b = loadConfig({ TURBOMUSIC_DATA_DIR: d } as never);
    expect(a.port).toBe(47813);
    expect(a.token.length).toBeGreaterThan(20);
    expect(b.token).toBe(a.token);
    expect(() => loadConfig({ TURBOMUSIC_DATA_DIR: d, TURBOMUSIC_PORT: '99999' } as never)).toThrow();
    rmSync(d, { recursive: true, force: true });
  });
});

describe('auth', () => {
  it('health is open, everything else needs the token', async () => {
    expect((await app.request('/api/health')).status).toBe(200);
    expect((await app.request('/api/status')).status).toBe(401);
    expect((await app.request('/api/status', { headers: { Authorization: 'Bearer nope' } })).status).toBe(401);
    expect((await app.request('/api/status', { headers: auth })).status).toBe(200);
    expect((await app.request(`/api/status?token=${TOKEN}`)).status).toBe(200);
  });
});

describe('sync', () => {
  it('round-trips records and paginates by cursor', async () => {
    await push([rec('a', 1), rec('b', 2), rec('c', 3)]);
    const p1 = await (await app.request('/api/sync/pull?since=0&limit=2', { headers: auth })).json() as any;
    expect(p1.records.map((r: any) => r.id)).toEqual(['a', 'b']);
    expect(p1.more).toBe(true);
    const p2 = await (await app.request(`/api/sync/pull?since=${p1.cursor}`, { headers: auth })).json() as any;
    expect(p2.records.map((r: any) => r.id)).toEqual(['c']);
    expect(p2.more).toBe(false);
  });

  it('last-writer-wins with deterministic tie-break; losers are not echoed back', async () => {
    await push([rec('t', 10, 'a', { title: 'new' })]);
    const stale = await (await push([rec('t', 5, 'b', { title: 'old' })])).json() as any;
    expect(stale.applied).toBe(0);
    await push([rec('t', 10, 'z', { title: 'tie' })]);
    const pulled = await (await app.request('/api/sync/pull?since=0', { headers: auth })).json() as any;
    expect(pulled.records).toHaveLength(1);
    expect(pulled.records[0].data.title).toBe('tie');
  });

  it('tombstones propagate', async () => {
    await push([rec('t', 1)]);
    await push([{ ...rec('t', 2), deleted: true, data: {} }]);
    const pulled = await (await app.request('/api/sync/pull?since=0', { headers: auth })).json() as any;
    expect(pulled.records[0].deleted).toBe(true);
  });

  it('rejects malformed pushes', async () => {
    expect((await push([{ table: 'nope', id: 'x', updatedAt: 1 }])).status).toBe(400);
  });
});

describe('files', () => {
  const bytes = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251));
  const hash = createHash('sha256').update(bytes).digest('hex');
  const put = (h: string, body: Buffer) => app.request(`/api/files/${h}`, { method: 'PUT', headers: { ...auth, 'Content-Type': 'audio/mpeg' }, body });

  it('stores by hash, is idempotent, serves with the right mime', async () => {
    expect((await put(hash, bytes)).status).toBe(200);
    expect(((await (await put(hash, bytes)).json()) as any).existed).toBe(true);
    const res = await app.request(`/api/files/${hash}`, { headers: auth });
    expect(res.headers.get('content-type')).toBe('audio/mpeg');
    expect(Buffer.from(await res.arrayBuffer()).equals(bytes)).toBe(true);
  });

  it('rejects a body that does not match its hash and leaves no temp files', async () => {
    const res = await put(hash, Buffer.from('tampered'));
    expect(res.status).toBe(422);
    expect(store.hasFile(hash)).toBe(false);
    expect(readdirSync(join(dir, 'tmp'))).toEqual([]);
  });

  it('rejects non-sha256 names (no path traversal)', async () => {
    expect((await put('not-a-hash', bytes)).status).toBe(400);
    expect((await put('..%2f..%2fetc%2fpasswd', bytes)).status).toBe(400);
    expect((await put('../../etc/passwd', bytes)).status).toBe(404); // normalised away before routing
    expect((await app.request('/api/files/..%2f..%2fetc%2fpasswd', { headers: auth })).status).toBe(404);
  });

  it('supports range requests for seeking', async () => {
    await put(hash, bytes);
    const r = await app.request(`/api/files/${hash}`, { headers: { ...auth, Range: 'bytes=10-19' } });
    expect(r.status).toBe(206);
    expect(r.headers.get('content-range')).toBe('bytes 10-19/1000');
    expect(Buffer.from(await r.arrayBuffer()).equals(bytes.subarray(10, 20))).toBe(true);
    const tail = await app.request(`/api/files/${hash}`, { headers: { ...auth, Range: 'bytes=-5' } });
    expect(Buffer.from(await tail.arrayBuffer()).equals(bytes.subarray(995))).toBe(true);
    expect((await app.request(`/api/files/${hash}`, { headers: { ...auth, Range: 'bytes=5000-' } })).status).toBe(416);
  });

  it('enforces the upload size cap', async () => {
    const small = loadConfig({ TURBOMUSIC_DATA_DIR: dir, TURBOMUSIC_TOKEN: TOKEN, TURBOMUSIC_MAX_UPLOAD_MB: '0' } as never);
    const a = createApp(small, store);
    const res = await a.request(`/api/files/${hash}`, { method: 'PUT', headers: auth, body: bytes });
    expect(res.status).toBe(413);
  });
});

describe('web client hosting', () => {
  it('serves index.html with SPA fallback, assets safely, and keeps /api JSON', async () => {
    const web = mkdtempSync(join(tmpdir(), 'turbomusic-web-'));
    mkdirSync(join(web, 'assets'));
    writeFileSync(join(web, 'index.html'), '<html>app</html>');
    writeFileSync(join(web, 'assets', 'a.js'), 'x');
    const cfg = loadConfig({ TURBOMUSIC_DATA_DIR: dir, TURBOMUSIC_TOKEN: TOKEN, TURBOMUSIC_WEB_DIR: web } as never);
    const a = createApp(cfg, store);
    expect(await (await a.request('/')).text()).toBe('<html>app</html>');
    expect(await (await a.request('/albums/123')).text()).toBe('<html>app</html>');
    const js = await a.request('/assets/a.js');
    expect(js.headers.get('content-type')).toContain('javascript');
    expect(js.headers.get('cache-control')).toContain('immutable');
    expect(await (await a.request('/assets/../../etc/passwd')).text()).toBe('<html>app</html>');
    expect((await a.request('/api/nope', { headers: auth })).status).toBe(404);
    expect((await a.request('/api/health')).headers.get('content-type')).toContain('json');
    rmSync(web, { recursive: true, force: true });
  });
});

describe('update server', () => {
  it('is unavailable without a script and runs one when configured', async () => {
    expect((await app.request('/api/admin/update', { headers: auth })).status).toBe(200);
    const off = await (await app.request('/api/admin/update', { headers: auth })).json() as { available: boolean };
    expect(off.available).toBe(false);
    expect((await app.request('/api/admin/update', { method: 'POST', headers: auth })).status).toBe(404);

    const script = join(dir, 'repo', 'scripts', 'update.sh');
    mkdirSync(join(dir, 'repo', 'scripts'), { recursive: true });
    writeFileSync(script, '#!/usr/bin/env bash\necho "args: $@"\necho step two\n');
    let exited = false;
    const { Updater } = await import('../src/update.ts');
    const app2 = createApp(loadConfig({ TURBOMUSIC_DATA_DIR: dir, TURBOMUSIC_TOKEN: TOKEN } as never), store, undefined, undefined, undefined, new Updater({ script, restart: true, exit: () => { exited = true; }, exitDelayMs: 10 }));
    expect((await app2.request('/api/admin/update', { method: 'POST', headers: auth })).status).toBe(202);
    expect((await app2.request('/api/admin/update', { method: 'POST', headers: auth })).status).toBe(409);
    let st: { status: string; log: string[]; restarting: boolean } = { status: 'running', log: [], restarting: false };
    for (let i = 0; i < 50 && st.status === 'running'; i++) { await new Promise((r) => setTimeout(r, 40)); st = await (await app2.request('/api/admin/update', { headers: auth })).json() as typeof st; }
    expect(st.status).toBe('done');
    expect(st.log).toEqual(['args: --live', 'step two']);
    expect(st.restarting).toBe(true);
    await new Promise((r) => setTimeout(r, 60));
    expect(exited).toBe(true);
  });
  it('reports a failing script', async () => {
    const script = join(dir, 'fail.sh');
    writeFileSync(script, '#!/usr/bin/env bash\necho boom >&2\nexit 3\n');
    const { Updater } = await import('../src/update.ts');
    const u = new Updater({ script, restart: true, exit: () => { throw new Error('must not restart'); } });
    expect(u.start()).toBe(true);
    for (let i = 0; i < 50 && u.state().status === 'running'; i++) await new Promise((r) => setTimeout(r, 40));
    expect(u.state().status).toBe('error');
    expect(u.state().log.at(-1)).toContain('code 3');
  });
});
