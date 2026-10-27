import { describe, expect, it } from 'vitest';
import { thumbLists } from '../src/lib/playlists.ts';

const v = (id: string, boost: 1 | -1 | undefined, timestamp = 1) => ({ trackAId: id, boost, timestamp });

describe('thumbLists', () => {
  it('splits by which thumb wins and leaves out ties, untouched tracks and head-to-head votes', () => {
    const r = thumbLists([v('a', 1), v('a', 1), v('a', -1), v('b', -1), v('c', 1), v('c', -1), v('d', undefined), v('e', 1, 5), v('e', 1, 6)]);
    expect(r.liked).toEqual(['e', 'a']); // e is two ahead, a one ahead
    expect(r.disliked).toEqual(['b']);
  });
  it('moves a track when a later thumb changes the balance', () => {
    expect(thumbLists([v('a', -1), v('a', 1), v('a', 1)]).liked).toEqual(['a']);
    expect(thumbLists([v('a', 1), v('a', -1)])).toEqual({ liked: [], disliked: [] });
  });
});
