import type { MatchCandidate } from './api.ts';
import type { Library } from './library.ts';
import { api } from './store.ts';

/** Album-search results kept for a week, so the Health suggestions and the finder open instantly and importing needs no new search. */
const KEY = 'turbomusic.matchCache4';
const WEEK = 7 * 24 * 3600_000;
type Cache = Record<string, { at: number; candidates: MatchCandidate[] }>;

const read = (): Cache => { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Cache; } catch { return {}; } };
const write = (c: Cache) => { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* full or blocked: just not cached */ } };

export function cachedMatches(albumId: string): MatchCandidate[] | null {
  const hit = read()[albumId];
  return hit && Date.now() - hit.at < WEEK ? hit.candidates : null;
}
export function cacheMatches(albumId: string, candidates: MatchCandidate[]) {
  const c = read();
  c[albumId] = { at: Date.now(), candidates };
  for (const [k, v] of Object.entries(c)) if (Date.now() - v.at > WEEK) delete c[k];
  write(c);
}
export function forgetMatches(albumId: string) { const c = read(); delete c[albumId]; write(c); }

/** Albums that still have no YouTube Music link (they wait for one after a Spotify import, or none of their songs has a link). */
export function albumsWithoutLink(lib: Library) {
  return lib.albums.filter((a) => !(a as { noYoutube?: boolean }).noYoutube).filter((a) => (a as { needsSource?: boolean }).needsSource || (a.trackIds.length > 0 && a.trackIds.every((id) => !lib.trackById.get(id)?.youtubeMusicUrl)));
}

/** The albums whose best song rates highest: where a missing link costs the most. */
export function topUnlinked(lib: Library, n = 5) {
  const best = (a: { trackIds: string[] }) => Math.max(0, ...a.trackIds.map((id) => lib.trackById.get(id)?.effectiveRating ?? 0));
  return albumsWithoutLink(lib).sort((x, y) => best(y) - best(x)).slice(0, n);
}

/** Searches (once, then cached) for the given albums and stores what was found. Returns the albums that were searched. */
export async function prefetchMatches(lib: Library, albums: ReturnType<typeof topUnlinked>): Promise<string[]> {
  const todo = albums.filter((a) => !cachedMatches(a.id));
  if (!todo.length) return [];
  const { results } = await api().matchAlbums(todo.map((a) => ({ id: a.id, title: a.title, artist: a.leads[0]?.name ?? a.artistName, trackCount: a.trackIds.length })));
  for (const r of results) if (!r.error && r.candidates.length) cacheMatches(r.id, r.candidates);
  return todo.map((a) => a.id);
}
