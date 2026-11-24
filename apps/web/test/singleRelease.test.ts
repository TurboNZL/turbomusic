import { describe, expect, it } from 'vitest';
import type { SyncRecord } from '@turbomusic/core';
import { buildLibrary } from '../src/lib/library.ts';
import { planMerge, planShareVersions } from '../src/lib/mergeTracks.ts';
import { planDeleteAlbum, looseSingles } from '../src/lib/deleteOps.ts';
import { computeListenStats } from '../src/lib/listenStats.ts';
import type { Listen } from '../src/lib/listens.ts';

const rec = (table: string, id: string, data: object): SyncRecord => ({ table: table as never, id, updatedAt: 1, deviceId: 'd', deleted: false, data: data as never });
const rows = (...rs: SyncRecord[]) => {
  const out: Record<string, Map<string, SyncRecord>> = Object.fromEntries(['artists', 'eras', 'noteCategories', 'albums', 'releases', 'tracks', 'playlists', 'groups', 'genres', 'roleCategories', 'timeline', 'votes', 'playbackLogs', 'profiles', 'notes'].map((t) => [t, new Map()]));
  for (const r of rs) out[r.table].set(r.id, r);
  return out;
};
const lead = [{ artistId: 'a', role: ['Lead artist'] }];
const track = (title: string, extra: object = {}) => ({ title, credits: lead, genres: [], albums: [], file: null, initialRating: null, spotifyUrl: null, geniusUrl: null, youtubeMusicUrl: null, bitrate: null, memories: 0, syncWithAlbumCredits: false, ...extra });
const base = () => rows(
  rec('artists', 'a', { name: 'Don', image: null }),
  rec('albums', 'al', { title: 'Jackboys', credits: lead, genres: [], cover: null, trackOrder: ['t1', 't2'] }),
  rec('albums', 'al2', { title: 'Heaven', credits: lead, genres: [], cover: null, trackOrder: ['t3'] }),
  rec('releases', 'r', { albumId: 'al', title: '', cover: null, releaseDate: '2019-12-27', trackIds: ['t1', 't2'] }),
  rec('tracks', 't1', track('Had Enough', { file: 'h', albums: [{ albumId: 'al', order: 0 }] })),
  rec('tracks', 't2', track('Henny', { albums: [{ albumId: 'al', order: 1 }, { albumId: 'al2', order: 0 }] })),
  rec('tracks', 't3', track('Other title', { albums: [{ albumId: 'al2', order: 1 }] })),
  rec('tracks', 's1', track('Had Enough (single)', { cover: 'single-art', releaseDate: '2019-11-01' })),
  rec('tracks', 's2', track('Loose')),
);

describe('merging a single into an album song', () => {
  it('keeps the single as a release marked single, with its cover and date', () => {
    const lib = buildLibrary(base());
    const raw = (id: string) => base().tracks.get(id)?.data as never;
    const plan = planMerge(lib, 't1', ['s1'], raw, { keepSingle: true })!;
    expect(plan.newReleases).toEqual([{ albumId: 'al', title: '', cover: 'single-art', releaseDate: '2019-11-01', trackIds: ['t1'], single: true }]);
    expect(planMerge(lib, 't1', ['s1'], raw)!.newReleases).toEqual([]);
  });
  it('single releases stay out of the album releases and give the song its earliest date', () => {
    const r = base(); r.releases.set('sr', rec('releases', 'sr', { albumId: 'al', title: '', cover: 'c', releaseDate: '2019-11-01', trackIds: ['t1'], single: true }));
    const lib = buildLibrary(r);
    expect(lib.releases.map((x) => x.id)).toEqual(['r']);
    expect(lib.singleReleases.map((x) => x.id)).toEqual(['sr']);
    expect(lib.trackById.get('t1')!.releaseDate).toBe('2019-11-01');
  });
  it('"keep both" links the others as recordings that share the audio', () => {
    const lib = buildLibrary(base());
    const p = planShareVersions(lib, 't1', ['t3'])!;
    expect(p.patches).toEqual([{ id: 't3', patch: { versionOf: 't1', file: 'h', bitrate: null, audioCheck: null } }]);
  });
});

describe('deleting an album', () => {
  it('deletes songs only on that album, keeps ones also on another album', () => {
    const lib = buildLibrary(base());
    const links = (id: string) => (base().tracks.get(id)?.data as { albums: never }).albums;
    const p = planDeleteAlbum(lib, 'al', links, true)!;
    expect(p.deleteTrackIds).toEqual(['t1']);
    expect(p.unlink).toEqual([{ id: 't2', albums: [{ albumId: 'al2', order: 0 }] }]);
    expect(p.releaseIds).toEqual(['r']);
    expect(planDeleteAlbum(lib, 'al', links, false)!.deleteTrackIds).toEqual([]);
  });
  it('finds loose singles by kind', () => {
    const lib = buildLibrary(base());
    expect(looseSingles(lib, 'unimported', new Set()).map((t) => t.id).sort()).toEqual(['s1', 's2']);
    expect(looseSingles(lib, 'noaudio', new Set(['s2'])).map((t) => t.id).sort()).toEqual(['s1', 's2']);
    expect(looseSingles(lib, 'unplayed', new Set(['s2'])).map((t) => t.id)).toEqual(['s1']);
  });
});

describe('streaks and skipped songs', () => {
  const day = 86_400_000, t0 = new Date(2026, 0, 1, 12).getTime();
  const L = (i: number, title: string, skipped: boolean): Listen => ({ id: `l${i}`, ts: t0 + Math.floor(i / 2) * day, ms: 60_000, trackId: null, artistId: null, albumId: null, title, artist: 'x', album: '', uri: null, skipped, shuffle: null, platform: null, reasonEnd: null, source: 'turbomusic' } as unknown as Listen);
  it('lists the runs of days and the songs skipped most', () => {
    const ls = [0, 1, 2, 3, 4, 5].map((i) => L(i, 'Skippy', i < 3)).concat([L(12, 'Other', false)]);
    const s = computeListenStats(ls, {}, { now: t0 + 10 * day });
    expect(s.streaks[0]).toMatchObject({ days: 3, running: false });
    expect(s.skipped[0]).toMatchObject({ label: 'Skippy', plays: 6, skips: 3, rate: 0.5 });
    expect(s.skipped.some((r) => r.label === 'Other')).toBe(false);
  });
});
