import { describe, expect, it } from 'vitest';
import { computeWrapped, defaultWeek, musicPhases, personalityScores, seededShuffle, weekStart, weeklyRecap, weeksWithPlays, wrappedYears, yearOf } from '../src/lib/recap.ts';
import type { Listen } from '../src/lib/listens.ts';
import { longestSession, obsession } from '../src/lib/recap.ts';
import { MOTIFS, shapes } from '../src/components/AbstractArt.tsx';

let n = 0;
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();
const L = (ts: number, o: Partial<Listen> = {}): Listen => ({ id: `l${n++}`, ts, ms: 200000, trackId: null, artistId: null, albumId: null, title: 'Song', artist: 'Artist', album: 'Album', uri: null, skipped: false, shuffle: null, platform: 'linux', reasonEnd: null, source: 'spotify', ...o });
const none = { votes: [], memoryLogs: [], trackById: new Map() };

describe('weeks', () => {
  it('starts on Monday', () => {
    expect(new Date(weekStart(at(2026, 10, 18))).getDay()).toBe(1); // a Sunday belongs to the week that began on Monday the 12th
    expect(new Date(weekStart(at(2026, 10, 18))).getDate()).toBe(12);
    expect(new Date(weekStart(at(2026, 10, 19, 0))).getDate()).toBe(19);
  });
  it('lists weeks that have counted plays, newest first, and picks the one that just ended', () => {
    const all = [L(at(2026, 10, 7)), L(at(2026, 10, 14)), L(at(2026, 10, 15), { ms: 5000 }), L(at(2026, 10, 20))];
    const weeks = weeksWithPlays(all);
    expect(weeks.map((w) => new Date(w).getDate())).toEqual([19, 12, 5]);
    expect(new Date(defaultWeek(weeks, at(2026, 10, 21))!).getDate()).toBe(12); // Wednesday: the week that ended
    expect(new Date(defaultWeek(weeks, at(2026, 10, 25))!).getDate()).toBe(19); // Sunday: this week's recap is ready
    expect(defaultWeek([])).toBeNull();
  });
});

describe('weekly recap', () => {
  const w = weekStart(at(2026, 10, 14));
  const all = [
    L(at(2026, 10, 5), { title: 'Old', artist: 'Z' }),
    L(at(2026, 10, 12), { title: 'A', artist: 'X', album: 'AA' }), L(at(2026, 10, 13), { title: 'A', artist: 'X', album: 'AA' }), L(at(2026, 10, 13, 23), { title: 'B', artist: 'Y', album: 'BB' }),
    L(at(2026, 10, 15), { title: 'C', artist: 'Y', album: 'BB' }), L(at(2026, 10, 16), { title: 'Skipped', ms: 4000 }),
  ];
  const lib = { votes: [{ id: 'v1', trackAId: 'a', trackBId: '', winnerId: null, isEqual: false, boost: 1 as const, timestamp: at(2026, 10, 13) }, { id: 'v2', trackAId: 'a', trackBId: 'b', winnerId: 'a', isEqual: false, timestamp: at(2026, 10, 14) }, { id: 'v3', trackAId: 'a', trackBId: 'b', winnerId: 'a', isEqual: false, timestamp: at(2026, 9, 1) }], memoryLogs: [{ id: 'm1', trackId: 'a', timestamp: at(2026, 10, 15) }], trackById: new Map() };
  const r = weeklyRecap(lib as never, all, w, at(2026, 10, 21));
  it('totals the week and compares with the one before', () => {
    expect(r.plays).toBe(4);
    expect(r.ms).toBe(800000);
    expect(r.prevMs).toBe(200000);
    expect(r.change).toBeCloseTo(3, 10);
    expect(r.partial).toBe(false);
    expect(r.activeDays).toBe(3);
  });
  it('ranks songs, artists and the album of the week', () => {
    expect(r.topTracks[0]).toMatchObject({ label: 'A', plays: 2 });
    expect(r.topArtists.map((a) => a.label)).toEqual(['X', 'Y']);
    expect(r.album).toMatchObject({ label: 'AA', plays: 2 });
  });
  it('counts the reactions given that week only', () => {
    expect(r.reactions).toEqual({ thumbsUp: 1, thumbsDown: 0, votes: 1, memories: 1 });
  });
  it('is partial while the week runs', () => {
    expect(weeklyRecap(none as never, all, w, at(2026, 10, 15)).partial).toBe(true);
  });
});

