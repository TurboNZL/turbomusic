import type { AlbumData, ArtistData, Credit, GroupMemberData, TrackData } from '@turbomusic/core';
import type { Library } from './library.ts';
import { leadArtistIds } from './defaults.ts';

/**
 * Merging by hand: for the duplicates the automatic detection does not catch (an artist entered twice under two spellings, an album
 * imported on its own and again from another link). Pure: each function returns what to write, so it can be shown first and tested.
 * Tracks have their own planner (mergeTracks.ts).
 */
const uniq = <T,>(xs: T[]) => [...new Set(xs)];
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** The stored rows a plan needs (not the derived library objects, whose credits and genres may come from elsewhere). */
export interface StoredRows { tracks: { id: string; data: TrackData }[]; albums: { id: string; data: AlbumData }[] }

// ---------------------------------------------------------------- artists

export interface ArtistMergePlan {
  keepId: string; removeIds: string[];
  keepPatch: Partial<ArtistData>;
  patches: { table: 'tracks' | 'albums' | 'groups'; id: string; patch: object }[];
  summary: string[];
}

/** The credits with the removed artists replaced by the kept one; roles of credits that become one are added together. Null when nothing changes. */
export function remapCredits(credits: Credit[], from: Set<string>, to: string): Credit[] | null {
  if (!credits.some((c) => from.has(c.artistId))) return null;
  const out: Credit[] = [];
  for (const c of credits) {
    const id = from.has(c.artistId) ? to : c.artistId;
    const same = out.find((x) => x.artistId === id);
    if (same) same.role = uniq([...same.role, ...c.role]);
    else out.push({ ...c, artistId: id, role: [...c.role] });
  }
  return out;
}

export function planMergeArtists(lib: Library, keepId: string, dropIds: string[], stored: StoredRows): ArtistMergePlan | null {
  const keep = lib.artistById.get(keepId);
  const drops = uniq(dropIds).filter((id) => id !== keepId).flatMap((id) => lib.artistById.get(id) ?? []);
  if (!keep || !drops.length) return null;
  const dropSet = new Set(drops.map((d) => d.id));
  const patches: ArtistMergePlan['patches'] = [];

  let tracks = 0, albums = 0;
  for (const t of stored.tracks) {
    const credits = remapCredits(t.data.credits ?? [], dropSet, keepId);
    const legacy = t.data.artistId && dropSet.has(t.data.artistId) ? { artistId: keepId } : null;
    if (credits || legacy) { patches.push({ table: 'tracks', id: t.id, patch: { ...(credits ? { credits } : {}), ...(legacy ?? {}) } }); tracks++; }
  }
  for (const a of stored.albums) {
    const credits = remapCredits(a.data.credits ?? [], dropSet, keepId);
    const legacy = a.data.artistId && dropSet.has(a.data.artistId) ? { artistId: keepId } : null;
    if (credits || legacy) { patches.push({ table: 'albums', id: a.id, patch: { ...(credits ? { credits } : {}), ...(legacy ?? {}) } }); albums++; }
  }
  let notes = 0;
  for (const g of lib.groups) {
    if (!g.members.some((m) => m.entityType === 'artist' && dropSet.has(m.entityId))) continue;
    const seen = new Set<string>();
    const members = g.members.map((m) => (m.entityType === 'artist' && dropSet.has(m.entityId) ? { ...m, entityId: keepId } : m))
      .filter((m) => { const k = `${m.entityType}:${m.entityId}`; return !seen.has(k) && !!seen.add(k); });
    patches.push({ table: 'groups', id: g.id, patch: { members } }); notes++;
  }
  // the removed names stay as aliases, so imports and searches still recognise them
  const have = new Set([keep.name.toLowerCase(), ...(keep.aliases ?? []).map((a) => a.toLowerCase())]);
  const aliases = [...(keep.aliases ?? [])];
  for (const n of drops.flatMap((d) => [d.name, ...(d.aliases ?? [])])) if (n.trim() && !have.has(n.toLowerCase())) { have.add(n.toLowerCase()); aliases.push(n); }
  const image = keep.image ?? drops.find((d) => d.image)?.image ?? null;
  const keepPatch: Partial<ArtistData> = { aliases, image };
  const summary = [
    `${drops.map((d) => `“${d.name}”`).join(', ')} ${drops.length === 1 ? 'is' : 'are'} deleted; ${drops.length === 1 ? 'its' : 'their'} name${drops.length === 1 ? ' becomes an alias' : 's become aliases'} of “${keep.name}”`,
    ...(tracks ? [`${plural(tracks, 'track')} credited to ${drops.length === 1 ? 'it' : 'them'} are now credited to “${keep.name}”`] : []),
    ...(albums ? [`${plural(albums, 'album')} likewise`] : []),
    ...(notes ? [`${plural(notes, 'note')} about ${drops.length === 1 ? 'it' : 'them'} now point${notes === 1 ? 's' : ''} to “${keep.name}”`] : []),
    ...(!keep.image && image ? ['takes the picture of the other artist'] : []),
  ];
  return { keepId, removeIds: [...dropSet], keepPatch, patches, summary };
}

