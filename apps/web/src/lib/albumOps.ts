import type { ReleaseData, TrackData } from '@turbomusic/core';
import { appendTrack, leadArtistIds } from './defaults.ts';
import type { Library } from './library.ts';

type Album = Library['albums'][number];

/** The release an album is "really" published as: the chosen default, else the one with the most tracks. */
export function defaultRelease(lib: Library, album: Album) {
  const mine = lib.releases.filter((r) => r.albumId === album.id);
  return mine.find((r) => r.id === album.defaultReleaseId) ?? [...mine].sort((a, b) => b.trackIds.length - a.trackIds.length)[0];
}

/** Which releases of the album a track is put on when it is added to the album. */
export interface ReleaseChoice {
  /** existing releases that get the track appended */
  releaseIds: string[];
  /** also make a release of its own (titled like the track, with the track's cover) */
  newRelease: boolean;
  /** keep the song as a single too: a release marked single (no name, shown on the Singles page and under the album's releases) */
  asSingle?: boolean;
}

/**
 * The starting choice: a track with its own cover came from a different edition (a single), so it becomes a
 * separate release carrying that cover. A track without a cover just joins the album's default release.
 */
export function defaultChoice(lib: Library, album: Album, hasOwnCover: boolean): ReleaseChoice {
  if (hasOwnCover) return { releaseIds: [], newRelease: true };
  const d = defaultRelease(lib, album);
  return { releaseIds: d ? [d.id] : [], newRelease: false };
}

export interface AlbumAddPlan {
  /** replacement `albums` links for the track: the new album first (its album, cover and genres come from the first link) */
  trackAlbums: TrackData['albums'];
  trackOrder: string[];
  releaseAppends: { id: string; trackIds: string[] }[];
  newRelease: ReleaseData | null;
  /** the single release kept for the song, when asked for */
  singleRelease?: ReleaseData | null;
}

/** The release that stands for a song's single on an album: marked single, no name of its own, the single's cover and date. */
export function singleReleaseFor(albumId: string, trackId: string, cover: string | null, releaseDate: string | null): ReleaseData {
  return { albumId, title: '', cover, releaseDate, trackIds: [trackId], single: true };
}

/** Everything that changes when `trackId` is added to `album` (pure; the caller writes it). */
export function planAddToAlbum(lib: Library, raw: TrackData, trackId: string, album: Album, choice: ReleaseChoice): AlbumAddPlan {
  const releaseAppends = choice.releaseIds.flatMap((id) => {
    const r = lib.releases.find((x) => x.id === id && x.albumId === album.id);
    return r && !r.trackIds.includes(trackId) ? [{ id, trackIds: [...r.trackIds, trackId] }] : [];
  });
  return {
    trackAlbums: [{ albumId: album.id, order: album.trackIds.length }, ...(raw.albums ?? []).filter((l) => l.albumId !== album.id)],
    trackOrder: appendTrack(album.trackIds, trackId),
    releaseAppends,
    singleRelease: choice.asSingle ? singleReleaseFor(album.id, trackId, raw.cover ?? null, raw.releaseDate ?? null) : null,
    newRelease: choice.newRelease ? { albumId: album.id, title: raw.title, cover: raw.cover ?? null, releaseDate: raw.releaseDate ?? null, trackIds: [trackId] } : null,
  };
}

/** Which tracks the album page shows: the chosen release, or every track linked to the album. */
export type AlbumView = { kind: 'all' } | { kind: 'release'; id: string };

/** The default release when it holds every track of the album, else all tracks (so nothing seems to vanish). */
export function initialView(lib: Library, album: Album): AlbumView {
  const d = defaultRelease(lib, album);
  if (!d) return { kind: 'all' };
  const inRelease = new Set(d.trackIds);
  return album.trackIds.every((id) => inRelease.has(id)) ? { kind: 'release', id: d.id } : { kind: 'all' };
}

/** Track ids shown for a view, in order. A release lists only tracks that still exist. */
export function viewTrackIds(lib: Library, album: Album, view: AlbumView): string[] {
  if (view.kind === 'all') return album.trackIds;
  const r = lib.releases.find((x) => x.id === view.id && x.albumId === album.id);
  return r ? r.trackIds.filter((id) => lib.trackById.has(id)) : album.trackIds;
}

/**
 * An album whose releases each hold just one song (and it is the same song) is really a single. Returns that track's
 * id, or null when the album is not such a thing.
 */
export function singleTrackOf(lib: Library, album: Album): string | null {
  const releases = lib.releases.filter((r) => r.albumId === album.id);
  if (!releases.length || album.trackIds.length !== 1) return null;
  const id = album.trackIds[0];
  return releases.every((r) => r.trackIds.length === 1 && r.trackIds[0] === id) ? id : null;
}

export interface SinglePlan {
  trackId: string;
  /** fields to merge into the raw track record */
  trackPatch: Pick<TrackData, 'albums' | 'cover' | 'credits' | 'genres' | 'syncWithAlbumCredits' | 'releaseDate'>;
  removeReleaseIds: string[];
  removeAlbumId: string;
  /** the eras the album was in: the single takes its place in them */
  eraIds: string[];
}

