import { describe, expect, it } from 'vitest';
import type { SyncRecord } from '@turbomusic/core';
import { buildLibrary } from '../src/lib/library.ts';
import { combinePreReleases, buildListens } from '../src/lib/listens.ts';

const rec = (table: string, id: string, data: object): SyncRecord => ({ table: table as never, id, updatedAt: 1, deviceId: 'd', deleted: false, data: data as never });
const rows = (...rs: SyncRecord[]) => {
  const out: Record<string, Map<string, SyncRecord>> = Object.fromEntries(
    ['artists', 'eras', 'noteCategories', 'albums', 'releases', 'tracks', 'playlists', 'groups', 'genres', 'roleCategories', 'timeline', 'votes', 'playbackLogs', 'profiles', 'notes', 'releaseNames', 'memoryLogs'].map((t) => [t, new Map()]));
  for (const r of rs) out[r.table].set(r.id, r);
  return out;
};
const track = (title: string, extra: object = {}) => ({ title, credits: [{ artistId: 'a', role: ['Lead artist'] }], genres: [], albums: [], file: null, initialRating: null, syncWithAlbumCredits: false, ...extra });
const log = (id: string, trackId: string, t: number) => rec('playbackLogs', id, { trackId, timestamp: t, duration: 200, isSkip: false });

describe('pre-release tracks', () => {
  const base = [rec('artists', 'a', { name: 'Artist', image: null }), rec('tracks', 'rel', track('Song', { file: 'aaa' })), rec('tracks', 'pre', track('Song', { file: 'bbb', preReleaseOf: 'rel' })), rec('tracks', 'other', track('Other'))];
  it('hides a tied pre-release from the lists but keeps it findable, marked [U]', () => {
    const lib = buildLibrary(rows(...base) as never);
    expect(lib.tracks.map((t) => t.id).sort()).toEqual(['other', 'rel']);
    expect(lib.singles.map((t) => t.id)).not.toContain('pre');
    expect(lib.trackById.get('pre')?.title).toBe('Song [U]');
    expect(lib.trackById.get('rel')?.preReleaseIds).toEqual(['pre']);
  });
  it('plays the pre-release audio only when it was chosen by hand', () => {
    expect(buildLibrary(rows(...base) as never).trackById.get('rel')?.file).toBe('aaa');
    const chosen = base.map((r) => (r.id === 'rel' ? rec('tracks', 'rel', track('Song', { file: 'aaa', primaryAudioFrom: 'pre' })) : r));
    expect(buildLibrary(rows(...chosen) as never).trackById.get('rel')?.file).toBe('bbb');
  });
  it('ignores a link to a missing track, to itself, or to another pre-release; unlinking makes it ordinary', () => {
    const bad = [rec('artists', 'a', { name: 'A', image: null }), rec('tracks', 'x', track('X', { preReleaseOf: 'nope' })), rec('tracks', 'y', track('Y', { preReleaseOf: 'y' })), rec('tracks', 'p', track('P', { preReleaseOf: 'q' })), rec('tracks', 'q', track('Q', { preReleaseOf: 'x' }))];
    const lib = buildLibrary(rows(...bad) as never);
    expect(lib.tracks.map((t) => t.id).sort()).toEqual(['p', 'q', 'x', 'y']);
    const unlinked = base.map((r) => (r.id === 'pre' ? rec('tracks', 'pre', track('Song', { file: 'bbb', preReleaseOf: null })) : r));
    expect(buildLibrary(rows(...unlinked) as never).tracks.map((t) => t.id)).toContain('pre');
  });
  it('stats list the [U] version apart unless the plays are combined', () => {
    const lib = buildLibrary(rows(...base, log('l1', 'rel', 1), log('l2', 'pre', 2)) as never);
    const l = buildListens(lib);
    expect(l.map((x) => x.title)).toEqual(['Song', 'Song [U]']);
    expect(combinePreReleases(lib, l).map((x) => [x.trackId, x.title])).toEqual([['rel', 'Song'], ['rel', 'Song']]);
  });
});
