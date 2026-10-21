import type { Library } from './library.ts';
import type { Listen } from './listens.ts';
import { computeListenStats, dayKey, type TopRow } from './listenStats.ts';

/**
 * Weekly recaps (modelled on Airbuds' Sunday recap: time listened, top songs, top artists, album of the week, the reactions you gave) and
 * the yearly Wrapped (modelled on what Spotify Wrapped has shown across the years: minutes, top songs/artists/albums/genres, the top-song quiz,
 * a listening age, music phases, the monthly top-artist race, the longest streak, a listening personality). Pure, so it is tested.
 * Plays shorter than `RECAP_MIN_MS` do not count (the same 30 s rule as the Stats page).
 */
export const RECAP_MIN_MS = 30_000;

/** Monday 00:00 (local time) of the week that holds `ts`. */
export function weekStart(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}
/** The first moment of the next week (calendar-safe across a clock change). */
export function nextWeek(start: number): number {
  const d = new Date(start);
  d.setDate(d.getDate() + 7);
  return d.getTime();
}
export function prevWeek(start: number): number {
  const d = new Date(start);
  d.setDate(d.getDate() - 7);
  return d.getTime();
}

/** Weeks (their Monday) that hold at least one counted play, newest first. */
export function weeksWithPlays(all: Listen[], minMs = RECAP_MIN_MS): number[] {
  const set = new Set<number>();
  for (const l of all) if (l.ms >= minMs) set.add(weekStart(l.ts));
  return [...set].sort((a, b) => b - a);
}

/** Which week opens by default: the one that just ended, or this one when it is Sunday (Airbuds' recap arrives on Sundays). */
export function defaultWeek(weeks: number[], now = Date.now()): number | null {
  if (!weeks.length) return null;
  const thisWeek = weekStart(now), isSunday = new Date(now).getDay() === 0;
  if (isSunday && weeks.includes(thisWeek)) return thisWeek;
  return weeks.find((w) => w < thisWeek) ?? weeks[0];
}

const keyOf = (l: Listen) => (l.trackId ? `t:${l.trackId}` : l.uri ?? `${l.title}|${l.artist}`.toLowerCase());

/** The longest stretch of listening with no gap over 30 minutes (rows sorted by time). */
export function longestSession(rows: Listen[]): { ms: number; start: number } | null {
  let best: { ms: number; start: number } | null = null, cur = 0, start = 0, lastEnd = -Infinity;
  for (const l of rows) {
    const s = l.ts - l.ms;
    if (s - lastEnd > 30 * 60_000) { cur = 0; start = s; }
    cur += l.ms; lastEnd = l.ts;
    if (!best || cur > best.ms) best = { ms: cur, start };
  }
  return best;
}

/** The plays of one song on its busiest day: "you played it 14 times on March 3". */
export function obsession(rows: Listen[]): { label: string; artist: string; plays: number; day: string } | null {
  const m = new Map<string, { label: string; artist: string; plays: number; day: string }>();
  let best: { label: string; artist: string; plays: number; day: string } | null = null;
  for (const l of rows) {
    const day = dayKey(l.ts), k = `${keyOf(l)}@${day}`;
    const e = m.get(k) ?? { label: l.title, artist: l.artist, plays: 0, day };
    e.plays++; m.set(k, e);
    if (!best || e.plays > best.plays) best = e;
  }
  return best && best.plays >= 3 ? best : null;
}

export interface Reactions { thumbsUp: number; thumbsDown: number; votes: number; memories: number }

export interface WeeklyRecap {
  from: number; to: number;
  /** the week is not over yet */
  partial: boolean;
  plays: number; ms: number; prevMs: number;
  /** change against the week before, as a fraction (0.25 = 25 % more); null when the week before had nothing */
  change: number | null;
  topTracks: TopRow[]; topArtists: TopRow[];
  /** the album of the week */
  album: TopRow | null;
  /** what you gave back this week: thumbs, head-to-head votes, memories */
  reactions: Reactions;
  busiestDay: { key: string; ms: number } | null;
  activeDays: number;
  newArtists: number;
  skipRate: number;
  daypart: 'night' | 'morning' | 'afternoon' | 'evening' | null;
  /** milliseconds listened per day, Monday first */
  byDay: number[];
  longestSessionMs: number;
  /** a song played three times or more this week */
  onRepeat: { label: string; artist: string; plays: number } | null;
  /** songs heard for the first time this week (never played before, in the library or imported history) */
  newSongs: number;
  topGenre: string | null;
  /** plays between midnight and 5 a.m. */
  lateNight: number;
  /** share of plays that were not skipped (0..1) */
  completion: number;
}

