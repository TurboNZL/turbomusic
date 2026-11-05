import type { Library } from './library.ts';
import { updateProfile } from './profile.ts';

/**
 * Which recap announcements on Home have been dismissed. Kept in the synced profile, so dismissing one on the phone also hides it on the
 * computer, and un-ticking it in Settings brings it back everywhere. Weekly = the Monday (a timestamp), monthly = the first of the month
 * (a timestamp), Wrapped = the year.
 */
export type RecapKind = 'week' | 'month' | 'wrapped';
export type Dismissed = Record<RecapKind, number>;

export function dismissed(lib: Pick<Library, 'profile'>): Dismissed {
  const d = (lib.profile?.settings?.recapDismissed ?? {}) as Partial<Dismissed>;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return { week: n(d.week), month: n(d.month), wrapped: n(d.wrapped) };
}

/** Hide this announcement (and any older one) from now on. */
export function dismiss(lib: Library, kind: RecapKind, value: number) {
  updateProfile(lib, (p) => ({ ...p, settings: { ...p.settings, recapDismissed: { ...dismissed(lib), [kind]: Math.max(value, dismissed(lib)[kind]) } } }));
}
/** Bring an announcement back. */
export function undismiss(lib: Library, kind: RecapKind) {
  updateProfile(lib, (p) => ({ ...p, settings: { ...p.settings, recapDismissed: { ...dismissed(lib), [kind]: 0 } } }));
}

/**
 * Wrapped is announced from the end of November. Spotify's has arrived on Nov 29 - Dec 5 in recent years (2019: Dec 5, 2020: Dec 2,
 * 2021: Dec 1, 2022: Nov 30, 2023: Nov 29, 2024: Dec 4, 2025: Dec 3, from memory), so the first of the likely days is used.
 */
export function wrappedSeason(now = new Date()): boolean {
  const m = now.getMonth(), d = now.getDate();
  return m === 11 || (m === 10 && d >= 29);
}