describe('wrapped', () => {
  it('finds the years and reads release years', () => {
    expect(wrappedYears([L(at(2024, 3, 1)), L(at(2026, 3, 1)), L(at(2025, 1, 1), { ms: 1000 })])).toEqual([2026, 2024]);
    expect(yearOf('2019-05')).toBe(2019); expect(yearOf(null)).toBeNull(); expect(yearOf('x')).toBeNull();
  });
  const tracks = new Map([['t1', { releaseDate: '2001', allGenres: ['rock'] }], ['t2', { releaseDate: '2024-02-01', allGenres: ['pop'] }]]);
  const lib = { ...none, trackById: tracks as never };
  const all: Listen[] = [];
  for (let m = 1; m <= 12; m++) for (let i = 0; i < 4; i++) all.push(L(at(2026, m, 3 + i), m < 6 ? { trackId: 't1', title: 'Old', artist: 'A' } : { trackId: 't2', title: 'New', artist: 'B' }));
  const w = computeWrapped(lib as never, all, 2026, at(2026, 12, 30));
  it('totals, tops, genres and the quiz', () => {
    expect(w.plays).toBe(48);
    expect(w.minutes).toBe(Math.round((48 * 200000) / 60000));
    expect(w.topTracks[0].label).toBe('New');
    expect(w.topGenres[0]).toEqual({ name: 'pop', plays: 28 });
    expect(w.quiz?.options.length).toBe(2);
    expect(w.quiz?.options[w.quiz.answer].label).toBe('New');
    expect(w.partial).toBe(true);
  });
  it('keeps the quiz order stable', () => {
    expect(computeWrapped(lib as never, all, 2026, at(2026, 12, 30)).quiz?.options.map((o) => o.label)).toEqual(w.quiz?.options.map((o) => o.label));
    expect(seededShuffle([1, 2, 3, 4, 5], 9)).toEqual(seededShuffle([1, 2, 3, 4, 5], 9));
    expect([...seededShuffle([1, 2, 3, 4, 5], 9)].sort()).toEqual([1, 2, 3, 4, 5]);
  });
  it('dates the music by the median release year', () => {
    expect(w.listening).toEqual({ medianYear: 2024, age: 18, sampled: 48 });
  });
  it('finds phases and the monthly race', () => {
    expect(w.phases.length).toBeLessThanOrEqual(3);
    expect(w.phases.length).toBeGreaterThanOrEqual(2);
    expect(w.phases[0].name.toLowerCase()).toContain('rock');
    expect(w.race?.artists).toEqual(['B', 'A']);
    expect(w.race?.ranks[0][0]).toBeNull(); // B is not heard in January
    expect(w.race?.ranks[1][0]).toBe(1);
    expect(w.race?.ranks[0][11]).toBe(1);
  });
  it('merges the most alike neighbouring months', () => {
    const ph = musicPhases([{ month: '1', artists: ['a', 'b'], genre: null }, { month: '2', artists: ['a', 'b'], genre: null }, { month: '3', artists: ['c', 'd'], genre: null }, { month: '4', artists: ['c', 'e'], genre: null }, { month: '5', artists: [], genre: null }], 2);
    expect(ph).toHaveLength(2);
    expect(ph[0]).toMatchObject({ fromMonth: '1', toMonth: '2' });
    expect(ph[1]).toMatchObject({ fromMonth: '3', toMonth: '4' });
  });
  it('picks a personality', () => {
    const base = { plays: 600, distinctTracks: 300, newArtists: 5, topArtistShare: 0.1, nightShare: 0.1, morningShare: 0.2, oldShare: 0 };
    const top = (s: ReturnType<typeof personalityScores>) => Object.entries(s).sort((a, b) => b[1] - a[1])[0][0];
    expect(top(personalityScores({ ...base, distinctTracks: 60 }))).toBe('replayer');
    expect(top(personalityScores({ ...base, newArtists: 200 }))).toBe('explorer');
    expect(top(personalityScores({ ...base, nightShare: 0.5 }))).toBe('nightowl');
    expect(top(personalityScores({ ...base, oldShare: 0.9 }))).toBe('timetraveller');
    expect(w.personality).not.toBeNull();
  });
});

