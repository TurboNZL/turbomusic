import { describe, expect, it } from 'vitest';
import { memoryDates, newestMemory } from '../src/lib/memories.ts';
import { sortTracks } from '../src/lib/trackSort.ts';
import type { Track } from '../src/lib/derive.ts';

describe('memories', () => {
  const logs = [{ id: 'a', trackId: 't1', timestamp: 5 }, { id: 'b', trackId: 't1', timestamp: 9 }, { id: 'c', trackId: 't2', timestamp: 20 }];
  it('lists a track\'s memories newest first', () => {
    expect(memoryDates({ memoryLogs: logs } as never, 't1').map((m) => m.id)).toEqual(['b', 'a']);
    expect(memoryDates({} as never, 't1')).toEqual([]);
  });
  it('rescinds the newest recorded one, or none for old memories', () => {
    expect(newestMemory(logs, 't1')).toBe('b');
    expect(newestMemory(logs, 't3')).toBeNull();
  });
});

describe('play count sort', () => {
  const t = (id: string, r: number) => ({ id, title: id, effectiveRating: r, elo: 0 }) as unknown as Track;
  it('sorts by plays, ties by rating', () => {
    const plays = new Map([['a', 3], ['b', 7]]);
    expect(sortTracks([t('a', 1), t('b', 1), t('c', 5), t('d', 2)], 'plays', 'desc', plays).map((x) => x.id)).toEqual(['b', 'a', 'c', 'd']);
  });
});
