import { describe, expect, it } from 'vitest';
import { matchGenre, planGenreMerge } from '../src/lib/genreOps.ts';

describe('matching a suggested genre to the library', () => {
  const have = ['Hip-Hop', 'Rap', 'Pop', 'R&B'];
  it('finds the same genre however it is spelt', () => {
    expect(matchGenre('hip hop', have)).toEqual({ kind: 'existing', name: 'Hip-Hop' });
    expect(matchGenre('R & B', have)).toEqual({ kind: 'existing', name: 'R&B' });
  });
  it('asks when a suggestion is made of genres that exist', () => {
    expect(matchGenre('Hip-Hop/Rap', have)).toEqual({ kind: 'similar', candidates: ['Hip-Hop', 'Rap'] });
    expect(matchGenre('canadian hip hop', have)).toEqual({ kind: 'similar', candidates: ['Hip-Hop'] });
  });
  it('is new when nothing resembles it', () => {
    expect(matchGenre('Shoegaze', have)).toEqual({ kind: 'new' });
    expect(matchGenre('  ', have)).toEqual({ kind: 'new' });
  });
});

describe('merging tags', () => {
  it('replaces and de-duplicates, touching only what changes', () => {
    const r = planGenreMerge([{ id: 'a', genres: ['Rap', 'Pop'] }, { id: 'b', genres: ['Hip-Hop', 'rap'] }, { id: 'c', genres: ['Pop'] }], ['rap', 'Hip Hop'], 'Hip-Hop');
    expect(r).toEqual([{ id: 'a', genres: ['Hip-Hop', 'Pop'] }, { id: 'b', genres: ['Hip-Hop'] }]);
  });
  it('never merges a tag into itself', () => {
    expect(planGenreMerge([{ id: 'a', genres: ['Rap'] }], ['Rap'], 'rap')).toEqual([]);
  });
});
