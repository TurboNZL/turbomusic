import { describe, expect, it } from 'vitest';
import { fitPreferences, preferenceRatings, replayVotes, thumbBonus, type Vote } from '../src/index.ts';

let n = 0;
const V = (a: string, b: string, winner: string | null, extra: Partial<Vote> = {}): Vote => ({ id: `v${n++}`, trackAId: a, trackBId: b, winnerId: winner, isEqual: winner === null, timestamp: n, ...extra });
const ids = ['a', 'b', 'c', 'd'];

describe('preference fit', () => {
  it('does not depend on the order the votes were cast in', () => {
    const votes = [V('a', 'b', 'a'), V('b', 'c', 'b'), V('a', 'c', 'a'), V('c', 'd', 'c'), V('b', 'd', 'b'), V('a', 'd', 'a')];
    const fwd = fitPreferences(votes, ids), rev = fitPreferences([...votes].reverse().map((v, i) => ({ ...v, timestamp: i })), ids);
    for (const id of ids) expect(fwd.get(id)!.elo).toBeCloseTo(rev.get(id)!.elo, 3);
    // and it orders them by what the votes say
    expect(fwd.get('a')!.elo).toBeGreaterThan(fwd.get('b')!.elo);
    expect(fwd.get('b')!.elo).toBeGreaterThan(fwd.get('c')!.elo);
    expect(fwd.get('c')!.elo).toBeGreaterThan(fwd.get('d')!.elo);
  });
  it('an old vote keeps its weight: Elo forgets it, the fit does not', () => {
    const early = [V('a', 'b', 'a'), V('a', 'b', 'a'), V('a', 'b', 'a')];
    const later = Array.from({ length: 12 }, (_, i) => V(i % 2 ? 'b' : 'a', i % 2 ? 'c' : 'd', i % 2 ? 'b' : 'a'));
    const fit = fitPreferences([...early, ...later], ids);
    expect(fit.get('a')!.elo).toBeGreaterThan(fit.get('b')!.elo - 1); // a beat b three times and was never beaten
  });
  it('holds an undefeated track with one vote near the middle, and lets many votes move it', () => {
    const one = fitPreferences([V('a', 'b', 'a')], ids);
    const many = fitPreferences(Array.from({ length: 10 }, () => V('a', 'b', 'a')), ids);
    expect(one.get('a')!.elo - 1000).toBeLessThan(many.get('a')!.elo - 1000);
    expect(one.get('a')!.elo - 1000).toBeLessThan(120);
    expect(many.get('a')!.sigma).toBeLessThan(one.get('a')!.sigma);
  });
  it('a "much better" answer counts more than an ordinary one', () => {
    const plain = fitPreferences([V('a', 'b', 'a'), V('a', 'c', 'c')], ids);
    const strong = fitPreferences([V('a', 'b', 'a', { weight: 2.5 }), V('a', 'c', 'c')], ids);
    expect(strong.get('a')!.elo).toBeGreaterThan(plain.get('a')!.elo);
  });
  it('thumbs lift a track behind the scenes with diminishing returns, and count as comparisons', () => {
    const up = fitPreferences([V('a', '', null, { boost: 1 }), V('a', '', null, { boost: 1 })], ids);
    expect(up.get('a')!.elo).toBeGreaterThan(1000);
    expect(up.get('a')!.comparisons).toBe(2);
    expect(up.get('a')!.thumbs).toBe(2);
    expect(thumbBonus(10) / thumbBonus(1)).toBeLessThan(4);
    expect(thumbBonus(-3)).toBeLessThan(0);
  });
  it('maps strengths to a bell-curve rating where one outlier does not squash the rest', () => {
    const many = Array.from({ length: 20 }, (_, i) => `t${i}`);
    const votes: Vote[] = [];
    for (let k = 0; k < many.length - 1; k++) votes.push(V(many[k], many[k + 1], many[k]), V(many[k], many[k + 1], many[k]), V(many[k], many[k + 1], many[k]));
    const fit = fitPreferences(votes, many);
    const r = preferenceRatings(fit);
    expect(r.get('t0')!).toBeGreaterThan(r.get('t10')!);
    expect(r.get('t10')!).toBeGreaterThan(r.get('t19')!);
    for (const v of r.values()) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(10); }
    // spread across the scale, not crushed into the middle
    expect(r.get('t0')! - r.get('t19')!).toBeGreaterThan(4);
    expect(preferenceRatings(fit, new Map([['t19', 8]])).get('t19')).toBe(8);
  });
  it('agrees with Elo on who is ahead for a simple library', () => {
    const votes = [V('a', 'b', 'a'), V('b', 'c', 'b'), V('a', 'c', 'a')];
    const elo = replayVotes(votes, ids);
    const fit = fitPreferences(votes, ids);
    expect(Math.sign(fit.get('a')!.elo - fit.get('c')!.elo)).toBe(Math.sign(elo.get('a')!.elo - elo.get('c')!.elo));
  });
});
