import { describe, expect, it } from 'vitest';
import type { SyncRecord } from '@turbomusic/core';
import { buildLibrary } from '../src/lib/library.ts';
import { planSync, splitSynced } from '../src/lib/playlistSync.ts';
import type { SpotifyImportTrack } from '../src/lib/api.ts';

const rec = (table: string, id: string, data: object): SyncRecord => ({ table: table as never, id, updatedAt: 1, deviceId: 'd', deleted: false, data: data as never });
const rows = (...rs: SyncRecord[]) => {
  const out: Record<string, Map<string, SyncRecord>> = Object.fromEntries(
    ['artists', 'eras', 'noteCategories', 'albums', 'releases', 'tracks', 'playlists', 'groups', 'genres', 'roleCategories', 'timeline', 'votes', 'playbackLogs', 'profiles', 'notes', 'releaseNames', 'memoryLogs'].map((t) => [t, new Map()]));
  for (const r of rs) out[r.table].set(r.id, r);
  return out;
};
const sid = (n: number) => String(n).padStart(22, '0');
const uri = (n: number) => `spotify:track:${sid(n)}`;
const trk = (title: string, n: number | null) => ({ title, credits: [{ artistId: 'a', role: ['Lead artist'] }], genres: [], albums: [], file: null, initialRating: null, spotifyUrl: n === null ? null : `https://open.spotify.com/track/${sid(n)}`, geniusUrl: null, youtubeMusicUrl: null, bitrate: null, memories: 0, syncWithAlbumCredits: false, queueRules: {} });
const lib = buildLibrary(rows(rec('artists', 'a', { name: 'A', image: null }),
  rec('tracks', 't1', trk('One', 1)), rec('tracks', 't2', trk('Two', 2)), rec('tracks', 't3', trk('Three', 3)), rec('tracks', 'tx', trk('No link', null))));
const sp = (n: number, title = `S${n}`): SpotifyImportTrack => ({ uri: uri(n), id: sid(n), title, artists: ['A'], album: '', albumUri: null, albumArtist: 'A', durationMs: null, cover: null, releaseDate: null, trackNumber: null, isrc: null });
const link = (...ns: number[]) => ({ id: 'P'.repeat(22), syncedAt: 5, base: ns.map(uri) });

describe('planSync', () => {
  it('the first sync is a union: local order, then what only Spotify has', () => {
    const p = planSync(lib, { trackIds: ['t1', 't2'] }, [sp(2), sp(9)]);
    expect(p.local).toEqual(['t1', 't2', `uri:${uri(9)}`]);
    expect(p.remote).toEqual([uri(1), uri(2), uri(9)]);
    expect(p.create.map((c) => c.uri)).toEqual([uri(9)]);
    expect(p.push).toEqual({ added: 1, removed: 0 });
    expect(p.pull).toEqual({ added: 1, removed: 0 });
  });
  it('a track added in TurboMusic goes to Spotify, one added on Spotify comes here', () => {
    const p = planSync(lib, { trackIds: ['t1', 't2', 't3'], spotify: link(1, 2) }, [sp(1), sp(2), sp(9)]);
    expect(p.local).toEqual(['t1', 't2', 't3', `uri:${uri(9)}`]);
    expect(p.remote).toEqual([uri(1), uri(2), uri(3), uri(9)]);
  });
  it('a track removed on one side is removed on the other', () => {
    const removedHere = planSync(lib, { trackIds: ['t1'], spotify: link(1, 2) }, [sp(1), sp(2)]);
    expect(removedHere.local).toEqual(['t1']); expect(removedHere.remote).toEqual([uri(1)]);
    const removedThere = planSync(lib, { trackIds: ['t1', 't2'], spotify: link(1, 2) }, [sp(1)]);
    expect(removedThere.local).toEqual(['t1']); expect(removedThere.remote).toEqual([uri(1)]);
  });
  it('recognises a Spotify track the library has by title and artist', () => {
    const p = planSync(lib, { trackIds: ['t1'], spotify: link(1) }, [sp(1), sp(77, 'Two')]);
    expect(p.local).toEqual(['t1', 't2']);
    expect(p.create).toEqual([]);
  });
  it('keeps tracks without a Spotify link here, and never sends them', () => {
    const p = planSync(lib, { trackIds: ['t1', 'tx'], spotify: link(1) }, [sp(1)]);
    expect(p.local).toEqual(['t1', 'tx']); expect(p.remote).toEqual([uri(1)]); expect(p.unsynced).toEqual(['tx']);
    expect(p.changesRemote).toBe(false);
  });
  it('one-way modes copy a side', () => {
    const down = planSync(lib, { trackIds: ['t1', 't3'], spotify: link(1, 3) }, [sp(1), sp(2)], 'from-spotify');
    expect(down.local).toEqual(['t1', 't2']); expect(down.changesRemote).toBe(false);
    const up = planSync(lib, { trackIds: ['t1', 't3'], spotify: link(1, 2) }, [sp(1), sp(2)], 'to-spotify');
    expect(up.remote).toEqual([uri(1), uri(3)]); expect(up.local).toEqual(['t1', 't3']);
  });
  it('is quiet when nothing changed', () => {
    const p = planSync(lib, { trackIds: ['t1', 't2'], spotify: link(1, 2) }, [sp(1), sp(2)]);
    expect(p.changesLocal).toBe(false); expect(p.changesRemote).toBe(false);
  });
});

describe('splitSynced', () => {
  it('puts songs with no Spotify link apart', () => {
    const r = splitSynced(lib, { trackIds: ['t1', 'tx', 't2'], spotify: link(1, 2) });
    expect(r).toEqual({ onSpotify: ['t1', 't2'], localOnly: ['tx'] });
  });
  it('when changes only come from Spotify, a linked song Spotify never had is local only', () => {
    const r = splitSynced(lib, { trackIds: ['t1', 't3'], spotify: { ...link(1), mode: 'from-spotify' } });
    expect(r).toEqual({ onSpotify: ['t1'], localOnly: ['t3'] });
    expect(splitSynced(lib, { trackIds: ['t1', 't3'], spotify: link(1) }).localOnly).toEqual([]);
  });
});
