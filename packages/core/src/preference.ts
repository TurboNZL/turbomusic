import { ELO_START, type RankedTrack, type Vote } from './elo.ts';

/**
 * The "preference" rating model: every vote you ever cast is taken into account at once, not replayed one by one.
 *
 * Elo (elo.ts) lets each vote move the two tracks by an amount that depends on what they happened to be rated at that moment, so the
 * order the votes came in matters, an old vote fades as newer ones stack on top, and beating a song can push it down more than you meant.
 * Here the whole vote log is fitted together (a Bradley-Terry model): the strengths that explain ALL your answers best. Consequences:
 *  - "this one > that one" counts the same whenever you said it, and keeps counting;
 *  - the order the votes were cast in does not matter, so merging devices is trivially safe;
 *  - contradictions (A > B > C > A) are settled by the evidence, not by whichever vote came last;
 *  - a track with few votes is held near the middle (or near its album's start) until its votes say otherwise.
 * Thumbs up/down are NOT comparisons: they add a small bonus on top of the fitted strength, so liking a song a lot lifts it behind the
 * scenes without the ranking pretending it beat anybody.
 */
export const PREF_SCALE = 400 / Math.LN10; // Elo points per natural-log unit of strength
/** how many "virtual games" against an average opponent hold a track near its start while it has few real votes */
export const PRIOR_GAMES = 1.5;
/** worth of one thumb, in natural-log strength units; repeated thumbs on one track count less each time */
export const THUMB_STEP = 0.3;
/** a "much better" answer counts as this many ordinary ones */
export const STRONG_WEIGHT = 2.5;

export interface FittedTrack extends RankedTrack {
  /** the fitted strength before the thumb bonus, in Elo points above 1000 */
  fitted: number;
  /** thumbs net of thumbs-down (+up, -down) */
  thumbs: number;
  /** rough uncertainty of `elo` in Elo points: shrinks as votes arrive */
  sigma: number;
}

const weightOf = (v: Vote) => (v.weight && v.weight > 0 ? Math.min(v.weight, 5) : 1);

/** The bonus (in strength units) of a net number of thumbs: diminishing, so ten thumbs are not ten times one. */
export const thumbBonus = (net: number) => Math.sign(net) * THUMB_STEP * Math.log2(1 + Math.abs(net));

/**
 * Fit every vote at once. Returns every track in `trackIds` (votes against deleted tracks still shape the survivors, as in Elo, but
 * ghosts are not returned). `starts` is where a track starts before any vote (Elo points, 1000 = average), see `albumStartElo`.
 */
