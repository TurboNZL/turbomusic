export const ELO_START = 1000;
export const ELO_K = 32;

export interface Vote {
  id: string;
  trackAId: string;
  trackBId: string;
  /** null/undefined when isEqual */
  winnerId?: string | null;
  isEqual?: boolean;
  /** A thumbs up (+1) or down (-1) on one track (trackBId is then ''): worth half a win/loss against an equal opponent. */
  boost?: 1 | -1;
  /** how much this answer counts (1 = ordinary, 2.5 = "much better"); only the preference model reads it */
  weight?: number;
  timestamp: number;
}

export interface RankedTrack {
  elo: number;
  comparisons: number;
}

export function expectedScore(ra: number, rb: number): number {
  return 1 / (1 + Math.pow(10, (rb - ra) / 400));
}

/** Pure single-vote update. Returns new ratings for A and B. */
export function applyVote(ra: number, rb: number, outcome: 'a' | 'b' | 'equal', k = ELO_K) {
  const sa = outcome === 'equal' ? 0.5 : outcome === 'a' ? 1 : 0;
  return {
    a: ra + k * (sa - expectedScore(ra, rb)),
    b: rb + k * (1 - sa - expectedScore(rb, ra)),
  };
}

/**
 * Elo is DERIVED from the append-only vote log, never stored as mutable truth.
 * That makes votes from several devices mergeable: union the logs, replay in time order.
 *
 * Votes against since-deleted tracks still count: the surviving track's score was shaped by
 * that opponent. Verified against a real library: replaying every vote (ghosts included)
 * reproduces the legacy stored Elo and comparison counts exactly. Ghosts are not returned.
 */
export function replayVotes(votes: Vote[], trackIds: Iterable<string>, starts?: ReadonlyMap<string, number>): Map<string, RankedTrack> {
  const all = new Map<string, RankedTrack>();
  const get = (id: string) => {
    let r = all.get(id);
    if (!r) all.set(id, (r = { elo: starts?.get(id) ?? ELO_START, comparisons: 0 }));
    return r;
  };
  const ordered = [...votes].sort((x, y) => x.timestamp - y.timestamp || (x.id < y.id ? -1 : 1));
  for (const v of ordered) {
    if (v.boost) {
      const a = get(v.trackAId);
      a.elo += ELO_K * 0.5 * v.boost;
      a.comparisons++;
      continue;
    }
    const a = get(v.trackAId);
    const b = get(v.trackBId);
    const outcome = v.isEqual ? 'equal' : v.winnerId === v.trackAId ? 'a' : 'b';
    const next = applyVote(a.elo, b.elo, outcome);
    a.elo = next.a; b.elo = next.b;
    a.comparisons++; b.comparisons++;
  }
  const out = new Map<string, RankedTrack>();
  for (const id of trackIds) out.set(id, all.get(id) ?? { elo: starts?.get(id) ?? ELO_START, comparisons: 0 });
  return out;
}

/**
 * Map Elo to a 0-10 rating (min..max over ALL tracks, as the legacy app did; verified to
 * reproduce every stored rating). A track's manual `initialRating` is a floor.
 */
export function balancedRatings(
  ranked: Map<string, RankedTrack>,
  initialRatings: Map<string, number | null | undefined> = new Map(),
): Map<string, number> {
  const elos = [...ranked.values()].map((r) => r.elo);
  const min = Math.min(...elos);
  const max = Math.max(...elos);
  const out = new Map<string, number>();
  for (const [id, r] of ranked) {
    const scaled = max > min ? ((r.elo - min) / (max - min)) * 10 : 5;
    out.set(id, Math.max(scaled, initialRatings.get(id) ?? 0));
  }
  return out;
}

/**
 * Where a track starts when its album has been ranked against other albums: half of the album's lead over (or distance under) the
 * starting Elo, at most 150 either way, so a loved album lifts its tracks a little before any of them is voted on, and the votes on the
 * tracks themselves still decide the rest.
 */
export const albumStartElo = (albumElo: number): number => ELO_START + Math.max(-150, Math.min(150, (albumElo - ELO_START) * 0.5));
