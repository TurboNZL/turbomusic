import type { Library } from './library.ts';

type Playlist = Library['playlists'][number];

export const isAlbumList = (p: Pick<Playlist, 'kind'>) => p.kind === 'albums';

/** One entry of an album playlist: a whole album, or one release of an album (its own cover and tracklist). */
export interface AlbumEntry { id: string; title: string; cover: string | null; trackIds: string[]; leads: Library['albums'][number]['leads']; to: string; release: boolean }

/**
 * The entries of an album playlist that still exist, in order. `albumIds` holds album ids and release ids (they never collide),
 * so a playlist can mix whole albums with single releases and keep one order.
 */
export function playlistAlbums(lib: Library, p: Playlist): AlbumEntry[] {
  return (p.albumIds ?? []).flatMap((id): AlbumEntry[] => {
    const a = lib.albumById.get(id);
    if (a) return [{ id, title: a.title, cover: a.cover, trackIds: a.trackIds, leads: a.leads, to: `/albums/${a.id}`, release: false }];
    const r = lib.releases.find((x) => x.id === id);
    const alb = r && lib.albumById.get(r.albumId);
    if (!r || !alb) return [];
    return [{ id, title: r.title === alb.title ? alb.title : `${alb.title} (${r.title})`, cover: r.cover ?? alb.cover, trackIds: r.trackIds.filter((t) => lib.trackById.has(t)), leads: alb.leads, to: `/albums/${alb.id}?release=${r.id}`, release: true }];
  });
}

/** What plays: the playlist's tracks, or for an album playlist every album's tracks front to back (a track on two of them plays once). */
export function playlistTrackIds(lib: Library, p: Playlist): string[] {
  if (!isAlbumList(p)) return p.trackIds.filter((id) => lib.trackById.has(id));
  return [...new Set(playlistAlbums(lib, p).flatMap((a) => a.trackIds))];
}

/** How many things the list holds, and what to call them. */
export const playlistCount = (lib: Library, p: Playlist) => (isAlbumList(p) ? { n: playlistAlbums(lib, p).length, noun: 'album' } : { n: p.trackIds.length, noun: 'track' });

/** The covers that stand for the playlist: those of its first items, each picture once, in order. */
export function playlistCovers(lib: Library, p: Playlist, max = 4): string[] {
  const hashes = isAlbumList(p)
    ? playlistAlbums(lib, p).map((a) => a.cover)
    : p.trackIds.map((id) => lib.trackById.get(id)?.cover);
  const out: string[] = [];
  for (const h of hashes) { if (h && !out.includes(h)) out.push(h); if (out.length >= max) break; }
  return out;
}

/**
 * Spotify's rule for a playlist with no picture of its own: four different covers make a 2x2 mosaic of the first four; fewer
 * than four show the first one alone (a mosaic with repeats looks like a mistake); none shows the generated gradient.
 */
export function coverPlan(own: string | null, covers: string[]): { mode: 'own'; hash: string } | { mode: 'mosaic'; hashes: string[] } | { mode: 'single'; hash: string } | { mode: 'none' } {
  if (own) return { mode: 'own', hash: own };
  if (covers.length >= 4) return { mode: 'mosaic', hashes: covers.slice(0, 4) };
  if (covers.length) return { mode: 'single', hash: covers[0] };
  return { mode: 'none' };
}

/** Ids of the two automatic playlists. They are worked out from the thumbs, never stored. */
export const QUICK_LIKED = 'quick:liked';
export const QUICK_DISLIKED = 'quick:disliked';
export const isQuickPlaylist = (id: string | null | undefined) => id === QUICK_LIKED || id === QUICK_DISLIKED;

/**
 * Track ids by thumbs: liked = more thumbs up than down, disliked = more down than up. A track with no thumbs, or as many up as down,
 * is in neither. Head-to-head votes do not count. Ordered by how far ahead the thumbs are, then by the newest thumb.
 */
export function thumbLists(votes: { trackAId: string; boost?: 1 | -1; timestamp: number }[]): { liked: string[]; disliked: string[] } {
  const tally = new Map<string, { net: number; last: number }>();
  for (const v of votes) {
    if (!v.boost) continue;
    const t = tally.get(v.trackAId) ?? { net: 0, last: 0 };
    t.net += v.boost; t.last = Math.max(t.last, v.timestamp);
    tally.set(v.trackAId, t);
  }
  const pick = (sign: 1 | -1) => [...tally].filter(([, t]) => t.net * sign > 0).sort((a, b) => (b[1].net * sign - a[1].net * sign) || b[1].last - a[1].last).map(([id]) => id);
  return { liked: pick(1), disliked: pick(-1) };
}

/** The two automatic playlists as playlist objects (only tracks that still exist), for the Playlists page. */
export function quickPlaylists(lib: Library): Playlist[] {
  const { liked, disliked } = thumbLists(lib.votes);
  const make = (id: string, name: string, description: string, ids: string[]): Playlist => ({ id, name, description, cover: null, createdAt: 0, trackIds: ids.filter((t) => lib.trackById.has(t)) });
  return [
    make(QUICK_LIKED, 'Thumbs up', 'Songs with more thumbs up than thumbs down. Updates by itself.', liked),
    make(QUICK_DISLIKED, 'Thumbs down', 'Songs with more thumbs down than thumbs up. Updates by itself.', disliked),
  ];
}
