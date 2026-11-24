import type { TrackData } from '@turbomusic/core';
import type { Library } from './library.ts';

export interface DeleteAlbumPlan {
  albumId: string;
  /** songs that exist only on this album and are deleted with it (their pages go too) */
  deleteTrackIds: string[];
  /** songs that stay, with the album taken out of their links (they are on another album, or became singles) */
  unlink: { id: string; albums: TrackData['albums'] }[];
  /** every release of the album, single releases included */
  releaseIds: string[];
  playlistPatches: { id: string; albumIds: string[] }[];
}

/**
 * Deleting an album for good. With `deleteTracks` the songs that are on no other album are deleted too (an album that came from
 * a Spotify import is "unimported" this way); songs that are also on another album always stay, as part of that album. Without it
 * every song stays and becomes a single (or stays on its other albums).
 */
export function planDeleteAlbum(lib: Library, albumId: string, rawAlbums: (trackId: string) => TrackData['albums'] | undefined, deleteTracks: boolean): DeleteAlbumPlan | null {
  const album = lib.albumById.get(albumId);
  if (!album) return null;
  const ids = new Set(album.trackIds);
  for (const r of [...lib.releases, ...lib.singleReleases].filter((x) => x.albumId === albumId)) for (const t of r.trackIds) if (lib.trackById.has(t)) ids.add(t);
  const deleteTrackIds: string[] = [], unlink: DeleteAlbumPlan['unlink'] = [];
  for (const id of ids) {
    const links = rawAlbums(id) ?? [];
    const rest = links.filter((l) => l.albumId !== albumId && lib.albumById.has(l.albumId));
    if (deleteTracks && !rest.length) deleteTrackIds.push(id);
    else unlink.push({ id, albums: links.filter((l) => l.albumId !== albumId) });
  }
  return {
    albumId, deleteTrackIds, unlink,
    releaseIds: [...lib.releases, ...lib.singleReleases].filter((r) => r.albumId === albumId).map((r) => r.id),
    playlistPatches: lib.playlists.filter((p) => p.albumIds?.includes(albumId)).map((p) => ({ id: p.id, albumIds: p.albumIds!.filter((a) => a !== albumId) })),
  };
}

/** Tracks on no album that look like leftovers, by how sure we are they are not wanted. */
export type LooseKind = 'unimported' | 'noaudio' | 'unplayed' | 'all';
export const LOOSE_KINDS: { id: LooseKind; label: string; hint: string }[] = [
  { id: 'unimported', label: 'Not imported', hint: 'no audio file and no YouTube Music link: what a Spotify import leaves behind' },
  { id: 'noaudio', label: 'No audio file', hint: 'singles that have nothing to play yet' },
  { id: 'unplayed', label: 'Never played, no votes', hint: 'singles you have never listened to or compared' },
  { id: 'all', label: 'Every single', hint: 'all tracks that are not on an album' },
];

export function looseSingles(lib: Library, kind: LooseKind, played: Set<string>): Library['tracks'] {
  const keep = (t: Library['tracks'][number]) => {
    if (lib.singleReleases.some((r) => r.trackIds.includes(t.id))) return false; // it is also a single on an album: not loose
    if (kind === 'unimported') return !t.file && !t.youtubeMusicUrl;
    if (kind === 'noaudio') return !t.file;
    if (kind === 'unplayed') return !played.has(t.id) && t.comparisons === 0 && !(t.memories ?? 0);
    return true;
  };
  return lib.singles.filter(keep);
}