export function fitPreferences(votes: Vote[], trackIds: Iterable<string>, starts?: ReadonlyMap<string, number>, iterations = 80): Map<string, FittedTrack> {
  const ids = new Map<string, number>();
  const idOf = (id: string) => { let i = ids.get(id); if (i === undefined) ids.set(id, (i = ids.size)); return i; };
  const real = [...trackIds];
  for (const id of real) idOf(id);

  // pairwise games: (i, j, wins of i, weight of the game)
  const games: { i: number; j: number; wi: number; w: number }[] = [];
  const comparisons: number[] = [];
  const thumbs: number[] = [];
  const bump = (arr: number[], i: number, by: number) => { while (arr.length <= i) arr.push(0); arr[i] += by; };
  for (const v of votes) {
    if (v.boost) { const i = idOf(v.trackAId); bump(comparisons, i, 1); bump(thumbs, i, v.boost); continue; }
    const i = idOf(v.trackAId), j = idOf(v.trackBId);
    if (i === j) continue;
    const w = weightOf(v);
    games.push({ i, j, wi: v.isEqual ? 0.5 : v.winnerId === v.trackAId ? 1 : 0, w });
    bump(comparisons, i, 1); bump(comparisons, j, 1);
  }
  const n = ids.size;
  while (comparisons.length < n) comparisons.push(0);
  while (thumbs.length < n) thumbs.push(0);

  // each track's start (log strength) and the virtual average opponent that holds it there
  const startLog = new Array<number>(n).fill(0);
  if (starts) for (const [id, elo] of starts) { const i = ids.get(id); if (i !== undefined) startLog[i] = (elo - ELO_START) / PREF_SCALE; }

  // MM iterations for weighted Bradley-Terry with a fixed virtual opponent per track
  const g = new Array<number>(n).fill(1);
  for (let i = 0; i < n; i++) g[i] = Math.exp(startLog[i]);
  const wins = new Array<number>(n).fill(0);
  for (const x of games) { wins[x.i] += x.wi * x.w; wins[x.j] += (1 - x.wi) * x.w; }
  for (let i = 0; i < n; i++) wins[i] += PRIOR_GAMES / 2;
  const denom = new Array<number>(n);
  for (let it = 0; it < iterations; it++) {
    denom.fill(0);
    for (const x of games) { const d = x.w / (g[x.i] + g[x.j]); denom[x.i] += d; denom[x.j] += d; }
    let delta = 0;
    for (let i = 0; i < n; i++) {
      const vs = Math.exp(startLog[i]);
      const d = denom[i] + PRIOR_GAMES / (g[i] + vs);
      const next = wins[i] / d;
      delta = Math.max(delta, Math.abs(Math.log(next / g[i])));
      g[i] = next;
    }
    // the average real track stays at the neutral point so scores keep their meaning as votes arrive
    let mean = 0, count = 0;
    for (const id of real) { mean += Math.log(g[ids.get(id)!]); count++; }
    if (count) { const shift = Math.exp(mean / count); for (let i = 0; i < n; i++) g[i] /= shift; }
    if (delta < 1e-6) break;
  }

  const out = new Map<string, FittedTrack>();
  for (const id of real) {
    const i = ids.get(id)!;
    const fitted = Math.log(g[i]) * PREF_SCALE;
    const net = thumbs[i];
    const elo = ELO_START + fitted + thumbBonus(net) * PREF_SCALE;
    // information ~ games played: sigma in strength units is 1/sqrt(n * p(1-p)) with p near .5, floored by the prior
    const nn = comparisons[i] + PRIOR_GAMES;
    out.set(id, { elo, comparisons: comparisons[i], fitted, thumbs: net, sigma: (2 / Math.sqrt(nn)) * PREF_SCALE * 0.5 });
  }
  return out;
}

/**
 * Map fitted strengths to a 0-10 rating on a bell curve instead of min..max: 5.5 is the average of your tracks that have enough votes,
 * and each standard deviation is about 1.8 points, so one extreme outlier no longer squashes everyone else and the top of the ranking
 * stays spread out. A manual `initialRating` is a floor, as with Elo. Tracks with fewer than `minComparisons` votes are placed using
 * the same curve (their strength is already held near the middle) but callers only show them with enough votes.
 */
export function preferenceRatings(
  fitted: Map<string, FittedTrack>,
  initialRatings: Map<string, number | null | undefined> = new Map(),
  minComparisons = 3,
): Map<string, number> {
  const ref = [...fitted.values()].filter((r) => r.comparisons >= minComparisons);
  const pool = ref.length >= 3 ? ref : [...fitted.values()];
  const mean = pool.reduce((s, r) => s + r.elo, 0) / Math.max(1, pool.length);
  const sd = Math.sqrt(pool.reduce((s, r) => s + (r.elo - mean) ** 2, 0) / Math.max(1, pool.length)) || 1;
  const raw = new Map<string, number>();
  for (const [id, r] of fitted) raw.set(id, 5.5 + 1.8 * ((r.elo - mean) / sd));
  // the best track of the pool is the 10 (the ten-star list starts there, as it always did); everything above the average is stretched to match
  const hi = Math.max(...pool.map((r) => 5.5 + 1.8 * ((r.elo - mean) / sd)));
  const stretch = hi > 5.5 ? 4.5 / Math.max(0.5, hi - 5.5) : 1;
  const out = new Map<string, number>();
  for (const [id, v] of raw) {
    const rating = Math.max(0, Math.min(10, v > 5.5 ? 5.5 + (v - 5.5) * stretch : v));
    out.set(id, Math.max(rating, initialRatings.get(id) ?? 0));
  }
  return out;
}
