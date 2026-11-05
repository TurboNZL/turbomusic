import { describe, expect, it } from 'vitest';
import { dismissed, wrappedSeason } from '../src/lib/recapSeen.ts';

describe('recap dismissals', () => {
  it('reads what is saved with the profile, and nothing when there is none', () => {
    expect(dismissed({ profile: null })).toEqual({ week: 0, month: 0, wrapped: 0 });
    expect(dismissed({ profile: { settings: { recapDismissed: { week: 5, wrapped: 2026, month: 'x' } } } } as never)).toEqual({ week: 5, month: 0, wrapped: 2026 });
  });
  it('announces Wrapped from the end of November', () => {
    expect(wrappedSeason(new Date(2026, 10, 28))).toBe(false);
    expect(wrappedSeason(new Date(2026, 10, 29))).toBe(true);
    expect(wrappedSeason(new Date(2026, 11, 20))).toBe(true);
    expect(wrappedSeason(new Date(2026, 0, 5))).toBe(false);
  });
});
