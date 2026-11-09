import { describe, it, expect } from 'vitest';
import { newId, applyVote, replayVotes, balancedRatings, startTrack, advance, shuffleWithRules, wins, crossfadeFor, crossfadeShiftFor, crossfadeShapeFor } from '../src';

describe('ids', () => {
  it('are unique and time-sortable', () => {
    const a = newId(1000), b = newId(2000);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a < b).toBe(true);
    expect(new Set(Array.from({ length: 1000 }, () => newId())).size).toBe(1000);
  });
});

describe('elo', () => {
  it('thumbs are worth half a win against an equal opponent and need no opponent', () => {
    const r = replayVotes([
      { id: '1', trackAId: 'x', trackBId: '', boost: 1, timestamp: 1 },
      { id: '2', trackAId: 'y', trackBId: '', boost: -1, timestamp: 2 },
    ], ['x', 'y']);
    expect(r.get('x')).toEqual({ elo: 1016, comparisons: 1 });
    expect(r.get('y')).toEqual({ elo: 984, comparisons: 1 });
    expect(r.size).toBe(2); // the empty opponent is not a track
  });
  it('is zero-sum and symmetric', () => {
    const r = applyVote(1000, 1000, 'a');
    expect(r.a).toBeCloseTo(1016); expect(r.b).toBeCloseTo(984);
    expect(applyVote(1000, 1000, 'equal')).toEqual({ a: 1000, b: 1000 });
  });
  it('replay is order-independent of input array and mergeable', () => {
    const v = (id: string, t: number, w: string) => ({ id, trackAId: 'x', trackBId: 'y', winnerId: w, timestamp: t });
    const votes = [v('1', 1, 'x'), v('2', 2, 'y'), v('3', 3, 'x')];
    const a = replayVotes(votes, ['x', 'y']);
    const b = replayVotes([...votes].reverse(), ['x', 'y']);
    expect(a.get('x')).toEqual(b.get('x'));
    expect(a.get('x')!.comparisons).toBe(3);
  });
  it('votes against deleted tracks still shape survivors (matches legacy data)', () => {
    const r = replayVotes([{ id: '1', trackAId: 'x', trackBId: 'gone', winnerId: 'x', timestamp: 1 }], ['x']);
    expect(r.get('x')).toEqual({ elo: 1016, comparisons: 1 });
    expect(r.has('gone')).toBe(false);
  });
  it('balanced ratings span 0-10 and honour the initial-rating floor', () => {
    const ranked = replayVotes([{ id: '1', trackAId: 'x', trackBId: 'y', winnerId: 'x', timestamp: 1 }], ['x', 'y', 'z']);
    const out = balancedRatings(ranked, new Map([['y', 4]]));
    expect(out.get('x')).toBe(10);
    expect(out.get('y')).toBe(4); // scaled 0, floored to 4
    expect(out.get('z')).toBeCloseTo(5.0, 1); // untouched track sits mid-range
  });
});

describe('crossfade rules', () => {
  const base = { trackAId: 'a', trackBId: 'b', playFirstOnShuffle: true, applyToAlbumSource: false };
  it('uses the device setting unless the rule for that exact pair sets its own', () => {
    expect(crossfadeFor([base], 'a', 'b', 4)).toBe(4);
    expect(crossfadeFor([{ ...base, crossfadeSec: 8 }], 'a', 'b', 4)).toBe(8);
    expect(crossfadeFor([{ ...base, crossfadeSec: 0 }], 'a', 'b', 4)).toBe(0); // 0 = cut, even with a device crossfade
    expect(crossfadeFor([{ ...base, crossfadeSec: 8 }], 'a', 'c', 4)).toBe(4); // a different next track: not this rule's pair
    expect(crossfadeFor([{ ...base, crossfadeSec: null }], 'a', 'b', 4)).toBe(4);
  });
  it('honours album-only rules and clamps nonsense', () => {
    expect(crossfadeFor([{ ...base, applyToAlbumSource: true, crossfadeSec: 9 }], 'a', 'b', 2, 'playlist')).toBe(2);
    expect(crossfadeFor([{ ...base, applyToAlbumSource: true, crossfadeSec: 9 }], 'a', 'b', 2, 'album')).toBe(9);
    expect(crossfadeFor([{ ...base, crossfadeSec: 99 }], 'a', 'b', 0)).toBe(12);
    expect(crossfadeFor([], 'a', 'b', -3)).toBe(0);
    expect(crossfadeFor([], 'a', 'b', Number.NaN)).toBe(0);
  });
});

