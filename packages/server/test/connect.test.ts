import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConnectHub, parseCommand, parseSnapshot, type ServerEvent } from '../src/connect.ts';
import { createApp } from '../src/app.ts';
import { Store } from '../src/db.ts';
import { loadConfig } from '../src/config.ts';

const snap = { trackId: 't1', queue: { user: ['a'], active: ['b', 'c'], currentId: 't1' }, source: { type: 'album', id: 'al' }, history: [], position: 12.5, duration: 200, playing: true, volume: 0.5 };

describe('ConnectHub', () => {
  afterEach(() => vi.useRealTimers());

  it('lists connected devices with their state and tells every stream when it changes', () => {
    const hub = new ConnectHub();
    const a: ServerEvent[] = [], b: ServerEvent[] = [];
    hub.connect({ id: 'phone', name: 'Phone', kind: 'android' }, (e) => a.push(e));
    hub.connect({ id: 'pc', name: 'Desktop', kind: 'electron' }, (e) => b.push(e));
    expect(hub.list().map((d) => d.id)).toEqual(['pc', 'phone']); // by name: Desktop, Phone
    expect(hub.report('phone', parseSnapshot(snap))).toBe(true);
    const last = b.at(-1) as Extract<ServerEvent, { type: 'devices' }>;
    expect(last.devices.find((d) => d.id === 'phone')?.state?.trackId).toBe('t1');
    expect(hub.report('ghost', null)).toBe(false);
  });

  it('delivers a command only to the target, and refuses an offline target', () => {
    const hub = new ConnectHub();
    const got: ServerEvent[] = [], other: ServerEvent[] = [];
    hub.connect({ id: 'a', name: 'A', kind: 'web' }, (e) => got.push(e));
    hub.connect({ id: 'b', name: 'B', kind: 'web' }, (e) => other.push(e));
    const before = other.length;
    expect(hub.command('b', 'a', { type: 'pause' })).toBe(true);
    expect(got.at(-1)).toEqual({ type: 'command', from: 'b', command: { type: 'pause' } });
    expect(other.length).toBe(before);
    expect(hub.command('a', 'nobody', { type: 'next' })).toBe(false);
  });

  it('keeps a device for a grace period after its stream drops, so a reload does not lose it', () => {
    vi.useFakeTimers();
    const hub = new ConnectHub(1000);
    const close = hub.connect({ id: 'a', name: 'A', kind: 'web' }, () => undefined);
    hub.report('a', parseSnapshot(snap));
    close();
    vi.advanceTimersByTime(500);
    expect(hub.list()).toHaveLength(1);
    hub.connect({ id: 'a', name: 'A', kind: 'web' }, () => undefined); // reconnects in time
    vi.advanceTimersByTime(2000);
    expect(hub.list()[0].state?.trackId).toBe('t1');
    const gone = new ConnectHub(1000);
    gone.connect({ id: 'x', name: 'X', kind: 'web' }, () => undefined)();
    vi.advanceTimersByTime(1500);
    expect(gone.list()).toHaveLength(0);
  });

  it('validates what clients send', () => {
    expect(parseCommand({ type: 'seek', time: -5 })).toEqual({ type: 'seek', time: 0 });
    expect(parseCommand({ type: 'volume', value: 7 })).toEqual({ type: 'volume', value: 1 });
    expect(parseCommand({ type: 'enqueue', trackId: 't1', where: 'next' })).toEqual({ type: 'enqueue', trackId: 't1', where: 'next' });
    expect(parseCommand({ type: 'enqueue', trackId: 't1', where: 'x' })).toEqual({ type: 'enqueue', trackId: 't1', where: 'last' });
    expect(parseCommand({ type: 'enqueue', trackId: '' })).toBeNull();
    expect(parseCommand({ type: 'rm -rf' })).toBeNull();
    expect(parseCommand({ type: 'transfer', snapshot: 'x' })).toBeNull();
    expect(parseSnapshot({ queue: { user: ['a', 5, null] }, position: 'x' })?.queue.user).toEqual(['a']);
  });
});

describe('connect over HTTP', () => {
  let dir: string, store: Store;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'turbomusic-connect-')); });
  afterEach(() => { store?.close(); rmSync(dir, { recursive: true, force: true }); });

  it('streams the device list as server-sent events and relays a command', async () => {
    const config = loadConfig({ TURBOMUSIC_DATA_DIR: dir, TURBOMUSIC_TOKEN: 'tok' } as never);
    store = new Store(config.dataDir);
    const app = createApp(config, store);
    const auth = { Authorization: 'Bearer tok', 'Content-Type': 'application/json' };
    expect((await app.request('/api/connect/stream?device=x')).status).toBe(401);

    const ctl = new AbortController();
    const res = await app.request('/api/connect/stream?device=tv&name=Living%20room&kind=web', { headers: auth, signal: ctl.signal });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.getReader();
    const read = async (until: string) => {
      let text = '';
      for (let i = 0; i < 20 && !text.includes(until); i++) text += new TextDecoder().decode((await reader.read()).value);
      return text;
    };
    expect(await read('Living room')).toContain('"devices"');

    const cmd = await app.request('/api/connect/command', { method: 'POST', headers: auth, body: JSON.stringify({ from: 'phone', to: 'tv', command: { type: 'seek', time: 30 } }) });
    expect(cmd.status).toBe(200);
    expect(await read('"seek"')).toContain('"from":"phone"');

    const offline = await app.request('/api/connect/command', { method: 'POST', headers: auth, body: JSON.stringify({ from: 'phone', to: 'nobody', command: { type: 'next' } }) });
    expect(offline.status).toBe(404);
    ctl.abort();
    await reader.cancel().catch(() => undefined);
  });
});

describe('now playing', () => {
  it('is the device that is playing, moved on by the time since it reported, with its meta', () => {
    const hub = new ConnectHub();
    hub.connect({ id: 'pc', name: 'Desktop', kind: 'electron' }, () => undefined);
    hub.connect({ id: 'phone', name: 'Phone', kind: 'android' }, () => undefined);
    expect(hub.nowPlaying()).toBeNull();
    hub.report('phone', parseSnapshot({ ...snap, trackId: 'old', playing: false, meta: { title: 'Old', artist: 'X', album: 'Y', cover: null } }));
    hub.report('pc', parseSnapshot({ ...snap, meta: { title: 'Song', artist: 'Ann', album: 'LP', cover: 'a'.repeat(64) } }));
    const np = hub.nowPlaying(Date.now() + 5000)!;
    expect(np.trackId).toBe('t1');
    expect(np.meta?.title).toBe('Song');
    expect(np.position).toBeGreaterThan(17);
    expect(np.position).toBeLessThan(18.5);
    expect(np.device).toBe('Desktop');
    expect(np.deviceId).toBe('pc');
  });
  it('drops a cover that is not a file hash', () => {
    expect(parseSnapshot({ ...snap, meta: { title: 'T', artist: 'A', album: '', cover: '../../etc' } })?.meta?.cover).toBeNull();
  });
});
