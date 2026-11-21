import { describe, expect, it } from 'vitest';
import { answerPlacement, isPlaced, placedEqual, placedRank, placementCandidates, probeAt, questionsLeft, startPlacement } from '../src/lib/placement.ts';

describe('placing a song by binary search', () => {
  it('finds the position in about log2(n) questions', () => {
    const n = 300, truth = 41; // the song really belongs at position 41 (0-based)
    let p = startPlacement(n), steps = 0;
    while (!isPlaced(p)) { const at = probeAt(p); p = answerPlacement(p, at, truth <= at); steps++; }
    expect(placedRank(p) - 1).toBe(truth);
    expect(steps).toBeLessThanOrEqual(Math.ceil(Math.log2(n + 1)));
  });
  it('can go all the way to the top or the bottom', () => {
    let p = startPlacement(10);
    while (!isPlaced(p)) p = answerPlacement(p, probeAt(p), true);
    expect(placedRank(p)).toBe(1);
    p = startPlacement(10);
    while (!isPlaced(p)) p = answerPlacement(p, probeAt(p), false);
    expect(placedRank(p)).toBe(11);
  });
  it('"about equal" ends it right there', () => {
    const p = startPlacement(50);
    expect(placedRank(placedEqual(p, probeAt(p)))).toBe(26);
    expect(questionsLeft(startPlacement(255))).toBe(8);
  });
  it('suggests loved songs that have few votes', () => {
    const t = [{ id: 'a', comparisons: 2, thumbs: 3 }, { id: 'b', comparisons: 20, thumbs: 5 }, { id: 'c', comparisons: 0, thumbs: 0 }, { id: 'd', comparisons: 4, thumbs: 1 }];
    expect(placementCandidates(t).map((x) => x.id)).toEqual(['a', 'd']);
  });
});
