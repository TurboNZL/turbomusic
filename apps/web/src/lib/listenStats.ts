import type { Listen } from './listens.ts';

/** `id` is the library artist / album / track the row stands for (null when it is not in the library), for links and pictures. */
export interface TopRow { key: string; label: string; sub: string; plays: number; ms: number; trackId: string | null; id: string | null }
export interface ListenStats {
  plays: number; ms: number; skips: number; skipRate: number;
  distinctTracks: number; distinctArtists: number; distinctAlbums: number;
  daysActive: number; days: number; avgMsPerDay: number;
  longestStreak: { days: number; from: string | null; to: string | null }; currentStreak: number;
  firstTs: number | null; lastTs: number | null;
  topTracks: TopRow[]; topArtists: TopRow[]; topAlbums: TopRow[];
  /** ms listened per hour of the day (local time) */
  byHour: number[];
  /** plays per weekday, Monday first */
  byWeekday: number[];
  /** weekday (Mon=0) x hour, plays */
  clock: number[][];
  /** local date 'YYYY-MM-DD' -> ms */
  byDay: Map<string, number>;
  /** 'YYYY-MM' -> { ms, plays, newArtists } */
  byMonth: { month: string; ms: number; plays: number; newArtists: number }[];
  platforms: { name: string; plays: number }[];
  shuffleShare: number | null;
  sessions: { count: number; longestMs: number; avgMs: number };
  /** the same calendar day in earlier years */
  onThisDay: { year: number; plays: number; top: string | null; topPlays: number }[];
  notInLibrary: TopRow[];
}

export interface Range { from?: number; to?: number }
export const DAY = 86_400_000;

export const dayKey = (ts: number) => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const monthKey = (ts: number) => dayKey(ts).slice(0, 7);
const mondayFirst = (d: Date) => (d.getDay() + 6) % 7;

function top(map: Map<string, TopRow>, by: 'plays' | 'ms', n: number): TopRow[] {
  return [...map.values()].sort((a, b) => b[by] - a[by] || b.ms - a.ms).slice(0, n);
}

/**
 * Everything the listening stats show, for the plays in `range` that were heard at least `minMs` (stats.fm counts 30 s). Pure, so it is
 * tested. `now` is only used for the streak that is still running and for "on this day".
 */
