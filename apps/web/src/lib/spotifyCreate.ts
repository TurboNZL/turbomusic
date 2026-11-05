import type { ArtistData } from '@turbomusic/core';
import { leadCredit, newAlbumData, newTrackData } from './defaults.ts';
import type { Library } from './library.ts';
import type { ImportPlan } from './spotifyImport.ts';
import { withLink } from './spotifyLinks.ts';
import type { useStore } from './store.ts';

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export type Ops = Pick<ReturnType<typeof useStore.getState>, 'put' | 'patch'>;

/**
 * Make what a Spotify list needs in the library: the artists, the albums and the tracks the library does not have yet (each in an album
 * named by Spotify; completed later with a YouTube album link), and the Spotify links of the tracks it already had. Returns the library
 * track for every Spotify uri of the plan. Shared by the Spotify import and playlist sync.
 */
export function createFromPlan(lib: Library, plan: ImportPlan, ops: Ops, o: { makeAlbums: boolean; skipped?: Set<string> }) {
  const { put, patch } = ops;
  const skipped = o.skipped ?? new Set<string>();
  const artistIds = new Map<string, string>();
  for (const a of lib.artists) for (const n of [a.name, ...(a.aliases ?? [])]) if (!artistIds.has(norm(n))) artistIds.set(norm(n), a.id);
  const artist = (n: string) => { const k = norm(n); let id = artistIds.get(k); if (!id) { id = put('artists', { name: n.trim(), image: null } satisfies ArtistData); artistIds.set(k, id); } return id; };
  const trackIdOf = new Map<string, string>();
  for (const t of plan.tracks) if (t.existingTrackId) {
    trackIdOf.set(t.src.uri, t.existingTrackId);
    // reused by title and artist: this Spotify track may be another release of the same song (the single, then the album), so keep its link too
    const have = lib.trackById.get(t.existingTrackId);
    const more = have && withLink(have, `https://open.spotify.com/track/${t.src.id}`);
    if (more) patch('tracks', t.existingTrackId, more);
  }
  let albumsMade = 0, tracksMade = 0;
  const newAlbumIds: { id: string; releaseId: string | null; coverFrom: string | null }[] = [];
  if (o.makeAlbums) {
    for (const a of plan.albums) {
      if (skipped.has(a.key)) continue;
      const lead = artist(a.artist);
      const credits = leadCredit(lead);
      const albumId = a.existingAlbumId ?? put('albums', newAlbumData({ title: a.title, credits, genres: [], cover: null, covers: [], coverPicked: false, needsSource: true } as never));
      if (!a.existingAlbumId) albumsMade++;
      const ids: string[] = [];
      for (const [i, pt] of a.tracks.entries()) {
        const feats = pt.src.artists.filter((n) => norm(n) !== norm(a.artist)).map((n) => ({ artistId: artist(n), role: ['Featured artist'] }));
        const id = put('tracks', newTrackData({ title: pt.src.title, credits: [...credits, ...feats], youtubeMusicUrl: null, spotifyUrl: `https://open.spotify.com/track/${pt.src.id}`, albums: [{ albumId, order: i }] }));
        trackIdOf.set(pt.src.uri, id); ids.push(id); tracksMade++;
      }
      if (!a.existingAlbumId) {
        const releaseId = put('releases', { albumId, title: a.title, cover: null, releaseDate: a.releaseDate, trackIds: ids });
        patch('albums', albumId, { trackOrder: ids, defaultReleaseId: releaseId });
        newAlbumIds.push({ id: albumId, releaseId, coverFrom: a.albumUri ?? a.tracks[0]?.src.uri ?? null });
      } else {
        const cur = lib.albumById.get(albumId);
        if (cur) patch('albums', albumId, { trackOrder: [...cur.trackIds, ...ids] });
      }
    }
  }
  return { trackIdOf, albumsMade, tracksMade, newAlbumIds };
}
