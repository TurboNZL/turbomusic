import { describe, expect, it } from 'vitest';
import type { SyncRecord, TrackData, AlbumData } from '@turbomusic/core';
import { buildLibrary } from '../src/lib/library.ts';
import { planMergeAlbums, planMergeArtists, remapCredits } from '../src/lib/mergeEntities.ts';

const rec = (table: string, id: string, data: object): SyncRecord => ({ table: table as never, id, updatedAt: 1, deviceId: 'd', deleted: false, data: data as never });
const rows = (...rs: SyncRecord[]) => {
  const out: Record<string, Map<string, SyncRecord>> = Object.fromEntries(
    ['artists', 'eras', 'noteCategories', 'albums', 'releases', 'tracks', 'playlists', 'groups', 'genres', 'roleCategories', 'timeline', 'votes', 'playbackLogs', 'profiles', 'notes', 'releaseNames', 'memoryLogs'].map((t) => [t, new Map()]));
  for (const r of rs) out[r.table].set(r.id, r);
  return out;
};
const lead = (a: string, ...more: string[]) => [{ artistId: a, role: ['Lead artist'] }, ...more.map((m) => ({ artistId: m, role: ['Producer'] }))];
const trk = (title: string, album: string, credits: object[]) => ({ title, credits, genres: [], albums: [{ albumId: album, order: 0 }], file: null, initialRating: null, spotifyUrl: null, geniusUrl: null, youtubeMusicUrl: null, bitrate: null, memories: 0, syncWithAlbumCredits: false, queueRules: {} });
const records = [
  rec('artists', 'a', { name: 'The Weeknd', image: null }), rec('artists', 'a2', { name: 'Weeknd', image: 'pic', aliases: ['Abel'] }),
  rec('albums', 'x', { title: 'X', credits: lead('a'), genres: ['pop'], cover: null, covers: ['c1'] }),
  rec('albums', 'y', { title: 'X (Deluxe)', credits: lead('a2'), genres: ['rnb'], cover: null, covers: ['c2'] }),
  rec('tracks', '1', trk('One', 'x', lead('a'))), rec('tracks', '2', trk('Two', 'y', lead('a2', 'a'))),
  rec('releases', 'r1', { albumId: 'x', title: '', cover: null, releaseDate: null, trackIds: ['1'] }),
  rec('releases', 'r2', { albumId: 'y', title: '', cover: 'c2', releaseDate: '2020-01-01', trackIds: ['2'] }),
  rec('playlists', 'pl', { name: 'P', description: null, cover: null, createdAt: 1, kind: 'albums', albumIds: ['x', 'y'], trackIds: [] }),
  rec('groups', 'g', { title: 'n', text: '', categoryIds: [], members: [{ entityType: 'artist', entityId: 'a2' }, { entityType: 'artist', entityId: 'a' }] }),
];
const lib = buildLibrary(rows(...records));
const stored = { tracks: records.filter((r) => r.table === 'tracks').map((r) => ({ id: r.id, data: r.data as unknown as TrackData })), albums: records.filter((r) => r.table === 'albums').map((r) => ({ id: r.id, data: r.data as unknown as AlbumData })) };

describe('merging artists by hand', () => {
  it('remaps credits and joins the roles of credits that become one', () => {
    expect(remapCredits([{ artistId: 'a2', role: ['Lead artist'] }, { artistId: 'a', role: ['Producer'] }], new Set(['a2']), 'a')).toEqual([{ artistId: 'a', role: ['Lead artist', 'Producer'] }]);
    expect(remapCredits([{ artistId: 'z', role: [] }], new Set(['a2']), 'a')).toBeNull();
  });
  it('points tracks, albums and notes at the kept artist and keeps the other names as aliases', () => {
    const p = planMergeArtists(lib, 'a', ['a2'], stored)!;
    expect(p.keepPatch.aliases).toEqual(['Weeknd', 'Abel']);
    expect(p.keepPatch.image).toBe('pic');
    expect(p.patches.find((x) => x.table === 'tracks' && x.id === '2')!.patch).toMatchObject({ credits: [{ artistId: 'a', role: ['Lead artist', 'Producer'] }] });
    expect(p.patches.find((x) => x.table === 'albums' && x.id === 'y')).toBeTruthy();
    expect(p.patches.find((x) => x.table === 'groups')!.patch).toEqual({ members: [{ entityType: 'artist', entityId: 'a' }] });
    expect(p.removeIds).toEqual(['a2']);
  });
  it('does nothing with only one artist', () => expect(planMergeArtists(lib, 'a', ['a'], stored)).toBeNull());
});

describe('merging albums by hand', () => {
  it('moves releases and tracks, names an unnamed release after its old album, retargets playlists', () => {
    const p = planMergeAlbums(lib, 'x', ['y'], stored)!;
    expect(p.releasePatches).toEqual([{ id: 'r2', patch: { albumId: 'x', title: 'X (Deluxe)' } }]);
    expect(p.keepPatch.trackOrder).toEqual(['1', '2']);
    expect(p.keepPatch.covers).toEqual(['c1', 'c2']);
    expect(p.keepPatch.genres).toEqual(['pop', 'rnb']);
    expect(p.trackPatches[0].patch.albums).toEqual([{ albumId: 'x', order: 1 }]);
    expect(p.playlistPatches).toEqual([{ id: 'pl', albumIds: ['x'] }]);
    expect(p.removeIds).toEqual(['y']);
  });
});
