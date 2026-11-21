/**
 * "Place a song": find where one song belongs in your ranking by asking about a few of the others, the way you would sort a
 * bookshelf: compare it with the song in the middle, then the middle of the half it belongs in, and so on. Eight questions place a
 * song among a few hundred. Each answer is saved as an ordinary vote, so the ranking learns from it like from any other.
 *
 * `ranked` is the list the questions are drawn from, best first. The song belongs somewhere in `[lo, hi]` (positions in that list,
 * `hi` exclusive); it is placed when the range is empty.
 */
export interface Placement { lo: number; hi: number; asked: number }

export const startPlacement = (n: number): Placement => ({ lo: 0, hi: n, asked: 0 });
export const isPlaced = (p: Placement) => p.lo >= p.hi;
/** the position to compare against next */
export const probeAt = (p: Placement) => Math.floor((p.lo + p.hi) / 2);
/** the song is better than the one at `at` (it belongs above it) or not (below it) */
export const answerPlacement = (p: Placement, at: number, better: boolean): Placement => (better ? { lo: p.lo, hi: at, asked: p.asked + 1 } : { lo: at + 1, hi: p.hi, asked: p.asked + 1 });
/** "about equal": it sits right there */
export const placedEqual = (p: Placement, at: number): Placement => ({ lo: at, hi: at, asked: p.asked + 1 });
/** how many questions are still needed at most */
export const questionsLeft = (p: Placement) => (isPlaced(p) ? 0 : Math.ceil(Math.log2(p.hi - p.lo + 1)));
/** the final position (1 = best) in the list of `n` */
export const placedRank = (p: Placement) => p.lo + 1;
/** the songs worth placing: loved (thumbs up) or favourite-looking but with too few votes to have a trustworthy position */
export function placementCandidates<T extends { id: string; comparisons: number; thumbs?: number }>(tracks: readonly T[], max = 8): T[] {
  return tracks.filter((t) => t.comparisons < 8 && (t.thumbs ?? 0) > 0).sort((a, b) => (b.thumbs ?? 0) - (a.thumbs ?? 0) || a.comparisons - b.comparisons).slice(0, max);
}
