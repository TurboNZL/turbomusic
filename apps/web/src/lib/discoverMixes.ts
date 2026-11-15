/**
 * The playlists Discover makes out of your own library and listening: nothing here asks a server or a service. Every function is pure
 * (the "now", the random numbers and "can this be played" are passed in) so each can be tested.
 */
export interface MixTrack {
  id: string; title: string; rating: number; albumId?: string | null; artistId?: string | null; artistName?: string;
  genres: string[]; releaseDate?: string | null; cover?: string | null; albumTitle?: string | null;
}
export interface Plays { count: Map<string, number>; last: Map<string, number> }

/** a small seeded random generator (mulberry32): the same day gives the same "mix of the day", the next day a new one */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const daySeed = (now: number) => { const d = new Date(now); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); };

const shuffle = <T,>(xs: T[], rnd: () => number): T[] => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/** keep at most `per` tracks of any one artist (and `perAlbum` of one album), in the order given */
export function spread<T extends MixTrack>(tracks: T[], per = 2, perAlbum = 2): T[] {
  const byArtist = new Map<string, number>(), byAlbum = new Map<string, number>();
  return tracks.filter((t) => {
    const a = t.artistId ?? t.id, b = t.albumId ?? '';
    if ((byArtist.get(a) ?? 0) >= per || (b && (byAlbum.get(b) ?? 0) >= perAlbum)) return false;
    byArtist.set(a, (byArtist.get(a) ?? 0) + 1); if (b) byAlbum.set(b, (byAlbum.get(b) ?? 0) + 1);
    return true;
  });
}

/** Songs you rate highly and have hardly played: the ones the plays do not know about yet. */
export function hiddenGems<T extends MixTrack>(tracks: T[], plays: Plays, n = 25, minRating = 7, maxPlays = 2): T[] {
  return spread(tracks.filter((t) => t.rating >= minRating && (plays.count.get(t.id) ?? 0) <= maxPlays && (plays.count.get(t.id) ?? 0) > 0 || (t.rating >= minRating && !plays.count.has(t.id)))
    .sort((a, b) => b.rating - a.rating), 2, 2).slice(0, n);
}

/** Songs you loved and have not heard for a while (longest ago first among the best). */
export function forgottenFavourites<T extends MixTrack>(tracks: T[], plays: Plays, now: number, n = 25, minRating = 7.5, quietDays = 21): T[] {
  const cutoff = now - quietDays * 86_400_000;
  return spread(tracks.filter((t) => t.rating >= minRating && (plays.count.get(t.id) ?? 0) > 0 && (plays.last.get(t.id) ?? 0) < cutoff)
    .sort((a, b) => b.rating - a.rating || (plays.last.get(a.id) ?? 0) - (plays.last.get(b.id) ?? 0)), 2, 2).slice(0, n);
}

/** Never-played songs by the artists you rate highest: where a surprise is most likely to land. `artistWeight` maps an artist id to how much you like them. */
export function deepCuts<T extends MixTrack>(tracks: T[], plays: Plays, artistWeight: Map<string, number>, n = 25): T[] {
  return spread(tracks.filter((t) => !plays.count.has(t.id) && (artistWeight.get(t.artistId ?? '') ?? 0) > 0)
    .sort((a, b) => (artistWeight.get(b.artistId ?? '') ?? 0) - (artistWeight.get(a.artistId ?? '') ?? 0)), 3, 2).slice(0, n);
}

/** How much you like each artist: the average rating of their rated tracks, scaled by how many tracks that is (one lucky 10 does not win). */
export function artistWeights(tracks: MixTrack[]): Map<string, number> {
  const by = new Map<string, { sum: number; n: number }>();
  for (const t of tracks) { if (t.rating <= 0.001 || !t.artistId) continue; const e = by.get(t.artistId) ?? { sum: 0, n: 0 }; e.sum += t.rating; e.n++; by.set(t.artistId, e); }
  return new Map([...by].map(([id, e]) => [id, (e.sum / e.n / 10) * Math.log2(1 + e.n)]));
}

/**
 * The mix of the day: about 40% songs you loved and forgot, 30% hidden gems, 30% deep cuts from artists you like; mixed up with the
 * day's seed (so it is the same all day and new tomorrow), never more than two songs by one artist in a row of three.
 */
