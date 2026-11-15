import { ratingStrength, type Library, type Track } from './library.ts';
import type { SortDir } from './trackSort.ts';

/** One sortable column of a list page: what it is called and which way a first click should go. */
export interface SortOption<K extends string = string> { value: K; label: string; dir: SortDir }

const text = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
const sign = (dir: SortDir) => (dir === 'asc' ? 1 : -1);
const memoriesOf = (lib: Library, ids: string[]) => ids.reduce((n, id) => n + (lib.trackById.get(id)?.memories ?? 0), 0);

type Album = Library['albums'][number];
export type AlbumSort = 'title' | 'artist' | 'rating' | 'tracks' | 'memories' | 'released';
export const ALBUM_SORTS: SortOption<AlbumSort>[] = [
  { value: 'title', label: 'Title', dir: 'asc' }, { value: 'artist', label: 'Artist', dir: 'asc' }, { value: 'rating', label: 'Rating', dir: 'desc' },
  { value: 'tracks', label: 'Track count', dir: 'desc' }, { value: 'memories', label: 'Memories', dir: 'desc' }, { value: 'released', label: 'Release date', dir: 'desc' },
];
/** Missing ratings and dates sort last whichever way the column runs. */
export function sortAlbums(lib: Library, albums: Album[], key: AlbumSort, dir: SortDir): Album[] {
  const s = sign(dir);
  return [...albums].sort((a, b) => {
    if (key === 'rating' && (a.rating == null) !== (b.rating == null)) return a.rating == null ? 1 : -1;
    if (key === 'released' && !a.releaseDate !== !b.releaseDate) return a.releaseDate ? -1 : 1;
    switch (key) {
      case 'title': return s * text(a.title, b.title);
      case 'artist': return s * (text(a.artistName, b.artistName) || text(a.title, b.title));
      case 'rating': return s * (a.strength - b.strength || (a.rating ?? 0) - (b.rating ?? 0)); // by how many good tracks, then by the average
      case 'tracks': return s * (a.trackIds.length - b.trackIds.length);
      case 'memories': return s * (memoriesOf(lib, a.trackIds) - memoriesOf(lib, b.trackIds));
      case 'released': return s * (a.releaseDate ?? '').localeCompare(b.releaseDate ?? '');
    }
  });
}

export interface ArtistRow { id: string; name: string; image: string | null | undefined; tracks: number; albums: number; memories: number; rating: number | null; /** ratingStrength of their tracks: what Rating sorts by */ strength: number }
export type ArtistSort = 'name' | 'tracks' | 'albums' | 'rating' | 'memories';
export const ARTIST_SORTS: SortOption<ArtistSort>[] = [
  { value: 'tracks', label: 'Track count', dir: 'desc' }, { value: 'name', label: 'Name', dir: 'asc' }, { value: 'albums', label: 'Album count', dir: 'desc' },
  { value: 'rating', label: 'Rating', dir: 'desc' }, { value: 'memories', label: 'Memories', dir: 'desc' },
];
export function artistRows(lib: Library): ArtistRow[] {
  const byArtist = new Map<string, Track[]>();
  for (const t of lib.tracks) for (const l of t.leads) byArtist.set(l.id, [...(byArtist.get(l.id) ?? []), t]);
  return lib.artists.map((a) => {
    const ts = byArtist.get(a.id) ?? [];
    const rated = ts.filter((t) => t.effectiveRating > 0.001);
    return {
      id: a.id, name: a.name, image: a.image, tracks: ts.length, albums: new Set(ts.flatMap((t) => (t.albumId ? [t.albumId] : []))).size,
      memories: ts.reduce((n, t) => n + (t.memories ?? 0), 0), rating: rated.length ? rated.reduce((n, t) => n + t.effectiveRating, 0) / rated.length : null, strength: ratingStrength(rated.map((t) => t.effectiveRating)),
    };
  });
}
export function sortArtists(rows: ArtistRow[], key: ArtistSort, dir: SortDir): ArtistRow[] {
  const s = sign(dir);
  return [...rows].sort((a, b) => {
    if (key === 'rating' && (a.rating == null) !== (b.rating == null)) return a.rating == null ? 1 : -1;
    const n = key === 'name' ? s * text(a.name, b.name) : s * ((key === 'rating' ? a.strength - b.strength || (a.rating ?? 0) - (b.rating ?? 0) : a[key] - b[key]));
    return n || text(a.name, b.name);
  });
}

