import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SpotifyHistory, playId, playRecord } from '../src/spotifyHistory.ts';
import type { RecentPlay } from '../src/spotify.ts';
import { SpotifyAccount } from '../src/spotify.ts';

const play = (at: number, id = '7y6c07pgjZvtHI9kuMVqk1'): RecentPlay => ({ playedAt: at, uri: `spotify:track:${id}`, name: 'Song', artist: 'Artist', album: 'Album', durationMs: 200_000 });
const mk = (queue: RecentPlay[][]) => {
  const pushed: { id: string }[][] = [];
  const asked: (number | undefined)[] = [];
  const h = new SpotifyHistory(mkdtempSync(join(tmpdir(), 'sh-')), {
    status: () => ({ canHistory: true, signedIn: true }) as never,
    recentlyPlayed: async (after) => { asked.push(after); const next = queue.shift(); if (next instanceof Error) throw next; return next ?? []; },
  }, { push: (r: { id: string }[]) => { pushed.push(r); return { applied: r.length, cursor: 1 }; } } as never, { now: () => 5 });
  return { h, pushed, asked };
};

describe('the automatic history check', () => {
  it('stores new plays once and only asks for what came after the last one', async () => {
    const { h, pushed, asked } = mk([[play(2000), play(1000, 'aaaaaaaaaaaaaaaaaaaaaa')], [play(3000), play(2000)], []]);
    expect(await h.check()).toBe(2);
    expect(await h.check()).toBe(1); // 2000 was already stored; 3000 is new
    expect(await h.check()).toBe(0);
    expect(asked).toEqual([undefined, 2000, 3000]);
    expect(pushed.flat().map((r) => r.id)).toEqual([playId(play(2000)), playId(play(1000, 'aaaaaaaaaaaaaaaaaaaaaa')), playId(play(3000))]);
    expect(h.status()).toMatchObject({ added: 3, lastError: null, lastAdded: 0 });
  });
  it('marks plays as imported from the automatic check, with a stable id', () => {
    const r = playRecord(play(1234), 9);
    expect(r.id).toBe(playId(play(1234)));
    expect(r.data).toMatchObject({ imported: 'spotify', via: 'api', uri: 'spotify:track:7y6c07pgjZvtHI9kuMVqk1', duration: 200, trackId: '' });
  });
  it('keeps a failure in the status instead of throwing, and tries again next time', async () => {
    const { h } = mk([new Error('boom') as never, [play(10)]]);
    expect(await h.check()).toBe(0);
    expect(h.status().lastError).toBe('boom');
    expect(await h.check()).toBe(1);
    expect(h.status().lastError).toBeNull();
  });
});

describe('recently played from Spotify', () => {
  it('needs the extra permission, reads songs only, and prefers the album artist', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sa-'));
    let url = '';
    const f = (async (u: string) => { url = String(u); return new Response(JSON.stringify({ items: [
      { played_at: '2026-11-20T10:00:00.123Z', track: { id: 'a', uri: 'spotify:track:a', name: 'One', duration_ms: 1000, artists: [{ name: 'Feat' }], album: { name: 'Al', artists: [{ name: 'Main' }] } } },
      { played_at: '2026-11-20T09:00:00Z', track: { id: 'l', uri: 'spotify:local:x', name: 'Local', is_local: true } },
      { played_at: '2026-11-20T08:00:00Z', track: null },
    ] }), { status: 200, headers: { 'content-type': 'application/json' } }); }) as unknown as typeof fetch;
    const a = new SpotifyAccount(dir, { fetchImpl: f, now: () => 0 });
    await expect(a.recentlyPlayed()).rejects.toThrow(/permission/); // signed out / old sign-in: asks for the extra permission
    writeFileSync(join(dir, 'spotify.json'), JSON.stringify({ token: { access: 'x', refresh: 'y', expiresAt: 10 ** 12, scope: 'user-read-recently-played' } }));
    const plays = await a.recentlyPlayed(1700000000123);
    expect(url).toContain('/me/player/recently-played?limit=50&after=1700000000123');
    expect(plays).toEqual([{ playedAt: Date.parse('2026-11-20T10:00:00.123Z'), uri: 'spotify:track:a', name: 'One', artist: 'Main', album: 'Al', durationMs: 1000 }]);
  });
});
