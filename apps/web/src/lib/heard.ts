import type { Listen } from './listens.ts';

/** The library tracks that were played at least once (TurboMusic's own player or an imported Spotify history). */
export function heardTrackIds(listens: readonly Listen[]): Set<string> {
  const out = new Set<string>();
  for (const l of listens) if (l.trackId) out.add(l.trackId);
  return out;
}

/**
 * Tracks that may be ranked: only ones that were heard at least once. A brand new library has no history at all, so with fewer than
 * two heard tracks there is nothing to pair and everything is used instead (`fellBack` says so, the page tells the user).
 */
export function onlyHeard<T extends { id: string }>(tracks: readonly T[], heard: ReadonlySet<string>): { pool: T[]; fellBack: boolean } {
  const h = tracks.filter((t) => heard.has(t.id));
  return h.length >= 2 ? { pool: h, fellBack: false } : { pool: [...tracks], fellBack: true };
}

const FILLER = /\b(intro|outro|interlude|skit|reprise|commentary|voicemail|prelude|interview|asmr|white noise)\b/i;
/** Intros, skits and the like are never a good "something new"; a title that is only that word (or "Pt. 2"-style filler) is skipped. */
export const isFiller = (title: string) => FILLER.test(title) && title.replace(FILLER, '').replace(/[^\p{L}\p{N}]+/gu, '').length < 8;

interface Rateable { id: string; effectiveRating: number; comparisons: number; initialRating?: number | null; albumId?: string | null; artistId?: string | null; allGenres?: string[] }

/**
 * How much you are likely to like a track you have never played, from the tracks you HAVE rated: the average rating of its artist, its
 * album and its genres (each pulled toward your overall average while it rests on few songs). 0-10, like a rating.
 */
export function tasteScorer(tracks: readonly Rateable[]): (t: Rateable) => number {
  const rated = tracks.filter((t) => t.comparisons >= 3 || (t.initialRating ?? 0) > 0);
  const all = rated.length ? rated.reduce((s, t) => s + t.effectiveRating, 0) / rated.length : 5.5;
  const group = (keys: (t: Rateable) => string[]) => {
    const m = new Map<string, { sum: number; n: number }>();
    for (const t of rated) for (const k of keys(t)) { const g = m.get(k) ?? { sum: 0, n: 0 }; g.sum += t.effectiveRating; g.n++; m.set(k, g); }
    const K = 2; // the weight of "your average", in songs
    return (ks: string[]) => (ks.length ? ks.reduce((s, k) => { const g = m.get(k); return s + ((g?.sum ?? 0) + K * all) / ((g?.n ?? 0) + K); }, 0) / ks.length : all);
  };
  const byArtist = group((t) => (t.artistId ? [t.artistId] : []));
  const byAlbum = group((t) => (t.albumId ? [t.albumId] : []));
  const byGenre = group((t) => t.allGenres ?? []);
  return (t) => 0.5 * byArtist(t.artistId ? [t.artistId] : []) + 0.25 * byAlbum(t.albumId ? [t.albumId] : []) + 0.25 * byGenre(t.allGenres ?? []);
}

/**
 * A playlist to get to know the rest of the library: never-played, playable tracks, a few per album. With a `score` (see `tasteScorer`)
 * the likeliest favourites come first (with some randomness so a new mix differs), and intros, skits and the like are left out.
 */
export function tryNewPlaylist<T extends { id: string; title?: string; albumId?: string | null; artistId?: string | null }>(
  tracks: readonly T[], heard: ReadonlySet<string>, playable: (t: T) => boolean, size = 25, perGroup = 2, rnd: () => number = Math.random, score?: (t: T) => number,
): T[] {
  let fresh = tracks.filter((t) => !heard.has(t.id) && playable(t) && !(score && t.title && isFiller(t.title)));
  if (score) {
    const sc = new Map(fresh.map((t) => [t.id, score(t)]));
    const mean = [...sc.values()].reduce((s, v) => s + v, 0) / Math.max(1, sc.size);
    // keep out what your taste says you would not enjoy, as long as enough is left to fill the list
    const keep = fresh.filter((t) => (sc.get(t.id) ?? 0) >= mean - 0.75);
    if (keep.length >= size * 2) fresh = keep;
    const noisy = new Map(fresh.map((t) => [t.id, (sc.get(t.id) ?? 0) * (0.85 + 0.3 * rnd())]));
    fresh = [...fresh].sort((x, y) => (noisy.get(y.id) ?? 0) - (noisy.get(x.id) ?? 0));
  } else {
    fresh = [...fresh];
    for (let i = fresh.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [fresh[i], fresh[j]] = [fresh[j], fresh[i]]; }
  }
  const used = new Map<string, number>();
  const out: T[] = [];
  for (const t of fresh) {
    const key = t.albumId ?? `artist:${t.artistId ?? t.id}`;
    const n = used.get(key) ?? 0;
    if (n >= perGroup) continue;
    used.set(key, n + 1);
    out.push(t);
    if (out.length >= size) break;
  }
  return out;
}
