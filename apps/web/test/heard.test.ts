import { describe, expect, it } from 'vitest';
import { heardTrackIds, onlyHeard, tryNewPlaylist } from '../src/lib/heard.ts';
import type { Listen } from '../src/lib/listens.ts';

const L = (trackId: string | null) => ({ trackId }) as Listen;
const T = (id: string, albumId: string | null = null) => ({ id, albumId, artistId: 'a' });

describe('heard tracks', () => {
  it('collects tracks with at least one play, ignoring plays that match no track', () => {
    expect([...heardTrackIds([L('1'), L(null), L('1'), L('2')])].sort()).toEqual(['1', '2']);
  });
  it('ranks only heard tracks, but falls back while the history is (almost) empty', () => {
    const tracks = [T('1'), T('2'), T('3')];
    expect(onlyHeard(tracks, new Set(['1', '2']))).toMatchObject({ pool: [tracks[0], tracks[1]], fellBack: false });
    expect(onlyHeard(tracks, new Set(['1']))).toMatchObject({ fellBack: true });
    expect(onlyHeard(tracks, new Set()).pool).toHaveLength(3);
  });
  it('builds the "try something new" list from never-played, playable tracks with a cap per album', () => {
    const tracks = [...Array.from({ length: 6 }, (_, i) => T(`a${i}`, 'A')), T('b0', 'B'), T('heard', 'C'), T('mute', 'D')];
    const out = tryNewPlaylist(tracks, new Set(['heard']), (t) => t.id !== 'mute', 25, 2, () => 0.3);
    expect(out.map((t) => t.id)).not.toContain('heard');
    expect(out.map((t) => t.id)).not.toContain('mute');
    expect(out.filter((t) => t.albumId === 'A')).toHaveLength(2);
    expect(out.map((t) => t.id)).toContain('b0');
    expect(tryNewPlaylist(tracks, new Set(), () => true, 3, 9).length).toBe(3);
  });
});

import { mergeAllTracksOrder } from '../src/lib/albumMerge.ts';
describe('album order after an import', () => {
  const row = (trackId: string | null, newId?: string) => ({ trackId, newId, include: true });
  it('takes the edition order when the edition holds every existing track', () => {
    expect(mergeAllTracksOrder(['a', 'b', 'c'], [row('c'), row('b'), row('a'), row(null, 'n')])).toEqual(['c', 'b', 'a', 'n']);
    expect(mergeAllTracksOrder([], [row(null, 'x'), row(null, 'y')])).toEqual(['x', 'y']);
  });
  it('keeps the album order and slots new tracks in when the edition lacks some', () => {
    expect(mergeAllTracksOrder(['a', 'b', 'c'], [row('a'), row(null, 'n'), row('c')])).toEqual(['a', 'n', 'b', 'c']);
  });
});

import { tasteScorer, isFiller } from '../src/lib/heard.ts';
describe('try something new, by taste', () => {
  const R = (id: string, artistId: string, rating: number, albumId = 'x') => ({ id, title: id, artistId, albumId, effectiveRating: rating, comparisons: 5, allGenres: [] as string[] });
  it('prefers artists whose other songs you rate highly and skips filler', () => {
    const rated = [R('l1', 'loved', 9), R('l2', 'loved', 9.5), R('h1', 'hated', 2), R('h2', 'hated', 1.5)];
    const fresh = [{ ...R('new-loved', 'loved', 0, 'n1'), comparisons: 0 }, { ...R('new-hated', 'hated', 0, 'n2'), comparisons: 0 }, { ...R('Intro', 'loved', 0, 'n3'), comparisons: 0 }];
    const all = [...rated, ...fresh];
    const score = tasteScorer(all);
    expect(score(fresh[0])).toBeGreaterThan(score(fresh[1]));
    const out = tryNewPlaylist(all, new Set(rated.map((t) => t.id)), () => true, 1, 2, () => 0.5, score);
    expect(out.map((t) => t.id)).toEqual(['new-loved']);
    expect(isFiller('Intro')).toBe(true);
    expect(isFiller('Intro to the Night Sky')).toBe(false);
  });
});