// ----------------------------------------------------------------- albums

export interface AlbumMergePlan {
  keepId: string; removeIds: string[];
  keepPatch: Partial<AlbumData>;
  releasePatches: { id: string; patch: { albumId: string; title?: string } }[];
  trackPatches: { id: string; patch: Partial<TrackData> }[];
  playlistPatches: { id: string; albumIds: string[] }[];
  noteMembers: { id: string; members: GroupMemberData[] }[];
  /** the eras the kept album should be in */
  eraIds: string[];
  summary: string[];
}

/**
 * Put every release and track of the other albums into one. Each release keeps its own tracklist and cover (a release that had no
 * name of its own takes its old album's title, so it is still told apart), tracks follow, and playlists, notes and eras that pointed at
 * a removed album point at the kept one. Tracks that followed an album with other lead artists keep their credits as their own.
 */
export function planMergeAlbums(lib: Library, keepId: string, dropIds: string[], stored: StoredRows): AlbumMergePlan | null {
  const keep = lib.albumById.get(keepId);
  const drops = uniq(dropIds).filter((id) => id !== keepId).flatMap((id) => lib.albumById.get(id) ?? []);
  if (!keep || !drops.length) return null;
  const dropSet = new Set(drops.map((d) => d.id));
  const keepRaw = stored.albums.find((a) => a.id === keepId)?.data;
  const rawTrack = new Map(stored.tracks.map((t) => [t.id, t.data]));

  const releasePatches = lib.releases.filter((r) => dropSet.has(r.albumId)).map((r) => {
    const from = lib.albumById.get(r.albumId)!;
    return { id: r.id, patch: { albumId: keepId, ...(!(r.named) && from.title !== keep.title ? { title: from.title } : {}) } };
  });
  const moved = drops.flatMap((d) => d.trackIds);
  const trackOrder = uniq([...keep.trackIds, ...moved]);

  const trackPatches: AlbumMergePlan['trackPatches'] = [];
  for (const d of drops) {
    const keepSync = [...leadArtistIds(d.credits ?? [])].sort().join() === [...leadArtistIds(keep.credits ?? [])].sort().join();
    for (const id of d.trackIds) {
      const t = lib.trackById.get(id), r = rawTrack.get(id);
      if (!t || !r) continue;
      const links = (r.albums ?? []).map((l) => (dropSet.has(l.albumId) ? { ...l, albumId: keepId, order: trackOrder.indexOf(id) } : l));
      const seen = new Set<string>();
      const patch: Partial<TrackData> = { albums: links.filter((l) => !seen.has(l.albumId) && !!seen.add(l.albumId)) };
      if (r.syncWithAlbumCredits && !keepSync) { patch.syncWithAlbumCredits = false; patch.credits = t.credits.map((c) => ({ ...c, role: [...c.role] })); patch.genres = [...t.allGenres]; }
      trackPatches.push({ id, patch });
    }
  }
  const covers = uniq([...(keepRaw?.covers ?? []), ...drops.flatMap((d) => [...(stored.albums.find((a) => a.id === d.id)?.data.covers ?? [])])]);
  const keepPatch: Partial<AlbumData> = {
    trackOrder, covers,
    genres: uniq([...(keepRaw?.genres ?? []), ...drops.flatMap((d) => stored.albums.find((a) => a.id === d.id)?.data.genres ?? [])]),
  };
  const playlistPatches = lib.playlists.filter((p) => p.albumIds?.some((a) => dropSet.has(a)))
    .map((p) => ({ id: p.id, albumIds: uniq(p.albumIds!.map((a) => (dropSet.has(a) ? keepId : a))) }));
  const noteMembers = lib.groups.filter((g) => g.members.some((m) => m.entityType === 'album' && dropSet.has(m.entityId))).map((g) => {
    const seen = new Set<string>();
    return { id: g.id, members: g.members.map((m) => (m.entityType === 'album' && dropSet.has(m.entityId) ? { ...m, entityId: keepId } : m)).filter((m) => { const k = `${m.entityType}:${m.entityId}`; return !seen.has(k) && !!seen.add(k); }) };
  });
  const eraIds = uniq([...keep.eraIds, ...drops.flatMap((d) => d.eraIds)]);
  const names = drops.map((d) => `“${d.title}”`).join(', ');
  return {
    keepId, removeIds: [...dropSet], keepPatch, releasePatches, trackPatches, playlistPatches, noteMembers, eraIds,
    summary: [
      `${plural(releasePatches.length, 'release')} of ${names} move${releasePatches.length === 1 && drops.length === 1 ? 's' : ''} to “${keep.title}”`,
      `${plural(uniq(moved).length, 'track')} join “${keep.title}”, after its own`,
      ...(trackPatches.some((t) => t.patch.syncWithAlbumCredits === false) ? ['tracks that followed an album with other lead artists keep their credits as their own'] : []),
      ...(playlistPatches.length ? [`${plural(playlistPatches.length, 'album playlist')} now list${playlistPatches.length === 1 ? 's' : ''} “${keep.title}”`] : []),
      `${names} ${drops.length === 1 ? 'is' : 'are'} deleted`,
    ],
  };
}
