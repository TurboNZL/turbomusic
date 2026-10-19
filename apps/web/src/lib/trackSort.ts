import type { Track } from './derive.ts';

export type SortKey = 'rating' | 'title' | 'artist' | 'album' | 'comparisons' | 'memories' | 'released' | 'plays';
export type SortDir = 'asc' | 'desc';

/** Natural direction for a first click on each column: text A-Z, numbers high first. */
export const defaultDir = (k: SortKey): SortDir => (k === 'rating' || k === 'comparisons' || k === 'memories' || k === 'released' || k === 'plays' ? 'desc' : 'asc');

const text = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
/** play counts by track id, for the `plays` sort */
export type PlayCounts = ReadonlyMap<string, number>;
const asc: Record<SortKey, (a: Track, b: Track, plays: PlayCounts) => number> = {
  rating: (a, b) => a.effectiveRating - b.effectiveRating || a.elo - b.elo,
  title: (a, b) => text(a.title, b.title),
  artist: (a, b) => text(a.artistName, b.artistName) || text(a.title, b.title),
  album: (a, b) => text(a.albumTitle ?? '', b.albumTitle ?? '') || text(a.title, b.title),
  comparisons: (a, b) => a.comparisons - b.comparisons,
  memories: (a, b) => (a.memories ?? 0) - (b.memories ?? 0) || a.effectiveRating - b.effectiveRating,
  plays: (a, b, p) => (p.get(a.id) ?? 0) - (p.get(b.id) ?? 0) || a.effectiveRating - b.effectiveRating,
  released: (a, b) => (a.releaseDate ?? '').localeCompare(b.releaseDate ?? ''),
};

/** Sorted copy. Tracks with no album sort last whichever way the album column runs. */
export function sortTracks(tracks: Track[], key: SortKey, dir: SortDir, plays: PlayCounts = new Map()): Track[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...tracks].sort((a, b) => {
    if (key === 'album' && !a.albumTitle !== !b.albumTitle) return a.albumTitle ? -1 : 1;
    if (key === 'released' && !a.releaseDate !== !b.releaseDate) return a.releaseDate ? -1 : 1; // undated last
    return sign * asc[key](a, b, plays);
  });
}

export const TRACK_SORTS: { value: SortKey; label: string; dir: SortDir }[] = [
  { value: 'rating', label: 'Rating', dir: 'desc' }, { value: 'title', label: 'Title', dir: 'asc' }, { value: 'artist', label: 'Artist', dir: 'asc' },
  { value: 'album', label: 'Album', dir: 'asc' }, { value: 'released', label: 'Release date', dir: 'desc' }, { value: 'memories', label: 'Memories', dir: 'desc' }, { value: 'plays', label: 'Play count', dir: 'desc' },
  { value: 'comparisons', label: 'Times compared', dir: 'desc' },
];
