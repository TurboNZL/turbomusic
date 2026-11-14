import type { Library } from './library.ts';
import { combinePreReleases, type Listen } from './listens.ts';
import { DAY, rangeFor, type Range, type RangeId } from './listenStats.ts';
import { matchesAll, trackSubject, type Chip } from './filters.ts';

export type DayPart = 'any' | 'morning' | 'afternoon' | 'evening' | 'night';

/** Everything the Stats page can narrow the plays by. The time range and the minimum length are handed to the stats maths; the rest is `applyFilter`. */
export interface StatsFilter {
  range: RangeId | 'custom';
  /** custom range, 'YYYY-MM-DD' (local days, both included) */
  from: string;
  to: string;
  /** shortest play that counts; stats.fm counts 30 s */
  minMs: number;
  source: 'all' | 'turbomusic' | 'spotify';
  skips: 'all' | 'played' | 'skipped';
  /** only plays of tracks that are in the library */
  libraryOnly: boolean;
  /** exact platform name as the plays carry it ('' = any) */
  platform: string;
  dayPart: DayPart;
  days: 'all' | 'weekdays' | 'weekends';
  /** words that must appear in the title, artist or album */
  text: string;
  /** library filters (artist:, album:, era:, genre:, rating:, ...); they apply to plays of library tracks, so plays that are not in the library drop out */
  chips: Chip[];
  /** count plays of pre-release versions ("[U]") as plays of the released track instead of as entries of their own */
  combinePre?: boolean;
}

export const DEFAULT_FILTER: StatsFilter = { range: 'all', from: '', to: '', minMs: 30_000, source: 'all', skips: 'all', libraryOnly: false, platform: '', dayPart: 'any', days: 'all', text: '', chips: [] };

const localDay = (s: string): number | null => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); return m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : null; };

/** The time range to hand to the stats maths. A custom range includes both of its days. */
export function filterRange(f: StatsFilter, now = Date.now()): Range {
  if (f.range !== 'custom') return rangeFor(f.range, now);
  const from = localDay(f.from), to = localDay(f.to);
  return { ...(from !== null ? { from } : {}), ...(to !== null ? { to: to + DAY } : {}) };
}

const part = (h: number): Exclude<DayPart, 'any'> => (h >= 5 && h < 12 ? 'morning' : h >= 12 && h < 17 ? 'afternoon' : h >= 17 && h < 22 ? 'evening' : 'night');

/** How many things are narrowing the list (for a "clear" button and a badge); the range and the length are shown elsewhere. */
export const activeCount = (f: StatsFilter) => [f.source !== 'all', f.skips !== 'all', f.libraryOnly, !!f.platform, f.dayPart !== 'any', f.days !== 'all', !!f.text.trim(), f.chips.length > 0, !!f.combinePre].filter(Boolean).length;

/** The plays that pass every filter except the time range and the minimum length. Pure. */
export function applyFilter(lib: Library, listensIn: Listen[], f: StatsFilter): Listen[] {
  const listens = f.combinePre ? combinePreReleases(lib, listensIn) : listensIn;
  const needle = f.text.trim().toLowerCase();
  const plain = f.source === 'all' && f.skips === 'all' && !f.libraryOnly && !f.platform && f.dayPart === 'any' && f.days === 'all' && !needle && !f.chips.length;
  if (plain) return listens;
  const subjects = new Map<string, ReturnType<typeof trackSubject>>();
  return listens.filter((l) => {
    if (f.source !== 'all' && l.source !== f.source) return false;
    if (f.skips === 'skipped' ? !l.skipped : f.skips === 'played' ? l.skipped : false) return false;
    const t = l.trackId ? lib.trackById.get(l.trackId) : undefined;
    if ((f.libraryOnly || f.chips.length) && !t) return false;
    if (f.platform && (l.platform ?? 'Unknown') !== f.platform) return false;
    if (f.dayPart !== 'any' || f.days !== 'all') {
      const d = new Date(l.ts);
      if (f.dayPart !== 'any' && part(d.getHours()) !== f.dayPart) return false;
      const weekend = d.getDay() === 0 || d.getDay() === 6;
      if (f.days === 'weekends' ? !weekend : f.days === 'weekdays' ? weekend : false) return false;
    }
    if (needle && !`${l.title} ${l.artist} ${l.album}`.toLowerCase().includes(needle)) return false;
    if (f.chips.length && t) {
      let s = subjects.get(t.id);
      if (!s) { s = trackSubject(lib, t); subjects.set(t.id, s); }
      if (!matchesAll(f.chips, s)) return false;
    }
    return true;
  });
}

const KEY = 'turbomusic.statsFilter';
export function loadFilter(): StatsFilter {
  try { return { ...DEFAULT_FILTER, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<StatsFilter>) }; } catch { return DEFAULT_FILTER; }
}
export function saveFilter(f: StatsFilter): void { try { localStorage.setItem(KEY, JSON.stringify(f)); } catch { /* private window */ } }

/** Platform names as the plays carry them, most plays first. */
export function platformsOf(listens: Listen[]): string[] {
  const n = new Map<string, number>();
  for (const l of listens) { const p = l.platform ?? 'Unknown'; n.set(p, (n.get(p) ?? 0) + 1); }
  return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p);
}

/** Every filter at once: the extras, then the time range and the minimum length. What the history list and the stats are built from. */
export function filterListens(lib: Library, listens: Listen[], f: StatsFilter, now = Date.now()): Listen[] {
  const r = filterRange(f, now);
  return applyFilter(lib, listens, f).filter((l) => l.ms >= f.minMs && (r.from === undefined || l.ts >= r.from) && (r.to === undefined || l.ts < r.to));
}
