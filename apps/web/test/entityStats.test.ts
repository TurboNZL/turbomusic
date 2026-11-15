import { describe, expect, it } from 'vitest';
import type { SyncRecord } from '@turbomusic/core';
import { buildLibrary } from '../src/lib/library.ts';
import { entityStats, entityTrackIds, liveListen, summarizeRatings, tallyVotes } from '../src/lib/entityStats.ts';

const rec = (table: string, id: string, data: object): SyncRecord => ({ table: table as never, id, updatedAt: 1, deviceId: 'd', deleted: false, data: data as never });
const rows = (...rs: SyncRecord[]) => {
  const out: Record<string, Map<string, SyncRecord>> = Object.fromEntries(
    ['artists', 'eras', 'noteCategories', 'albums', 'releases', 'tracks', 'playlists', 'groups', 'genres', 'roleCategories', 'timeline', 'votes', 'playbackLogs', 'profiles', 'notes'].map((t) => [t, new Map()]));
  for (const r of rs) out[r.table].set(r.id, r);
  return out;
};
const lead = (artistId: string) => [{ artistId, role: ['Lead artist'] }];
const track = (id: string, artist: string, albums: object[] = []) => rec('tracks', id, { title: id, credits: lead(artist), genres: [], albums, file: 'f' + id, initialRating: null, syncWithAlbumCredits: false });

const lib = buildLibrary(rows(
  rec('artists', 'a', { name: 'Ann', image: null }), rec('artists', 'b', { name: 'Bob', image: null }),
  track('t1', 'a', [{ albumId: 'al', order: 0 }]), track('t2', 'a', [{ albumId: 'al', order: 1 }]), track('t3', 'b'),
  rec('albums', 'al', { title: 'Album', credits: lead('a'), genres: [], cover: null, trackOrder: ['t1', 't2'] }),
  rec('eras', 'e', { name: 'Era', description: null, cover: null, albumIds: ['al'], trackIds: ['t3', 't1'], playlistIds: [] }),
  rec('playlists', 'p', { name: 'PL', description: null, cover: null, createdAt: 1, trackIds: ['t3', 'gone', 't3'] }),
  rec('votes', 'v1', { trackAId: 't1', trackBId: 't3', winnerId: 't1', isEqual: false, timestamp: 1 }),
  rec('votes', 'v2', { trackAId: 't2', trackBId: 't3', winnerId: null, isEqual: true, timestamp: 2 }),
  rec('votes', 'v3', { trackAId: 't1', trackBId: '', winnerId: null, isEqual: false, boost: -1, timestamp: 3 }),
  rec('playbackLogs', 'l1', { trackId: 't1', timestamp: 100, duration: 200, isSkip: false }),
  rec('playbackLogs', 'l2', { trackId: 't1', timestamp: 200, duration: 5, isSkip: true }),
  rec('playbackLogs', 'l3', { trackId: 't3', timestamp: 300, duration: 100, isSkip: false }),
));

describe('which tracks an entity stands for', () => {
  it('track, album, artist, era (deduped), playlist (existing, once) and unknown ids', () => {
    expect(entityTrackIds(lib, 'track', 't1')).toEqual(['t1']);
    expect(entityTrackIds(lib, 'album', 'al')).toEqual(['t1', 't2']);
    expect(entityTrackIds(lib, 'artist', 'a')).toEqual(['t1', 't2']);
    expect([...entityTrackIds(lib, 'era', 'e')!].sort()).toEqual(['t1', 't2', 't3']);
    expect(entityTrackIds(lib, 'playlist', 'p')).toEqual(['t3']);
    expect(entityTrackIds(lib, 'album', 'nope')).toBeNull();
  });
});

describe('collection numbers', () => {
  it('counts only the plays of its own tracks', () => {
    const s = entityStats(lib, ['t1', 't2']);
    expect(s.listen.plays).toBe(2);
    expect(s.listen.skips).toBe(1);
    expect(s.playsByTrack.get('t1')?.plays).toBe(2);
    expect(s.withAudio).toBe(2);
  });
  it('sums wins, losses and draws; a thumb is a win or a loss; a match inside the set counts both sides', () => {
    expect(tallyVotes(lib, new Set(['t1']))).toEqual({ wins: 1, losses: 1, draws: 0 });
    expect(tallyVotes(lib, new Set(['t2', 't3']))).toEqual({ wins: 0, losses: 1, draws: 2 });
    expect(tallyVotes(lib, new Set(['t1', 't3']))).toEqual({ wins: 1, losses: 2, draws: 1 });
  });
  it('rating summary ignores unrated tracks', () => {
    const r = summarizeRatings(lib.tracks);
    expect(r.rated).toBe(r.histogram.reduce((a, b) => a + b, 0));
    expect(summarizeRatings([]).avg).toBeNull();
  });
});

describe('the play in progress', () => {
  it('counts once it passes the minimum and stops counting when it is cut back', () => {
    const base = entityStats(lib, ['t2'], 30_000).listen.plays;
    expect(entityStats(lib, ['t2'], 30_000, false, liveListen(lib, 't2', 12)).listen.plays).toBe(base);
    expect(entityStats(lib, ['t2'], 30_000, false, liveListen(lib, 't2', 45)).listen.plays).toBe(base + 1);
    expect(entityStats(lib, ['t2'], 30_000, false, liveListen(lib, 't2', 4)).listen.plays).toBe(base);
  });
  it('is nothing when no track plays', () => {
    expect(liveListen(lib, null, 50)).toBeNull();
    expect(liveListen(lib, 'gone', 50)).toBeNull();
  });
});
