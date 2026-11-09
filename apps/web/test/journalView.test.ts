import { describe, expect, it } from 'vitest';
import { activityGrid, groupByMonth, listeningOnThisDay, onThisDay, writingStreak, type Entry } from '../src/lib/journalView.ts';

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();
const e = (id: string, ts: number, type = 'entry'): Entry => ({ id, type, title: id, description: '', entityId: null, timestamp: ts });

describe('journal view', () => {
  it('groups by month, newest first', () => {
    const g = groupByMonth([e('a', at(2026, 3, 1)), e('b', at(2026, 5, 2)), e('c', at(2026, 5, 20))]);
    expect(g.map((x) => x.key)).toEqual(['2026-05', '2026-03']);
    expect(g[0].entries.map((x) => x.id)).toEqual(['c', 'b']);
  });
  it('counts a writing streak, tolerating a day not over yet', () => {
    const now = at(2026, 11, 9);
    expect(writingStreak([e('1', at(2026, 11, 9)), e('2', at(2026, 11, 8)), e('3', at(2026, 11, 6))], now)).toBe(2);
    expect(writingStreak([e('2', at(2026, 11, 8)), e('x', at(2026, 11, 7))], now)).toBe(2);
    expect(writingStreak([e('2', at(2026, 11, 1))], now)).toBe(0);
    expect(writingStreak([e('2', at(2026, 11, 9), 'add')], now)).toBe(0); // automatic entries are not writing
  });
  it('lays out whole weeks ending with this one', () => {
    const g = activityGrid([e('a', at(2026, 11, 9))], 4, at(2026, 11, 9)); // a Monday
    expect(g).toHaveLength(4);
    expect(g[3][0].count).toBe(1);
    expect(g[3][1].count).toBeNull(); // tomorrow
    expect(g[0][0].count).toBe(0);
  });
  it('finds entries and listening from this day in earlier years', () => {
    const now = at(2026, 11, 9);
    expect(onThisDay([e('old', at(2024, 11, 9)), e('this', at(2026, 11, 9)), e('other', at(2024, 11, 10))], now).map((x) => x.id)).toEqual(['old']);
    const plays = [1, 2, 3].map((i) => ({ ts: at(2025, 11, 9, 8 + i), trackId: 't1' })).concat([{ ts: at(2025, 11, 9, 9), trackId: 't2' }]);
    expect(listeningOnThisDay(plays, now)).toEqual([{ year: 2025, trackId: 't1', plays: 3 }]);
  });
});