type Era = Library['eras'][number];
export interface EraRow { era: Era; albums: Album[]; singles: Track[]; cover: string | null; newest: string }
export type EraSort = 'name' | 'albums' | 'items' | 'newest';
export const ERA_SORTS: SortOption<EraSort>[] = [
  { value: 'name', label: 'Name', dir: 'asc' }, { value: 'albums', label: 'Album count', dir: 'desc' }, { value: 'items', label: 'Albums + singles', dir: 'desc' }, { value: 'newest', label: 'Newest release', dir: 'desc' },
];
export function eraRows(lib: Library, eras: Era[] = lib.eras): EraRow[] {
  return eras.map((e) => {
    const albums = e.albumIds.flatMap((id) => lib.albumById.get(id) ?? []);
    const singles = e.trackIds.flatMap((id) => lib.trackById.get(id) ?? []);
    const dates = [...albums.map((a) => a.releaseDate), ...singles.map((t) => t.releaseDate)].filter((d): d is string => !!d).sort();
    return { era: e, albums, singles, cover: e.cover || albums.find((a) => a.cover)?.cover || null, newest: dates[dates.length - 1] ?? '' };
  });
}
export function sortEras(rows: EraRow[], key: EraSort, dir: SortDir): EraRow[] {
  const s = sign(dir);
  return [...rows].sort((a, b) => {
    if (key === 'newest' && !a.newest !== !b.newest) return a.newest ? -1 : 1;
    const n = key === 'name' ? text(a.era.name, b.era.name) : key === 'albums' ? a.albums.length - b.albums.length : key === 'items' ? a.albums.length + a.singles.length - b.albums.length - b.singles.length : a.newest.localeCompare(b.newest);
    return s * n || text(a.era.name, b.era.name);
  });
}

/** What an era holds: albums and singles side by side, so they can be sorted as one list (by date, as a timeline). */
export type EraItem = { kind: 'album'; id: string; album: Album } | { kind: 'single'; id: string; track: Track };
export type EraItemSort = 'released' | 'title' | 'artist' | 'rating' | 'memories' | 'tracks';
export const ERA_ITEM_SORTS: SortOption<EraItemSort>[] = [
  { value: 'released', label: 'Release date', dir: 'asc' }, { value: 'title', label: 'Title', dir: 'asc' }, { value: 'artist', label: 'Artist', dir: 'asc' },
  { value: 'rating', label: 'Rating', dir: 'desc' }, { value: 'memories', label: 'Memories', dir: 'desc' }, { value: 'tracks', label: 'Track count', dir: 'desc' },
];
const eraItem = {
  title: (i: EraItem) => (i.kind === 'album' ? i.album.title : i.track.title),
  artist: (i: EraItem) => (i.kind === 'album' ? i.album.artistName : i.track.artistName),
  date: (i: EraItem) => (i.kind === 'album' ? i.album.releaseDate : i.track.releaseDate) ?? '',
  rating: (i: EraItem) => (i.kind === 'album' ? i.album.rating : (i.track.effectiveRating > 0.001 ? i.track.effectiveRating : null)),
  strength: (i: EraItem) => (i.kind === 'album' ? i.album.strength : ratingStrength([i.track.effectiveRating])),
  memories: (lib: Library, i: EraItem) => (i.kind === 'album' ? memoriesOf(lib, i.album.trackIds) : i.track.memories ?? 0),
  tracks: (i: EraItem) => (i.kind === 'album' ? i.album.trackIds.length : 1),
};
/** Missing dates and ratings go last whichever way the column runs; ties keep the order they were added in (a stable sort), then fall back to the title. */
export function sortEraItems(lib: Library, items: EraItem[], key: EraItemSort, dir: SortDir): EraItem[] {
  const s = sign(dir);
  return items.map((x, i) => ({ x, i })).sort((a, b) => {
    if (key === 'released' && !eraItem.date(a.x) !== !eraItem.date(b.x)) return eraItem.date(a.x) ? -1 : 1;
    if (key === 'rating' && (eraItem.rating(a.x) == null) !== (eraItem.rating(b.x) == null)) return eraItem.rating(a.x) == null ? 1 : -1;
    let n = 0;
    switch (key) {
      case 'released': n = s * eraItem.date(a.x).localeCompare(eraItem.date(b.x)); break; // "2019" < "2019-05" < "2019-05-02"
      case 'title': n = s * text(eraItem.title(a.x), eraItem.title(b.x)); break;
      case 'artist': n = s * text(eraItem.artist(a.x), eraItem.artist(b.x)); break;
      case 'rating': n = s * (eraItem.strength(a.x) - eraItem.strength(b.x) || (eraItem.rating(a.x) ?? 0) - (eraItem.rating(b.x) ?? 0)); break;
      case 'memories': n = s * (eraItem.memories(lib, a.x) - eraItem.memories(lib, b.x)); break;
      case 'tracks': n = s * (eraItem.tracks(a.x) - eraItem.tracks(b.x)); break;
    }
    return n || text(eraItem.title(a.x), eraItem.title(b.x)) || a.i - b.i;
  }).map((e) => e.x);
}
