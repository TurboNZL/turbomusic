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

import { makeQuestion, votesFor } from '../src/lib/questions.ts';
describe('quad and odd-one-out questions', () => {
  const pool = Array.from({ length: 12 }, (_, i) => ({ id: `t${i}`, elo: 1000 + i, comparisons: i, rating: 5 }));
  it('quad: the favourite beats the other three', () => {
    const q = makeQuestion(pool, 'quad')!;
    expect(q.kind).toBe('quad');
    const v = votesFor(q, (q as { ids: string[] }).ids[1]);
    expect(v).toHaveLength(3);
    expect(v.every((x) => x.winnerId === (q as { ids: string[] }).ids[1])).toBe(true);
  });
  it('odd: the other two each beat the one you like least', () => {
    const q = makeQuestion(pool, 'odd')!;
    const ids = (q as { ids: string[] }).ids, worst = ids[0];
    const v = votesFor(q, worst);
    expect(v).toHaveLength(2);
    expect(v.every((x) => x.winnerId !== worst && [x.trackAId, x.trackBId].includes(worst))).toBe(true);
  });
});

import { albumStartElo, replayVotes } from '@turbomusic/core';
describe('album ranking lifts starting Elo', () => {
  it('half the lead, capped, and tracks start from it', () => {
    expect(albumStartElo(1000)).toBe(1000);
    expect(albumStartElo(1100)).toBe(1050);
    expect(albumStartElo(5000)).toBe(1150);
    expect(albumStartElo(0)).toBe(850);
    const r = replayVotes([], ['a', 'b'], new Map([['a', 1100]]));
    expect(r.get('a')!.elo).toBe(1100);
    expect(r.get('b')!.elo).toBe(1000);
  });
});