describe('more weekly stats', () => {
  const w = weekStart(at(2026, 10, 14));
  const all = [
    L(at(2026, 10, 5), { title: 'Old', artist: 'Z', uri: 'u:old' }),
    L(at(2026, 10, 12, 1), { title: 'A', artist: 'X', uri: 'u:a' }), L(at(2026, 10, 12, 1), { title: 'A', artist: 'X', uri: 'u:a' }), L(at(2026, 10, 12, 2), { title: 'A', artist: 'X', uri: 'u:a' }),
    L(at(2026, 10, 14, 20), { title: 'Old', artist: 'Z', uri: 'u:old' }), L(at(2026, 10, 14, 21), { title: 'B', artist: 'Y', uri: 'u:b', skipped: true }),
  ];
  const r = weeklyRecap({ votes: [], memoryLogs: [], trackById: new Map() } as never, all, w, at(2026, 10, 21));
  it('splits the week by day and finds the long session', () => {
    expect(r.byDay[0]).toBe(600000); expect(r.byDay[2]).toBe(400000); expect(r.byDay[1]).toBe(0);
    expect(r.longestSessionMs).toBeGreaterThanOrEqual(400000);
  });
  it('knows what is new, on repeat, late at night and skipped', () => {
    expect(r.newSongs).toBe(2);           // A and B; "Old" was heard the week before
    expect(r.onRepeat).toMatchObject({ label: 'A', plays: 3 });
    expect(r.lateNight).toBe(3);
    expect(r.completion).toBeCloseTo(0.8, 5);
  });
  it('finds sessions and obsessions', () => {
    expect(longestSession([])).toBeNull();
    expect(longestSession([L(at(2026, 1, 1, 10)), L(at(2026, 1, 1, 10)), L(at(2026, 1, 3, 10))])?.ms).toBe(400000);
    expect(obsession([L(at(2026, 1, 1), { title: 'S' }), L(at(2026, 1, 1), { title: 'S' })])).toBeNull(); // needs three
    expect(obsession([1, 2, 3, 4].map(() => L(at(2026, 1, 1), { title: 'S' })))).toMatchObject({ label: 'S', plays: 4 });
  });
});

describe('more wrapped stats', () => {
  const tracks = new Map([['t1', { releaseDate: '1994-02', allGenres: ['rock'] }], ['t2', { releaseDate: '2024', allGenres: ['pop'] }]]);
  const lib = { votes: [], memoryLogs: [], trackById: tracks as never };
  const all = [L(at(2025, 6, 1), { uri: 'u:1', trackId: 't1', title: 'Old' })];
  for (let i = 0; i < 6; i++) all.push(L(at(2026, 7, 4, 23), { uri: 'u:1', trackId: 't1', title: 'Old', artist: 'A' }));
  for (let i = 0; i < 4; i++) all.push(L(at(2026, 7, 5 + i, 2), { uri: 'u:2', trackId: 't2', title: 'New', artist: 'B', skipped: i === 0 }));
  const w = computeWrapped(lib as never, all, 2026, at(2026, 12, 1));
  it('splits listening by hour, weekday and decade', () => {
    expect(w.hours[23]).toBe(6 * 200000); expect(w.hours[2]).toBe(4 * 200000);
    expect(w.weekdays.reduce((a, b) => a + b, 0)).toBe(10);
    expect(w.decades).toEqual([{ label: '1990s', plays: 6 }, { label: '2020s', plays: 4 }]);
    expect(w.lateNight).toBe(4);
  });
  it('counts new songs only if never heard before the year', () => {
    expect(w.newSongs).toBe(1); // "Old" was played in 2025
  });
  it('finds the obsession, the share of the top artists and the season', () => {
    expect(w.obsession).toMatchObject({ label: 'Old', plays: 6 });
    expect(w.topFiveShare).toBe(1);
    expect(w.skipRate).toBeCloseTo(0.1, 5);
    expect(w.busiestSeason).toBe('summer');
    expect(w.albums).toBe(Math.round((10 * 200000) / 60000 / 40));
    expect(w.lastPlay?.title).toBe('New');
  });
});

describe('abstract art', () => {
  it('draws the same picture from the same seed, and each motif draws something', () => {
    for (const m of MOTIFS) {
      const a = shapes('2026-summary', m), b = shapes('2026-summary', m);
      expect(a.length).toBeGreaterThan(2);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      expect(JSON.stringify(shapes('another', m))).not.toBe(JSON.stringify(a));
      for (const s of a) expect(s.opacity).toBeGreaterThan(0);
    }
  });
});
