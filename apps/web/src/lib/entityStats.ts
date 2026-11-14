import type { Library, Track } from './library.ts';
import { buildListens, combinePreReleases, type Listen } from './listens.ts';
import { computeListenStats, type ListenStats } from './listenStats.ts';
import { playlistTrackIds } from './playlists.ts';

export type StatsKind = 'track' | 'artist' | 'album' | 'era' | 'playlist';
export const STATS_KINDS: StatsKind[] = ['track', 'artist', 'album', 'era', 'playlist'];
export const isStatsKind = (k: string | undefined): k is StatsKind => !!k && (STATS_KINDS as string[]).includes(k);
export const statsPath = (kind: StatsKind, id: string) => `/stats/${kind}/${id}`;

/** The tracks an entity stands for: an artist's are everything they are credited on (like the artist page), an era's its albums' plus its singles'. */
export function entityTrackIds(lib: Library, kind: StatsKind, id: string): string[] | null {
  if (kind === 'track') return lib.trackById.has(id) ? [id] : null;
  if (kind === 'album') return lib.albumById.get(id)?.trackIds ?? null;
  if (kind === 'artist') return lib.artistById.has(id) ? lib.tracks.filter((t) => t.credits.some((c) => c.artistId === id)).map((t) => t.id) : null;
  if (kind === 'era') {
    const era = lib.eraById.get(id);
    if (!era) return null;
    const ids = [...era.albumIds.flatMap((a) => lib.albumById.get(a)?.trackIds ?? []), ...era.trackIds].filter((t) => lib.trackById.has(t));
    return [...new Set(ids)];
  }
  const p = lib.playlists.find((x) => x.id === id);
  return p ? [...new Set(playlistTrackIds(lib, p))] : null;
}

export interface VoteTally { wins: number; losses: number; draws: number }

/** Wins, losses and draws summed over a set of tracks (one pass over the votes; a thumb counts as a win or a loss). */
export function tallyVotes(lib: Library, ids: Set<string>): VoteTally {
  const out = { wins: 0, losses: 0, draws: 0 };
  for (const v of lib.votes) {
    const a = ids.has(v.trackAId), b = !!v.trackBId && ids.has(v.trackBId);
    if (!a && !b) continue;
    if (v.boost) { if (a) { if (v.boost > 0) out.wins++; else out.losses++; } continue; }
    if (v.isEqual) { out.draws += (a ? 1 : 0) + (b ? 1 : 0); continue; }
    if (a) { if (v.winnerId === v.trackAId) out.wins++; else out.losses++; }
    if (b) { if (v.winnerId === v.trackBId) out.wins++; else out.losses++; }
  }
  return out;
}

export interface RatingSummary {
  /** mean of the rated tracks' ratings, null when none is rated */
  avg: number | null;
  rated: number;
  /** tracks per rating band: 0-1, 1-2, ... 9-10 */
  histogram: number[];
  best: Track[];
  worst: Track[];
}

export function summarizeRatings(tracks: Track[], n = 5): RatingSummary {
  const rated = tracks.filter((t) => t.effectiveRating > 0.001);
  const histogram = Array<number>(10).fill(0);
  for (const t of rated) histogram[Math.min(9, Math.floor(t.effectiveRating))]++;
  const sorted = [...rated].sort((a, b) => b.effectiveRating - a.effectiveRating || b.elo - a.elo);
  return {
    avg: rated.length ? rated.reduce((s, t) => s + t.effectiveRating, 0) / rated.length : null,
    rated: rated.length, histogram,
    best: sorted.slice(0, n), worst: sorted.length > n ? sorted.slice(-n).reverse() : [],
  };
}

export interface EntityStats {
  tracks: Track[];
  listens: Listen[];
  /** the same numbers the Stats page shows, for these tracks only */
  listen: ListenStats;
  rating: RatingSummary;
  votes: VoteTally;
  /** how many of the tracks have playable audio on the server */
  withAudio: number;
  /** per track: plays, for the "most played" lists */
  playsByTrack: Map<string, { plays: number; ms: number }>;
}

/** Everything a stats page shows about a set of tracks. Pure. */
export function entityStats(lib: Library, trackIds: string[], minMs = 0, combinePre = false): EntityStats {
  const set = new Set(trackIds);
  const tracks = trackIds.flatMap((id) => lib.trackById.get(id) ?? []);
  // with `combinePre` the plays of tied pre-release versions count as plays of the released track
  const listens = (combinePre ? combinePreReleases(lib, buildListens(lib)) : buildListens(lib)).filter((l) => l.trackId && set.has(l.trackId) && l.ms >= minMs);
  const playsByTrack = new Map<string, { plays: number; ms: number }>();
  for (const l of listens) {
    const r = playsByTrack.get(l.trackId!) ?? { plays: 0, ms: 0 };
    r.plays++; r.ms += l.ms; playsByTrack.set(l.trackId!, r);
  }
  return {
    tracks, listens, listen: computeListenStats(listens, {}, { topN: 25, minMs }), rating: summarizeRatings(tracks),
    votes: tallyVotes(lib, set), withAudio: tracks.filter((t) => !!t.file).length, playsByTrack,
  };
}