export function computeListenStats(all: Listen[], range: Range = {}, o: { minMs?: number; now?: number; topN?: number } = {}): ListenStats {
  const minMs = o.minMs ?? 0, n = o.topN ?? 50, now = o.now ?? Date.now();
  const rows = all.filter((l) => l.ms >= minMs && (range.from === undefined || l.ts >= range.from) && (range.to === undefined || l.ts < range.to));
  const tracks = new Map<string, TopRow>(), artists = new Map<string, TopRow>(), albums = new Map<string, TopRow>(), missing = new Map<string, TopRow>();
  const byHour = Array<number>(24).fill(0), byWeekday = Array<number>(7).fill(0);
  const clock = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  const byDay = new Map<string, number>(), months = new Map<string, { ms: number; plays: number; newArtists: number }>(), platforms = new Map<string, number>();
  const seenArtist = new Set<string>(all.filter((l) => range.from !== undefined && l.ts < range.from && l.ms >= minMs).map((l) => l.artist.toLowerCase()));
  let ms = 0, skips = 0, shuffleOn = 0, shuffleKnown = 0;
  const bump = (m: Map<string, TopRow>, key: string, label: string, sub: string, l: Listen, id: string | null) => {
    const r = m.get(key) ?? { key, label, sub, plays: 0, ms: 0, trackId: l.trackId, id };
    r.plays++; r.ms += l.ms; if (!r.trackId && l.trackId) r.trackId = l.trackId; if (!r.id && id) r.id = id; m.set(key, r);
  };
  for (const l of rows) {
    ms += l.ms; if (l.skipped) skips++;
    const tk = l.uri ?? `${l.title}|${l.artist}`.toLowerCase();
    // a library track is one row however many Spotify links or titles its plays carry; others group by name
    bump(tracks, l.trackId ? `t:${l.trackId}` : tk, l.title, l.artist, l, l.trackId);
    bump(artists, l.artistId ? `a:${l.artistId}` : l.artist.toLowerCase(), l.artist, '', l, l.artistId);
    if (l.album) bump(albums, l.albumId ? `b:${l.albumId}` : `${l.album}|${l.artist}`.toLowerCase(), l.album, l.artist, l, l.albumId);
    if (!l.trackId) bump(missing, tk, l.title, `${l.artist}${l.album ? ` · ${l.album}` : ''}`, l, null);
    const d = new Date(l.ts), h = d.getHours(), wd = mondayFirst(d);
    byHour[h] += l.ms; byWeekday[wd]++; clock[wd][h]++;
    const dk = dayKey(l.ts);
    byDay.set(dk, (byDay.get(dk) ?? 0) + l.ms);
    const mk = dk.slice(0, 7), m = months.get(mk) ?? { ms: 0, plays: 0, newArtists: 0 };
    m.ms += l.ms; m.plays++;
    if (!seenArtist.has(l.artist.toLowerCase())) { seenArtist.add(l.artist.toLowerCase()); m.newArtists++; }
    months.set(mk, m);
    const p = l.platform ? l.platform.replace(/\s*\(.*$/, '').trim() || 'Unknown' : 'Unknown';
    platforms.set(p, (platforms.get(p) ?? 0) + 1);
    if (l.shuffle !== null) { shuffleKnown++; if (l.shuffle) shuffleOn++; }
  }

  // sessions: a gap of 30 minutes between the end of a play and the start of the next one ends a session
  let sessions = 0, longest = 0, total = 0, cur = 0, lastEnd = -Infinity;
  for (const l of rows) {
    const start = l.ts - l.ms;
    if (start - lastEnd > 30 * 60_000) { if (cur) { sessions++; longest = Math.max(longest, cur); total += cur; } cur = 0; }
    cur += l.ms; lastEnd = l.ts;
  }
  if (cur) { sessions++; longest = Math.max(longest, cur); total += cur; }

  // streaks of days with at least one play
  const days = [...byDay.keys()].sort();
  let best = { days: 0, from: null as string | null, to: null as string | null }, run = 0, runFrom = '';
  const next = (k: string) => { const [y, m, d] = k.split('-').map(Number); return dayKey(new Date(y, m - 1, d + 1).getTime()); };
  days.forEach((k, i) => {
    if (i > 0 && days[i - 1] && next(days[i - 1]) === k) run++; else { run = 1; runFrom = k; }
    if (run > best.days) best = { days: run, from: runFrom, to: k };
  });
  let currentStreak = 0;
  if (days.length) {
    let k = dayKey(now);
    if (!byDay.has(k)) k = dayKey(now - DAY);
    while (byDay.has(k)) { currentStreak++; const [y, m, d] = k.split('-').map(Number); k = dayKey(new Date(y, m - 1, d - 1).getTime()); }
  }

  const first = rows[0]?.ts ?? null, last = rows[rows.length - 1]?.ts ?? null;
  const spanDays = first !== null && last !== null ? Math.max(1, Math.round((Math.max(last, range.to ?? last) - Math.min(first, range.from ?? first)) / DAY)) : 0;

  const today = new Date(now), onThisDay: ListenStats['onThisDay'] = [];
  const byYear = new Map<number, Map<string, number>>();
  for (const l of all) {
    if (l.ms < minMs) continue;
    const d = new Date(l.ts);
    if (d.getMonth() === today.getMonth() && d.getDate() === today.getDate() && d.getFullYear() !== today.getFullYear()) {
      const y = byYear.get(d.getFullYear()) ?? new Map<string, number>();
      y.set(`${l.title} · ${l.artist}`, (y.get(`${l.title} · ${l.artist}`) ?? 0) + 1); byYear.set(d.getFullYear(), y);
    }
  }
  for (const [year, m] of [...byYear.entries()].sort((a, b) => b[0] - a[0])) onThisDay.push({ year, plays: [...m.values()].reduce((a, b) => a + b, 0), top: [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null, topPlays: Math.max(0, ...m.values()) });

  return {
    plays: rows.length, ms, skips, skipRate: rows.length ? skips / rows.length : 0,
    distinctTracks: tracks.size, distinctArtists: artists.size, distinctAlbums: albums.size,
    daysActive: byDay.size, days: spanDays, avgMsPerDay: spanDays ? ms / spanDays : 0,
    longestStreak: best, currentStreak, firstTs: first, lastTs: last,
    topTracks: top(tracks, 'plays', n), topArtists: top(artists, 'plays', n), topAlbums: top(albums, 'plays', n),
    byHour, byWeekday, clock, byDay,
    byMonth: [...months.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([month, v]) => ({ month, ...v })),
    platforms: [...platforms.entries()].sort((a, b) => b[1] - a[1]).map(([name, plays]) => ({ name, plays })),
    shuffleShare: shuffleKnown ? shuffleOn / shuffleKnown : null,
    sessions: { count: sessions, longestMs: longest, avgMs: sessions ? total / sessions : 0 },
    onThisDay, notInLibrary: top(missing, 'plays', n),
  };
}

/** Quick ranges like stats.fm's: 4 weeks, 6 months, a year, this year, lifetime. */
export const RANGES = [
  { id: '4w', label: 'Last 4 weeks' }, { id: '6m', label: 'Last 6 months' }, { id: '1y', label: 'Past year' }, { id: 'ytd', label: 'This year' }, { id: 'all', label: 'Lifetime' },
] as const;
export type RangeId = (typeof RANGES)[number]['id'];
export function rangeFor(id: RangeId, now = Date.now()): Range {
  if (id === '4w') return { from: now - 28 * DAY };
  if (id === '6m') return { from: now - 183 * DAY };
  if (id === '1y') return { from: now - 365 * DAY };
  if (id === 'ytd') return { from: new Date(new Date(now).getFullYear(), 0, 1).getTime() };
  return {};
}

export interface SeriesPoint { label: string; full: string; value: number }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Listening time over the chosen range as an unbroken series: one point per day for a range of up to about three months,
 * otherwise one per month, with empty days and months as zero (so a gap is a gap, not a shortcut) and the year in every label.
 * The step depends only on the length of the range, so moving the end date never switches the chart to another kind.
 */
export function timeSeries(s: Pick<ListenStats, 'byDay' | 'firstTs' | 'lastTs'>, range: Range, now = Date.now()): { unit: 'day' | 'month'; points: SeriesPoint[] } {
  if (s.firstTs === null) return { unit: 'month', points: [] };
  const start = new Date(range.from ?? s.firstTs), end = new Date(Math.max(start.getTime(), (range.to !== undefined ? range.to - 1 : Math.max(now, s.lastTs ?? now))));
  const spanDays = Math.round((end.getTime() - start.getTime()) / DAY) + 1;
  const points: SeriesPoint[] = [];
  if (spanDays <= 92) {
    const crossYear = start.getFullYear() !== end.getFullYear();
    for (let d = new Date(start.getFullYear(), start.getMonth(), start.getDate()); d <= end; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
      const k = dayKey(d.getTime());
      points.push({ label: `${d.getDate()} ${MONTHS[d.getMonth()]}${crossYear ? ` ${String(d.getFullYear()).slice(2)}` : ''}`, full: d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }), value: s.byDay.get(k) ?? 0 });
    }
    return { unit: 'day', points };
  }
  const perMonth = new Map<string, number>();
  for (const [k, v] of s.byDay) perMonth.set(k.slice(0, 7), (perMonth.get(k.slice(0, 7)) ?? 0) + v);
  for (let y = start.getFullYear(), m = start.getMonth(); y < end.getFullYear() || (y === end.getFullYear() && m <= end.getMonth());) {
    const k = `${y}-${String(m + 1).padStart(2, '0')}`;
    points.push({ label: `${MONTHS[m]} ${y}`, full: `${MONTHS[m]} ${y}`, value: perMonth.get(k) ?? 0 });
    if (++m > 11) { m = 0; y++; }
  }
  return { unit: 'month', points };
}

