import type { Library } from './library.ts';

/** What the library holds that has no source yet: no audio file and no YouTube Music link (from a Spotify import, or made from the listening history). */
export interface Unimported { tracks: Set<string>; albums: Set<string>; artists: Set<string> }

const cache = new WeakMap<Library, Unimported>();
const viewCache = new WeakMap<Library, Library>();

export function unimportedOf(lib: Library): Unimported {
  const hit = cache.get(lib);
  if (hit) return hit;
  const tracks = new Set(lib.tracks.filter((t) => !t.file && !t.youtubeMusicUrl).map((t) => t.id));
  const albums = new Set(lib.albums.filter((a) => (a as { needsSource?: boolean }).needsSource || (a.trackIds.length > 0 && a.trackIds.every((id) => tracks.has(id)))).map((a) => a.id));
  // an artist is unimported when everything they are credited on is: they have at least one thing and none of it is imported
  const real = new Set<string>(), any = new Set<string>();
  for (const t of lib.tracks) for (const c of t.credits) { any.add(c.artistId); if (!tracks.has(t.id)) real.add(c.artistId); }
  for (const a of lib.albums) for (const c of a.credits ?? []) { any.add(c.artistId); if (!albums.has(a.id)) real.add(c.artistId); }
  const artists = new Set([...any].filter((id) => !real.has(id)));
  const out = { tracks, albums, artists };
  cache.set(lib, out);
  return out;
}

/** The library as lists show it while "show what I have not imported" is off: those tracks, albums and artists are left out of the lists (lookups by id still find them, so links keep working). */
export function withoutUnimported(lib: Library): Library {
  const hit = viewCache.get(lib);
  if (hit) return hit;
  const u = unimportedOf(lib);
  if (!u.tracks.size && !u.albums.size && !u.artists.size) { viewCache.set(lib, lib); return lib; }
  const tracks = lib.tracks.filter((t) => !u.tracks.has(t.id));
  const view = { ...lib, tracks, singles: tracks.filter((t) => !t.albumId), albums: lib.albums.filter((a) => !u.albums.has(a.id)), artists: lib.artists.filter((a) => !u.artists.has(a.id)) };
  viewCache.set(lib, view);
  return view;
}

/** What a list's "Hidden" switch holds: things you hid yourself plus everything not imported yet. */
export const isHiddenAlbum = (lib: Library, a: { id: string }) => !!(a as { hidden?: boolean }).hidden || unimportedOf(lib).albums.has(a.id);
export const isHiddenArtist = (lib: Library, a: { id: string }) => !!(a as { hidden?: boolean }).hidden || unimportedOf(lib).artists.has(a.id);
export const isHiddenTrack = (lib: Library, id: string) => unimportedOf(lib).tracks.has(id);
