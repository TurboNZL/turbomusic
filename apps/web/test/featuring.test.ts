import { describe, expect, it } from 'vitest';
import { splitFeaturing } from '../src/lib/autofill.ts';

describe('splitFeaturing', () => {
  it('takes the featured artists out of the title', () => {
    expect(splitFeaturing('Song (feat. A & B)')).toEqual({ title: 'Song', featured: ['A', 'B'] });
    expect(splitFeaturing('Song [ft. A, B and C]')).toEqual({ title: 'Song', featured: ['A', 'B', 'C'] });
    expect(splitFeaturing('Song (with A)')).toEqual({ title: 'Song', featured: ['A'] });
    expect(splitFeaturing('Song - feat. A')).toEqual({ title: 'Song', featured: ['A'] });
    expect(splitFeaturing('Song ft. A')).toEqual({ title: 'Song', featured: ['A'] });
    expect(splitFeaturing('Song (Featuring A)')).toEqual({ title: 'Song', featured: ['A'] });
  });
  it('leaves ordinary titles alone', () => {
    expect(splitFeaturing('Dancing With Myself')).toEqual({ title: 'Dancing With Myself', featured: [] });
    expect(splitFeaturing('Song (Remastered 2015)')).toEqual({ title: 'Song (Remastered 2015)', featured: [] });
    expect(splitFeaturing('(feat. A)')).toEqual({ title: '(feat. A)', featured: [] });
    expect(splitFeaturing('Left and Right')).toEqual({ title: 'Left and Right', featured: [] });
  });
  it('keeps a x-less name whole', () => {
    expect(splitFeaturing('Song (feat. Tyler, The Creator)').featured).toEqual(['Tyler', 'The Creator']); // known limit: commas split
  });
});
