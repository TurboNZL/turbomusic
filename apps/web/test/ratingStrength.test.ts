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

import { dropMirrorTwins, type Listen } from '../src/lib/listens.ts';
describe('mirror twins', () => {
  const L = (id: string, source: 'spotify' | 'turbomusic', ts: number, mirrored = false): Listen => ({ id, ts, ms: 200000, trackId: 't1', artistId: null, albumId: null, title: 't', artist: 'a', album: '', uri: null, skipped: false, shuffle: null, platform: null, reasonEnd: null, source, ...(mirrored ? { mirrored: true } : {}) });
  it('drops the mirrored TurboMusic play when Spotify has the same play, keeps everything else', () => {
    const out = dropMirrorTwins([L('a', 'turbomusic', 1_000_000, true), L('b', 'spotify', 1_060_000), L('c', 'turbomusic', 9_000_000, true), L('d', 'turbomusic', 1_010_000)]);
    expect(out.map((l) => l.id)).toEqual(['b', 'c', 'd'].filter((x) => x !== 'x'));
  });
});
