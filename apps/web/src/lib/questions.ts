import type { VoteData } from '@turbomusic/core';
import { pickPair } from './pairing.ts';

export interface Q { id: string; elo: number; comparisons: number; rating: number }

/**
 * The Elo questions on the home page. Each is chosen to move the ranking as much as possible: a vote between two near-equal tracks
 * shifts Elo the most (expected score 0.5), and a track with few comparisons has the least certain rating. Four formats:
 *  - duel: two tracks close in Elo, one of them rarely compared. Who wins?
 *  - triple: three tracks close together. The favourite beats both others (two votes).
 *  - benchmark: "Is X better than <the track at your 90th percentile>?" settles whether it belongs near the top.
 *  - love: "Do you love X?" for a track with almost no votes: a thumb (boost) either way.
 * Pure: `rnd` is injected so it is testable.
 */
export type Question =
  | { kind: 'duel'; a: string; b: string; why: string }
  | { kind: 'triple'; ids: [string, string, string]; why: string }
  | { kind: 'benchmark'; id: string; ref: string; why: string }
  | { kind: 'love'; id: string; why: string };

export const FORMATS: Question['kind'][] = ['duel', 'triple', 'benchmark', 'love'];

export function makeQuestion(tracks: Q[], kind: Question['kind'], rnd: () => number = Math.random): Question | null {
  if (tracks.length < 2) return null;
  const least = [...tracks].sort((x, y) => x.comparisons - y.comparisons);
  const pickLeast = () => { const s = least.slice(0, Math.max(5, Math.ceil(tracks.length * 0.15))); return s[Math.floor(rnd() * s.length)]; };
  if (kind === 'duel') {
    const p = pickPair(tracks, rnd);
    if (!p) return null;
    const gap = Math.abs(p[0].rating - p[1].rating);
    return { kind, a: p[0].id, b: p[1].id, why: gap < 0.3 ? 'A close call: your ratings for these two are almost the same.' : `You rate one ${gap.toFixed(1)} above the other: does it hold?` };
  }
  if (kind === 'triple' && tracks.length >= 3) {
    const a = pickLeast();
    const near = tracks.filter((t) => t.id !== a.id).sort((x, y) => Math.abs(x.elo - a.elo) - Math.abs(y.elo - a.elo)).slice(0, 8);
    const picks = [...near].sort(() => rnd() - 0.5).slice(0, 2);
    const ids = [a, ...picks].sort(() => rnd() - 0.5).map((t) => t.id) as [string, string, string];
    return { kind, ids, why: 'Three at about the same level. Your favourite beats both others, which settles two matches at once.' };
  }
  if (kind === 'benchmark') {
    const ranked = [...tracks].filter((t) => t.comparisons > 0).sort((x, y) => y.elo - x.elo);
    if (ranked.length < 10) return null;
    const ref = ranked[Math.floor(ranked.length * 0.1)];
    // the track nearest the line, so the answer actually tells something: rated 7-9, few comparisons
    const cand = tracks.filter((t) => t.id !== ref.id && t.comparisons <= 4).sort((x, y) => Math.abs(x.elo - ref.elo) - Math.abs(y.elo - ref.elo)).slice(0, 6);
    const t = cand[Math.floor(rnd() * cand.length)];
    return t ? { kind, id: t.id, ref: ref.id, why: `Which is better? The track on the left sits at your top-10% line (${ref.rating.toFixed(1)}); picking the challenger says it belongs up there too.` } : null;
  }
  if (kind === 'love') {
    const t = least.find((x, i) => x.comparisons <= 1 && i >= Math.floor(rnd() * 10)) ?? least[0];
    return { kind, id: t.id, why: t.comparisons === 0 ? 'Never compared yet, so any answer teaches the ranking something.' : 'Only one vote so far.' };
  }
  return makeQuestion(tracks, 'duel', rnd);
}

/** A random format, skipping ones that do not apply to this library. */
export function nextQuestion(tracks: Q[], prev?: Question['kind'], rnd: () => number = Math.random): Question | null {
  const order = FORMATS.filter((k) => k !== prev).sort(() => rnd() - 0.5);
  for (const k of order) { const q = makeQuestion(tracks, k, rnd); if (q) return q; }
  return makeQuestion(tracks, 'duel', rnd);
}

const vote = (winnerId: string | null, a: string, b: string, isEqual = false): VoteData => ({ trackAId: a, trackBId: b, winnerId, isEqual, timestamp: Date.now() });
const boost = (id: string, b: 1 | -1): VoteData => ({ trackAId: id, trackBId: '', winnerId: null, isEqual: false, boost: b, timestamp: Date.now() });

/** The votes an answer records. `answer`: a track id (duel, triple), 'yes' | 'no' (benchmark, love), 'equal', or 'skip' (nothing). */
export function votesFor(q: Question, answer: string): VoteData[] {
  if (answer === 'skip') return [];
  if (q.kind === 'duel') return answer === 'equal' ? [vote(null, q.a, q.b, true)] : [vote(answer, q.a, q.b)];
  if (q.kind === 'triple') return q.ids.includes(answer) ? q.ids.filter((id) => id !== answer).map((o) => vote(answer, answer, o)) : [];
  if (q.kind === 'benchmark') return answer === 'yes' ? [vote(q.id, q.id, q.ref)] : answer === 'no' ? [vote(q.ref, q.id, q.ref)] : [vote(null, q.id, q.ref, true)];
  return answer === 'yes' ? [boost(q.id, 1)] : answer === 'no' ? [boost(q.id, -1)] : [];
}