const daypartOf = (hour: number) => (hour < 5 ? 'night' : hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening') as NonNullable<WeeklyRecap['daypart']>;

function reactionsIn(lib: Pick<Library, 'votes' | 'memoryLogs'>, from: number, to: number): Reactions {
  const r = { thumbsUp: 0, thumbsDown: 0, votes: 0, memories: 0 };
  for (const v of lib.votes) {
    if (v.timestamp < from || v.timestamp >= to) continue;
    if (v.boost === 1) r.thumbsUp++; else if (v.boost === -1) r.thumbsDown++; else r.votes++;
  }
  for (const m of lib.memoryLogs) if (m.timestamp >= from && m.timestamp < to) r.memories++;
  return r;
}

export function weeklyRecap(lib: Pick<Library, 'votes' | 'memoryLogs' | 'trackById'>, all: Listen[], start: number, now = Date.now()): WeeklyRecap {
  const end = nextWeek(start);
  const s = computeListenStats(all, { from: start, to: end }, { minMs: RECAP_MIN_MS, now, topN: 5 });
  const prev = computeListenStats(all, { from: prevWeek(start), to: start }, { minMs: RECAP_MIN_MS, now, topN: 1 });
  let busiest: WeeklyRecap['busiestDay'] = null;
  for (const [key, ms] of s.byDay) if (!busiest || ms > busiest.ms) busiest = { key, ms };
  const best = s.byHour.reduce((bi, v, i, a) => (v > a[bi] ? i : bi), 0);
  const rows = all.filter((l) => l.ms >= RECAP_MIN_MS && l.ts >= start && l.ts < end);
  const byDay = Array<number>(7).fill(0);
  let lateNight = 0;
  const genres = new Map<string, number>(), seen = new Set<string>(), fresh = new Set<string>();
  for (const l of all) if (l.ms >= RECAP_MIN_MS && l.ts < start) seen.add(keyOf(l));
  for (const l of rows) {
    byDay[(new Date(l.ts).getDay() + 6) % 7] += l.ms;
    if (new Date(l.ts).getHours() < 5) lateNight++;
    if (!seen.has(keyOf(l))) fresh.add(keyOf(l));
    for (const g of (l.trackId ? lib.trackById.get(l.trackId)?.allGenres ?? [] : [])) genres.set(g, (genres.get(g) ?? 0) + 1);
  }
  const rep = s.topTracks[0];
  return {
    byDay, longestSessionMs: longestSession(rows)?.ms ?? 0, newSongs: fresh.size, lateNight, completion: 1 - s.skipRate,
    onRepeat: rep && rep.plays >= 3 ? { label: rep.label, artist: rep.sub, plays: rep.plays } : null,
    topGenre: [...genres.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
    from: start, to: end, partial: now < end,
    plays: s.plays, ms: s.ms, prevMs: prev.ms, change: prev.ms > 0 ? s.ms / prev.ms - 1 : null,
    topTracks: s.topTracks, topArtists: s.topArtists.slice(0, 3), album: s.topAlbums[0] ?? null,
    reactions: reactionsIn(lib, start, end), busiestDay: busiest, activeDays: s.daysActive,
    newArtists: s.byMonth.reduce((n, m) => n + m.newArtists, 0),
    skipRate: s.skipRate, daypart: s.ms > 0 ? daypartOf(best) : null,
  };
}

// ---------------------------------------------------------------------------------------------------------------- Wrapped

export interface Phase { fromMonth: string; toMonth: string; artists: string[]; name: string }
export interface Race { artists: string[]; months: string[]; /** ranks[a][m] = 1-based rank of artist a after month m (null = not heard yet) */ ranks: (number | null)[][] }
export type Personality = 'replayer' | 'explorer' | 'loyalist' | 'nightowl' | 'earlybird' | 'timetraveller';

export interface Wrapped {
  year: number;
  from: number; to: number;
  /** the year is still running: it covers January 1 up to now */
  partial: boolean;
  plays: number; ms: number; minutes: number;
  distinctTracks: number; distinctArtists: number;
  topTracks: TopRow[]; topArtists: TopRow[]; topAlbums: TopRow[];
  topGenres: { name: string; plays: number }[];
  /** the share of all listening time that the top artist took */
  topArtistShare: number;
  /** the options of the top-song quiz: the real top song and up to three more of the top five, in a fixed shuffled order */
  quiz: { options: TopRow[]; answer: number } | null;
  /** the era your top songs come from, and the playful age that goes with it */
  listening: { medianYear: number; age: number; sampled: number } | null;
  phases: Phase[];
  race: Race | null;
  streak: { days: number; from: string | null; to: string | null };
  biggestDays: { key: string; ms: number }[];
  newArtists: number;
  firstPlay: { title: string; artist: string; ts: number } | null;
  peakHour: number | null;
  busiestMonth: { month: string; ms: number } | null;
  reactions: Reactions;
  personality: { kind: Personality; scores: Record<Personality, number> } | null;
  /** milliseconds listened per hour of the day */
  hours: number[];
  /** plays per weekday, Monday first */
  weekdays: number[];
  weekendShare: number;
  longestSession: { ms: number; start: number } | null;
  obsession: { label: string; artist: string; plays: number; day: string } | null;
  /** how much of your listening the five most played artists took (0..1) */
  topFiveShare: number;
  skipRate: number;
  /** songs heard for the first time this year */
  newSongs: number;
  /** plays between midnight and 5 a.m. */
  lateNight: number;
  /** plays by decade of release, oldest first (library songs with a release date only) */
  decades: { label: string; plays: number }[];
  /** the listening time in albums of 40 minutes */
  albums: number;
  busiestSeason: 'winter' | 'spring' | 'summer' | 'autumn' | null;
  lastPlay: { title: string; artist: string; ts: number } | null;
}

const monthsOf = (year: number) => Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);

/** The years that have at least one counted play, newest first. */
export function wrappedYears(all: Listen[], minMs = RECAP_MIN_MS): number[] {
  const set = new Set<number>();
  for (const l of all) if (l.ms >= minMs) set.add(new Date(l.ts).getFullYear());
  return [...set].sort((a, b) => b - a);
}

/** "2019", "2019-05" or "2019-05-30" -> the year, else null. */
export const yearOf = (date: string | null | undefined) => { const y = Number((date ?? '').slice(0, 4)); return Number.isInteger(y) && y > 1000 ? y : null; };

/**
 * Splits the months of the year into at most three phases of music (Spotify's "Music Evolution"): neighbouring months that share the most top
 * artists are merged until three are left. A month with no plays is ignored. The name comes from the phase's top genre, or its top artist.
 */
export function musicPhases(monthTop: { month: string; artists: string[]; genre: string | null }[], maxPhases = 3): Phase[] {
  type P = { from: string; to: string; counts: Map<string, number>; genres: Map<string, number> };
  const ps: P[] = monthTop.filter((m) => m.artists.length).map((m) => ({ from: m.month, to: m.month, counts: new Map(m.artists.map((a, i) => [a, m.artists.length - i])), genres: new Map(m.genre ? [[m.genre, 1]] : []) }));
  const sim = (a: P, b: P) => {
    let shared = 0;
    for (const k of a.counts.keys()) if (b.counts.has(k)) shared++;
    return shared / Math.max(1, a.counts.size + b.counts.size - shared);
  };
  while (ps.length > maxPhases) {
    let bi = 0, bs = -1;
    for (let i = 0; i < ps.length - 1; i++) { const s = sim(ps[i], ps[i + 1]); if (s > bs) { bs = s; bi = i; } }
    const a = ps[bi], b = ps[bi + 1];
    const counts = new Map(a.counts); for (const [k, v] of b.counts) counts.set(k, (counts.get(k) ?? 0) + v);
    const genres = new Map(a.genres); for (const [k, v] of b.genres) genres.set(k, (genres.get(k) ?? 0) + v);
    ps.splice(bi, 2, { from: a.from, to: b.to, counts, genres });
  }
  return ps.map((p) => {
    const artists = [...p.counts.entries()].sort((x, y) => y[1] - x[1]).slice(0, 4).map(([k]) => k);
    const genre = [...p.genres.entries()].sort((x, y) => y[1] - x[1])[0]?.[0];
    return { fromMonth: p.from, toMonth: p.to, artists, name: genre ? `${genre[0].toUpperCase()}${genre.slice(1)} phase` : `${artists[0]} phase` };
  });
}

/** Scores 0..1 for each personality; the highest wins (ties go to the order of PERSONALITY_ORDER). Own names, own thresholds. */
export function personalityScores(m: { plays: number; distinctTracks: number; newArtists: number; topArtistShare: number; nightShare: number; morningShare: number; oldShare: number | null }): Record<Personality, number> {
  const clamp = (n: number) => Math.min(1, Math.max(0, n));
  const repeat = m.distinctTracks ? m.plays / m.distinctTracks : 1;
  return {
    replayer: clamp((repeat - 1.5) / 6),
    explorer: clamp(m.newArtists / Math.max(15, m.plays / 12)),
    loyalist: clamp((m.topArtistShare - 0.1) / 0.3),
    nightowl: clamp((m.nightShare - 0.1) / 0.3),
    earlybird: clamp((m.morningShare - 0.2) / 0.35),
    timetraveller: clamp(((m.oldShare ?? 0) - 0.3) / 0.5),
  };
}
export const PERSONALITY_ORDER: Personality[] = ['replayer', 'explorer', 'loyalist', 'nightowl', 'earlybird', 'timetraveller'];

/** A repeatable shuffle (so the quiz does not reshuffle on every render): a seeded Fisher-Yates. */
export function seededShuffle<T>(items: T[], seed: number): T[] {
  const out = [...items];
  let x = (seed >>> 0) || 1;
  const rnd = () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

/** Everything the Wrapped story shows for one year. A year that is not over covers January 1 up to now. */
export function computeWrapped(lib: Pick<Library, 'votes' | 'memoryLogs' | 'trackById'>, all: Listen[], year: number, now = Date.now()): Wrapped {
  const from = new Date(year, 0, 1).getTime(), yearEnd = new Date(year + 1, 0, 1).getTime();
  const s = computeListenStats(all, { from, to: yearEnd }, { minMs: RECAP_MIN_MS, now, topN: 100 });
  const rows = all.filter((l) => l.ms >= RECAP_MIN_MS && l.ts >= from && l.ts < yearEnd);
  const genreOf = (l: Listen) => (l.trackId ? lib.trackById.get(l.trackId)?.allGenres ?? [] : []);

  const genres = new Map<string, number>();
  for (const l of rows) for (const g of genreOf(l)) genres.set(g, (genres.get(g) ?? 0) + 1);
  const topGenres = [...genres.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, plays]) => ({ name, plays }));

  const topTracks = s.topTracks.slice(0, 5), topArtists = s.topArtists.slice(0, 5), topAlbums = s.topAlbums.slice(0, 5);
  const topArtistShare = s.ms > 0 && s.topArtists[0] ? s.topArtists[0].ms / s.ms : 0;

  let quiz: Wrapped['quiz'] = null;
  if (topTracks.length >= 2) {
    const options = seededShuffle(topTracks.slice(0, 4), year * 7919 + s.plays);
    quiz = { options, answer: options.findIndex((o) => o.key === topTracks[0].key) };
  }

  // listening age: the median release year of the plays of your 100 most played songs
  const hundred = new Set(s.topTracks.map((r) => r.trackId).filter((x): x is string => !!x));
  const years: number[] = [];
  for (const l of rows) { if (!l.trackId || !hundred.has(l.trackId)) continue; const y = yearOf(lib.trackById.get(l.trackId)?.releaseDate); if (y) years.push(y); }
  years.sort((a, b) => a - b);
  const medianYear = years.length ? years[Math.floor(years.length / 2)] : null;
  // Spotify ties this to the "reminiscence bump", the years in your teens when the music you love is set; ours is the same idea, centred on 16
  const listening = medianYear ? { medianYear, age: Math.max(10, year - medianYear + 16), sampled: years.length } : null;
  const oldShare = years.length ? years.filter((y) => year - y >= 15).length / years.length : null;

  const months = monthsOf(year);
  const perMonth = months.map((month) => {
    const byArtist = new Map<string, number>(), byGenre = new Map<string, number>();
    for (const l of rows) {
      if (dayKey(l.ts).slice(0, 7) !== month) continue;
      byArtist.set(l.artist, (byArtist.get(l.artist) ?? 0) + 1);
      for (const g of genreOf(l)) byGenre.set(g, (byGenre.get(g) ?? 0) + 1);
    }
    return { month, byArtist, genre: [...byGenre.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null };
  });
  const phases = musicPhases(perMonth.map((m) => ({ month: m.month, artists: [...m.byArtist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => k), genre: m.genre })));

  let race: Race | null = null;
  const raceArtists = topArtists.map((a) => a.label);
  if (raceArtists.length >= 2) {
    const cum = new Map<string, number>();
    const ranks: (number | null)[][] = raceArtists.map(() => []);
    for (const m of perMonth) {
      for (const [a, n] of m.byArtist) cum.set(a, (cum.get(a) ?? 0) + n);
      const order = raceArtists.filter((a) => cum.has(a)).sort((a, b) => (cum.get(b) ?? 0) - (cum.get(a) ?? 0));
      raceArtists.forEach((a, i) => ranks[i].push(order.includes(a) ? order.indexOf(a) + 1 : null));
    }
    race = { artists: raceArtists, months, ranks };
  }

  const biggestDays = [...s.byDay.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([key, ms]) => ({ key, ms }));
  const first = rows[0] ? { title: rows[0].title, artist: rows[0].artist, ts: rows[0].ts - rows[0].ms } : null;
  const peak = s.ms > 0 ? s.byHour.reduce((bi, v, i, a) => (v > a[bi] ? i : bi), 0) : null;
  const busiestMonth = s.byMonth.reduce<Wrapped['busiestMonth']>((b, m) => (!b || m.ms > b.ms ? { month: m.month, ms: m.ms } : b), null);
  const sum = (a: number[], f: number, t: number) => a.slice(f, t).reduce((x, y) => x + y, 0);
  const total = s.byHour.reduce((x, y) => x + y, 0) || 1;
  const newArtists = s.byMonth.reduce((n, m) => n + m.newArtists, 0);
  const scores = personalityScores({ plays: s.plays, distinctTracks: s.distinctTracks, newArtists, topArtistShare, nightShare: sum(s.byHour, 0, 5) / total, morningShare: sum(s.byHour, 5, 12) / total, oldShare });
  const kind = PERSONALITY_ORDER.reduce((b, k) => (scores[k] > scores[b] ? k : b), PERSONALITY_ORDER[0]);

  const seenBefore = new Set<string>();
  for (const l of all) if (l.ms >= RECAP_MIN_MS && l.ts < from) seenBefore.add(keyOf(l));
  const freshSongs = new Set<string>();
  const dec = new Map<number, number>();
  let late = 0, weekend = 0;
  const season = [0, 0, 0, 0]; // winter, spring, summer, autumn (northern hemisphere months)
  for (const l of rows) {
    if (!seenBefore.has(keyOf(l))) freshSongs.add(keyOf(l));
    const d = new Date(l.ts);
    if (d.getHours() < 5) late++;
    if (d.getDay() === 0 || d.getDay() === 6) weekend++;
    season[[0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 0][d.getMonth()]] += l.ms;
    const y = l.trackId ? yearOf(lib.trackById.get(l.trackId)?.releaseDate) : null;
    if (y) dec.set(Math.floor(y / 10) * 10, (dec.get(Math.floor(y / 10) * 10) ?? 0) + 1);
  }
  const topFive = s.topArtists.slice(0, 5).reduce((n, a) => n + a.plays, 0);
  const last = rows[rows.length - 1];
  const sMax = Math.max(...season);
  return {
    hours: s.byHour, weekdays: s.byWeekday, weekendShare: rows.length ? weekend / rows.length : 0,
    longestSession: longestSession(rows), obsession: obsession(rows), topFiveShare: s.plays ? topFive / s.plays : 0,
    skipRate: s.skipRate, newSongs: freshSongs.size, lateNight: late,
    decades: [...dec.entries()].sort((a, b) => a[0] - b[0]).map(([d, plays]) => ({ label: `${d}s`, plays })),
    albums: Math.round(s.ms / 60000 / 40),
    busiestSeason: sMax > 0 ? (['winter', 'spring', 'summer', 'autumn'] as const)[season.indexOf(sMax)] : null,
    lastPlay: last ? { title: last.title, artist: last.artist, ts: last.ts } : null,
    year, from, to: Math.min(yearEnd, now), partial: now < yearEnd, plays: s.plays, ms: s.ms, minutes: Math.round(s.ms / 60000),
    distinctTracks: s.distinctTracks, distinctArtists: s.distinctArtists,
    topTracks, topArtists, topAlbums, topGenres, topArtistShare, quiz, listening, phases, race,
    streak: s.longestStreak, biggestDays, newArtists, firstPlay: first, peakHour: peak, busiestMonth, reactions: reactionsIn(lib, from, yearEnd),
    personality: s.plays >= 20 ? { kind, scores } : null,
  };
}

export const PERSONALITIES: Record<Personality, { name: string; blurb: string }> = {
  replayer: { name: 'The Replayer', blurb: 'You do not skim, you sink in. The same songs came back again and again, and you never apologised.' },
  explorer: { name: 'The Explorer', blurb: 'Always one new artist ahead. Your library keeps growing because you keep digging.' },
  loyalist: { name: 'The Loyalist', blurb: 'One artist took a big slice of your year, and you would do it again.' },
  nightowl: { name: 'The Night Owl', blurb: 'The best listening happens after dark, when nobody is asking you anything.' },
  earlybird: { name: 'The Early Bird', blurb: 'Music was on before the day properly began.' },
  timetraveller: { name: 'The Time Traveller', blurb: 'Your year lived in the past: the songs you played were old before you pressed play.' },
};
