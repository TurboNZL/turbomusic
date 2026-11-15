import { describe, expect, it } from 'vitest';
import { artistWeights, bucketMix, decadeBuckets, deepCuts, forgottenFavourites, genreBuckets, hiddenGems, mixOfTheDay, seeded, spread, unfinishedAlbums, type MixTrack, type Plays } from '../src/lib/discoverMixes.ts';

const DAY = 86_400_000;
const T = (id: string, rating: number, o: Partial<MixTrack> = {}): MixTrack => ({ id, title: id, rating, artistId: `ar-${id[0]}`, albumId: null, genres: [], ...o });
const plays = (count: Record<string, number>, last: Record<string, number> = {}): Plays => ({ count: new Map(Object.entries(count)), last: new Map(Object.entries(last)) });

describe('discover mixes', () => {
  it('seeded is repeatable', () => { const a = seeded(7), b = seeded(7); expect([a(), a(), a()]).toEqual([b(), b(), b()]); });
  it('spread limits an artist and an album', () => {
    const ts = [T('a1', 9, { albumId: 'x' }), T('a2', 9, { albumId: 'x' }), T('a3', 9, { albumId: 'x' }), T('b1', 9)];
    expect(spread(ts, 2, 2).map((t) => t.id)).toEqual(['a1', 'a2', 'b1']);
  });
  it('hidden gems: well rated and barely played, never the over-played', () => {
    const ts = [T('a1', 9), T('b1', 8), T('c1', 9), T('d1', 5)];
    expect(hiddenGems(ts, plays({ a1: 1, b1: 20 })).map((t) => t.id)).toEqual(['a1', 'c1']);
  });
  it('forgotten favourites: loved, played before, quiet for a while', () => {
    const now = 100 * DAY;
    const ts = [T('a1', 9), T('b1', 9), T('c1', 9), T('d1', 6)];
    expect(forgottenFavourites(ts, plays({ a1: 3, b1: 3, d1: 3 }, { a1: now - 40 * DAY, b1: now - 2 * DAY, d1: now - 90 * DAY }), now).map((t) => t.id)).toEqual(['a1']);
  });
  it('deep cuts: unheard songs by artists you like', () => {
    const ts = [T('a1', 9), T('a2', 0), T('b1', 0), T('a3', 8)];
    const w = artistWeights(ts);
    expect(deepCuts(ts, plays({ a1: 1, a3: 1 }), w).map((t) => t.id)).toEqual(['a2']); // b1's artist has no rated track: weight 0
  });
  it('the mix of the day is the same all day and changes tomorrow', () => {
    const ts = Array.from({ length: 80 }, (_, i) => T(`${String.fromCharCode(97 + (i % 20))}${i}`, 5 + (i % 6), { albumId: `al${i % 15}` }));
    const p = plays(Object.fromEntries(ts.slice(0, 40).map((t, i) => [t.id, 1 + (i % 4)])), Object.fromEntries(ts.slice(0, 40).map((t) => [t.id, 0])));
    const noon = new Date(2026, 10, 15, 12).getTime();
    const a = mixOfTheDay(ts, p, noon).map((t) => t.id), b = mixOfTheDay(ts, p, noon + 3 * 3600_000).map((t) => t.id), c = mixOfTheDay(ts, p, noon + DAY).map((t) => t.id);
    expect(a.length).toBeGreaterThan(10);
    expect(b).toEqual(a);
    expect(c).not.toEqual(a);
    expect(new Set(a).size).toBe(a.length);
  });
  it('genre and decade buckets need enough tracks', () => {
    const ts = Array.from({ length: 10 }, (_, i) => T(`t${i}`, 7, { genres: ['Hip Hop'], releaseDate: '2014-05-01' })).concat([T('x', 7, { genres: ['Jazz'], releaseDate: '1971' })]);
    expect(genreBuckets(ts).map((b) => b.label)).toEqual(['Hip Hop']);
    expect(decadeBuckets(ts).map((b) => b.label)).toEqual(['2010s']);
    expect(bucketMix(genreBuckets(ts)[0], 0, 5)).toHaveLength(5);
  });
  it('unfinished albums are started but not done, most-heard first', () => {
    const albums = [{ id: 'a', trackIds: ['1', '2', '3', '4'] }, { id: 'b', trackIds: ['5', '6', '7'] }, { id: 'c', trackIds: ['8', '9', '10'] }, { id: 'd', trackIds: ['11', '12'] }];
    const heard = new Set(['1', '2', '3', '5', '6', '11']);
    expect(unfinishedAlbums(albums, heard, () => true).map((u) => u.albumId)).toEqual(['a', 'b']);
  });
});
