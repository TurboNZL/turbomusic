import { describe, expect, it } from 'vitest';
import { hourLabel, lastMonths } from '../src/lib/listenStats.ts';

describe('hourLabel', () => {
  it('reads as a clock', () => expect([0, 3, 12, 15, 23].map(hourLabel)).toEqual(['12am', '3am', '12pm', '3pm', '11pm']));
});

describe('lastMonths', () => {
  const data = [{ month: '2025-08', n: 4 }, { month: '2025-11', n: 2 }, { month: '2026-02', n: 7 }];
  const bars = lastMonths(data, (m) => m.n, 8);
  it('is one bar per calendar month, empty months are zero', () => {
    expect(bars.map((b) => b.month)).toEqual(['2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02']);
    expect(bars.map((b) => b.value)).toEqual([0, 4, 0, 0, 2, 0, 0, 7]);
  });
  it('puts the year on the first bar and on January', () => expect(bars.map((b) => b.label)).toEqual(['Jul 25', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan 26', 'Feb']));
  it('works with no data', () => expect(lastMonths([], () => 0, 3, Date.UTC(2026, 9, 14)).map((b) => b.month)).toEqual(['2026-08', '2026-09', '2026-10']));
});
