import { describe, expect, it } from 'vitest';
import { ratingStrength } from '../src/lib/library.ts';

describe('ratingStrength', () => {
  it('puts a consistently good album above a one-hit wonder', () => {
    const oneHit = ratingStrength([10]);
    const solid = ratingStrength([8, 8, 8, 7.5, 8, 8, 7]);
    expect(solid).toBeGreaterThan(oneHit);
  });
  it('lets mediocre tracks add nothing and never go negative', () => {
    expect(ratingStrength([5, 3, 5.5])).toBe(0);
    expect(ratingStrength([9, 5])).toBeCloseTo(3.5);
  });
});