export function mixOfTheDay<T extends MixTrack>(tracks: T[], plays: Plays, now: number, size = 25): T[] {
  const rnd = seeded(daySeed(now));
  const w = artistWeights(tracks);
  const take = (list: T[], k: number) => shuffle(list.slice(0, k * 3), rnd).slice(0, k);
  const picked = new Set<string>();
  const part = (list: T[], k: number) => take(list.filter((t) => !picked.has(t.id)), k).map((t) => { picked.add(t.id); return t; });
  const a = part(forgottenFavourites(tracks, plays, now, size * 2), Math.round(size * 0.4));
  const b = part(hiddenGems(tracks, plays, size * 2), Math.round(size * 0.3));
  const c = part(deepCuts(tracks, plays, w, size * 2), size - a.length - b.length);
  const rest = part(spread(tracks.filter((t) => t.rating >= 6).sort((x, y) => y.rating - x.rating), 2, 2), Math.max(0, size - a.length - b.length - c.length));
  return spread(shuffle([...a, ...b, ...c, ...rest], rnd), 3, 3);
}

export interface Bucket<T> { key: string; label: string; tracks: T[]; avg: number }

/** Tracks grouped by genre: the ones with enough rated music to make a mix of, best-liked first. */
export function genreBuckets<T extends MixTrack>(tracks: T[], minTracks = 8): Bucket<T>[] {
  const by = new Map<string, T[]>();
  for (const t of tracks) for (const g of t.genres) { const k = g.toLowerCase(); by.set(k, [...(by.get(k) ?? []), t]); }
  return [...by].filter(([, ts]) => ts.length >= minTracks).map(([key, ts]) => {
    const rated = ts.filter((t) => t.rating > 0.001);
    return { key, label: ts[0].genres.find((g) => g.toLowerCase() === key) ?? key, tracks: ts, avg: rated.length ? rated.reduce((s, t) => s + t.rating, 0) / rated.length : 0 };
  }).sort((a, b) => b.avg * Math.log2(1 + b.tracks.length) - a.avg * Math.log2(1 + a.tracks.length));
}

/** Tracks grouped by the decade of their release date ("2010s"), oldest first; undated tracks are left out. */
export function decadeBuckets<T extends MixTrack>(tracks: T[], minTracks = 8): Bucket<T>[] {
  const by = new Map<string, T[]>();
  for (const t of tracks) { const y = Number((t.releaseDate ?? '').slice(0, 4)); if (!y) continue; const k = `${Math.floor(y / 10) * 10}s`; by.set(k, [...(by.get(k) ?? []), t]); }
  return [...by].filter(([, ts]) => ts.length >= minTracks).map(([key, ts]) => {
    const rated = ts.filter((t) => t.rating > 0.001);
    return { key, label: key, tracks: ts, avg: rated.length ? rated.reduce((s, t) => s + t.rating, 0) / rated.length : 0 };
  }).sort((a, b) => a.key.localeCompare(b.key));
}

/** The best of a bucket, for a mix: rated songs first (best first), at most two per album, then shuffled with the day's seed so it is not always the same order. */
export function bucketMix<T extends MixTrack>(b: Bucket<T>, now: number, size = 25): T[] {
  const sorted = [...b.tracks].sort((x, y) => y.rating - x.rating);
  const spreadOut = spread(sorted, 3, 2);
  // a bucket with few artists cannot be spread thin: fill the rest from what is left rather than hand back a short mix
  const best = [...spreadOut, ...sorted.filter((t) => !spreadOut.includes(t))].slice(0, size * 2);
  return shuffle(best, seeded(daySeed(now) + b.key.length)).slice(0, size);
}

export interface Unfinished { albumId: string; heard: number; total: number; missing: string[] }

/** Albums you started but did not finish: some tracks played, some never (at least three tracks), the most-heard first. */
export function unfinishedAlbums(albums: { id: string; trackIds: string[] }[], heard: ReadonlySet<string>, playable: (id: string) => boolean): Unfinished[] {
  return albums.map((a) => {
    const ids = a.trackIds.filter(playable);
    const h = ids.filter((id) => heard.has(id));
    return { albumId: a.id, heard: h.length, total: ids.length, missing: ids.filter((id) => !heard.has(id)) };
  }).filter((u) => u.total >= 3 && u.heard > 0 && u.heard < u.total).sort((a, b) => b.heard / b.total - a.heard / a.total || b.total - a.total);
}