/** "12a", "3a", "12p", "3p"...: an hour of the day a person can read at a glance (the charts used bare numbers 0, 3, 6...) */
export const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? 'am' : 'pm'}`;

export interface MonthBar { month: string; label: string; full: string; value: number }
/**
 * The last `count` calendar months ending at the latest month with data (or `now`), one bar each, a month with nothing is a zero bar
 * (not skipped, so a gap looks like a gap). Labels carry the year on January and on the first bar: "Oct", "Nov", "Dec", "Jan 26".
 */
export function lastMonths<T extends { month: string }>(byMonth: T[], pick: (m: T) => number, count: number, now = Date.now()): MonthBar[] {
  const known = new Map(byMonth.map((m) => [m.month, pick(m)]));
  const endKey = byMonth.length ? byMonth[byMonth.length - 1].month : null;
  const nowD = new Date(now);
  let y = endKey ? Number(endKey.slice(0, 4)) : nowD.getFullYear(), m = endKey ? Number(endKey.slice(5)) - 1 : nowD.getMonth();
  const out: MonthBar[] = [];
  for (let i = 0; i < count; i++) {
    const key = `${y}-${String(m + 1).padStart(2, '0')}`;
    out.unshift({ month: key, label: MONTHS[m], full: `${MONTHS[m]} ${y}`, value: known.get(key) ?? 0 });
    if (--m < 0) { m = 11; y--; }
  }
  return out.map((b, i) => (i === 0 || b.month.endsWith('-01') ? { ...b, label: `${b.label} ${String(b.month.slice(2, 4))}` } : b));
}