describe('crossfade shape', () => {
  const base = { trackAId: 'a', trackBId: 'b', playFirstOnShuffle: true, applyToAlbumSource: false };
  it('fades both sides unless the rule for that pair turns one off', () => {
    expect(crossfadeShapeFor([base], 'a', 'b')).toEqual({ fadeOut: true, fadeIn: true });
    expect(crossfadeShapeFor([{ ...base, crossfadeIn: false }], 'a', 'b')).toEqual({ fadeOut: true, fadeIn: false });
    expect(crossfadeShapeFor([{ ...base, crossfadeOut: false }], 'a', 'b')).toEqual({ fadeOut: false, fadeIn: true });
    expect(crossfadeShapeFor([{ ...base, crossfadeIn: false }], 'a', 'c')).toEqual({ fadeOut: true, fadeIn: true });
  });
});

describe('queue', () => {
  const rules = [{ trackAId: 'a', trackBId: 'b', playFirstOnShuffle: true, applyToAlbumSource: false }];
  it('injects rule target after the current track', () => {
    const s = startTrack({ user: [], active: [], currentId: null }, 'a', ['a', 'c', 'd'], rules, 'album');
    expect(s.user).toEqual(['b']);
    const n = advance(s, rules, 'album');
    expect(n.currentId).toBe('b');
    expect(n.active).toEqual(['c', 'd']);
  });
  it('does not duplicate when B is already next', () => {
    const s = startTrack({ user: [], active: [], currentId: null }, 'a', ['a', 'b', 'c'], rules);
    expect(s.user).toEqual([]);
  });
  it('album-only rules are skipped for playlists', () => {
    const r = [{ ...rules[0], applyToAlbumSource: true }];
    expect(startTrack({ user: [], active: [], currentId: null }, 'a', ['a', 'c'], r, 'playlist').user).toEqual([]);
  });
  it('shuffle keeps every id and places B right after A', () => {
    for (let i = 0; i < 50; i++) {
      const out = shuffleWithRules(['a', 'b', 'c', 'd', 'e'], rules);
      expect([...out].sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
      expect(out[out.indexOf('a') + 1]).toBe('b');
    }
  });
});

describe('sync conflict rule', () => {
  it('latest wins, deviceId breaks ties', () => {
    expect(wins({ updatedAt: 2, deviceId: 'a' }, { updatedAt: 1, deviceId: 'z' })).toBe(true);
    expect(wins({ updatedAt: 1, deviceId: 'a' }, { updatedAt: 2, deviceId: 'a' })).toBe(false);
    expect(wins({ updatedAt: 1, deviceId: 'b' }, { updatedAt: 1, deviceId: 'a' })).toBe(true);
  });
});

describe('crossfade shift', () => {
  const base = { trackAId: 'a', trackBId: 'b', playFirstOnShuffle: true, applyToAlbumSource: false };
  it('is 0 unless the pair\'s rule moves the fade', () => {
    expect(crossfadeShiftFor([], 'a', 'b')).toBe(0);
    expect(crossfadeShiftFor([base], 'a', 'b')).toBe(0);
    expect(crossfadeShiftFor([{ ...base, crossfadeShiftSec: 2.5 }], 'a', 'b')).toBe(2.5);
    expect(crossfadeShiftFor([{ ...base, crossfadeShiftSec: 2.5 }], 'a', 'c')).toBe(0);
  });
  it('is clamped to 0..12 and ignores junk', () => {
    expect(crossfadeShiftFor([{ ...base, crossfadeShiftSec: 99 }], 'a', 'b')).toBe(12);
    expect(crossfadeShiftFor([{ ...base, crossfadeShiftSec: -3 }], 'a', 'b')).toBe(0);
    expect(crossfadeShiftFor([{ ...base, crossfadeShiftSec: Number.NaN }], 'a', 'b')).toBe(0);
  });
});
