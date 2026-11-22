import type { SortDir } from './trackSort.ts';
import type { SortOption } from './listSort.ts';

export type PlaylistSort = 'new' | 'name' | 'size';
export const PLAYLIST_SORTS: SortOption<PlaylistSort>[] = [{ value: 'new', label: 'Date made', dir: 'desc' }, { value: 'name', label: 'Name', dir: 'asc' }, { value: 'size', label: 'Most songs', dir: 'desc' }];
const KEY = 'turbomusic.playlistSort';

/** The order the Playlists page uses, remembered on this device so the "Add to playlist" menu lists them the same way. */
export function readPlaylistSort(): { sort: PlaylistSort; dir: SortDir } {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    if (PLAYLIST_SORTS.some((o) => o.value === v.sort) && (v.dir === 'asc' || v.dir === 'desc')) return v;
  } catch { /* not remembered */ }
  return { sort: 'new', dir: 'desc' };
}
export function writePlaylistSort(sort: PlaylistSort, dir: SortDir) { try { localStorage.setItem(KEY, JSON.stringify({ sort, dir })); } catch { /* private window */ } }

/** Sort playlists by the chosen key; `size` says how many songs one holds. */
export function sortPlaylists<T extends { name: string; createdAt?: number }>(list: T[], sort: PlaylistSort, dir: SortDir, size: (p: T) => number): T[] {
  const sg = dir === 'asc' ? 1 : -1;
  const key = (p: T) => (sort === 'name' ? p.name : sort === 'size' ? size(p) : p.createdAt ?? 0);
  return [...list].sort((x, y) => { const a = key(x), b = key(y); return (typeof a === 'string' ? a.localeCompare(b as string, undefined, { sensitivity: 'base', numeric: true }) : (a as number) - (b as number)) * sg; });
}