/**
 * The track leaves the album and keeps what it showed: the default release's cover, the album's era, and the credits
 * and genres it had (copied, since it no longer has an album to follow). The album and its releases are then removed.
 */
export function planConvertToSingle(lib: Library, album: Album): SinglePlan | null {
  const trackId = singleTrackOf(lib, album);
  const t = trackId ? lib.trackById.get(trackId) : undefined;
  if (!trackId || !t) return null;
  const rel = defaultRelease(lib, album);
  return {
    trackId,
    trackPatch: {
      albums: (t.albums ?? []).filter((l) => l.albumId !== album.id),
      cover: rel?.cover || album.cover || t.cover || null,
      credits: t.credits.map((c) => ({ ...c, role: [...c.role] })),
      genres: [...t.allGenres],
      syncWithAlbumCredits: false,
      releaseDate: t.releaseDate ?? album.releaseDate ?? null, // the single keeps the date its album had
    },
    removeReleaseIds: lib.releases.filter((r) => r.albumId === album.id).map((r) => r.id),
    removeAlbumId: album.id,
    eraIds: album.eraIds,
  };
}

export interface MergeAlbumPlan {
  trackPatches: { id: string; patch: Partial<TrackData> }[];
  /** the target's new explicit track order and cover pool */
  targetPatch: { trackOrder: string[]; covers: string[] };
  /** the source album's only release, now a release of the target */
  newRelease: ReleaseData;
  playlistPatches: { id: string; albumIds: string[] }[];
  noteMembers: { id: string; members: { entityType: string; entityId: string; showOnEntityPage: boolean }[] }[];
  eraIds: string[];
  removeAlbumId: string;
  removeReleaseId: string;
  summary: string[];
}

/**
 * An album with a single release becomes a release of another album (a "deluxe" that was imported as its own album). Its tracks move to
 * the target (after the target's own, in the release's order), the release moves with its cover and date and is named after the old
 * album, the old album is removed, and playlists, notes and eras that pointed at it point at the target. Tracks that followed the old
 * album's credits keep them as their own when the target's lead artists differ. Null when the album does not have exactly one release.
 */
export function planMergeAlbumInto(lib: Library, source: Album, target: Album, raw: (id: string) => TrackData | undefined): MergeAlbumPlan | null {
  const rels = lib.releases.filter((r) => r.albumId === source.id);
  if (rels.length !== 1 || source.id === target.id) return null;
  const rel = rels[0];
  const ids = [...new Set([...rel.trackIds.filter((id) => lib.trackById.has(id)), ...source.trackIds])];
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
  const keepSync = same(leadArtistIds(source.credits ?? []), leadArtistIds(target.credits ?? []));
  const trackPatches = ids.flatMap((id) => {
    const t = lib.trackById.get(id), r = raw(id);
    if (!t || !r) return [];
    const patch: Partial<TrackData> = { albums: [{ albumId: target.id, order: target.trackIds.length + ids.indexOf(id) }, ...(r.albums ?? []).filter((l) => l.albumId !== source.id && l.albumId !== target.id)] };
    if (r.syncWithAlbumCredits && !keepSync) { patch.syncWithAlbumCredits = false; patch.credits = t.credits.map((c) => ({ ...c, role: [...c.role] })); patch.genres = [...t.allGenres]; }
    return [{ id, patch }];
  });
  const cover = rel.cover || source.cover || null;
  const dedupe = (a: string[]) => [...new Set(a)];
  return {
    trackPatches,
    targetPatch: { trackOrder: dedupe([...target.trackIds, ...ids]), covers: dedupe([...target.coverPool, ...source.coverPool, ...(cover ? [cover] : [])]) },
    newRelease: { albumId: target.id, title: source.title, cover, releaseDate: rel.releaseDate ?? source.releaseDate ?? null, trackIds: ids },
    playlistPatches: lib.playlists.filter((p) => p.albumIds?.includes(source.id)).map((p) => ({ id: p.id, albumIds: dedupe(p.albumIds!.map((a) => (a === source.id ? target.id : a))) })),
    noteMembers: lib.groups.filter((g) => g.members.some((m) => m.entityType === 'album' && m.entityId === source.id))
      .map((g) => ({ id: g.id, members: g.members.map((m) => (m.entityType === 'album' && m.entityId === source.id ? { ...m, entityId: target.id } : m)).filter((m, i, all) => all.findIndex((x) => x.entityType === m.entityType && x.entityId === m.entityId) === i) })),
    eraIds: dedupe([...target.eraIds, ...source.eraIds]),
    removeAlbumId: source.id, removeReleaseId: rel.id,
    summary: [
      `${ids.length} track${ids.length === 1 ? '' : 's'} move to “${target.title}”, after its own`,
      `“${source.title}” becomes a release of “${target.title}”${cover ? ' with its cover' : ''}${rel.releaseDate ? ` and date (${rel.releaseDate})` : ''}`,
      ...(keepSync ? [] : [`tracks that followed “${source.title}”'s credits keep them as their own`]),
      ...(source.eraIds.length ? [`${target.title} joins its eras`] : []),
      `the album “${source.title}” is deleted`,
    ],
  };
}
