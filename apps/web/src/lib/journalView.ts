/** The pure parts of the journal page: moods, grouping, the activity grid, streaks and "on this day". */
export interface Entry { id: string; type: string; title: string; description: string; entityId: string | null; timestamp: number; mood?: string | null; pinned?: boolean }

export const MOODS = [
  { id: 'inspired', emoji: '✨', label: 'Inspired' },
  { id: 'fire', emoji: '🔥', label: 'On fire' },
  { id: 'chill', emoji: '😌', label: 'Chill' },
  { id: 'thinking', emoji: '🤔', label: 'Thinking' },
  { id: 'discovery', emoji: '🎧', label: 'Discovery' },
  { id: 'nostalgic', emoji: '🕰️', label: 'Nostalgic' },
  { id: 'frustrated', emoji: '😤', label: 'Frustrated' },
] as const;
export const moodOf = (id: string | null | undefined) => MOODS.find((m) => m.id === id);

export const PROMPTS = [
  'What did you discover this week?', 'Which album do you keep coming back to, and why?', 'A song that changed your mind about an artist…',
  'What would you tell your past self about this record?', 'Which rating did you change your mind about?', 'What does this album sound like to you?',
  'The best thing you heard today…', 'A track that deserves more votes…',
];

export const dayStart = (ts: number) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
const DAY = 86_400_000;

/** Entries grouped by calendar month, newest month first (entries inside a month newest first). */
export function groupByMonth(entries: Entry[]): { key: string; label: string; entries: Entry[] }[] {
  const sorted = [...entries].sort((a, b) => b.timestamp - a.timestamp);
  const out: { key: string; label: string; entries: Entry[] }[] = [];
  for (const e of sorted) {
    const d = new Date(e.timestamp), key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    let g = out[out.length - 1];
    if (!g || g.key !== key) { g = { key, label: d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }), entries: [] }; out.push(g); }
    g.entries.push(e);
  }
  return out;
}

/** `weeks` columns of 7 days (Monday first) ending with the week of `now`: how many entries each day has; days after today are null. */
export function activityGrid(entries: Entry[], weeks = 20, now = Date.now()): { day: number; count: number | null }[][] {
  const count = new Map<number, number>();
  for (const e of entries) { const k = dayStart(e.timestamp); count.set(k, (count.get(k) ?? 0) + 1); }
  const today = dayStart(now), dow = (new Date(today).getDay() + 6) % 7;
  const start = today - dow * DAY - (weeks - 1) * 7 * DAY;
  return Array.from({ length: weeks }, (_, w) => Array.from({ length: 7 }, (_, d) => { const day = start + (w * 7 + d) * DAY; return { day, count: day > today ? null : count.get(day) ?? 0 }; }));
}

/** Days in a row, up to today (or yesterday: the day is not over), on which something was written. */
export function writingStreak(entries: Entry[], now = Date.now()): number {
  const days = new Set(entries.filter((e) => e.type === 'entry').map((e) => dayStart(e.timestamp)));
  let d = dayStart(now);
  if (!days.has(d)) d -= DAY;
  let n = 0;
  while (days.has(d)) { n++; d -= DAY; }
  return n;
}

/** Entries written on this calendar day in an earlier year, newest year first. */
export function onThisDay(entries: Entry[], now = Date.now()): Entry[] {
  const t = new Date(now);
  return entries.filter((e) => { const d = new Date(e.timestamp); return d.getFullYear() < t.getFullYear() && d.getMonth() === t.getMonth() && d.getDate() === t.getDate(); }).sort((a, b) => b.timestamp - a.timestamp);
}

/** The most played track within a day of this date in each earlier year (from a list of plays), newest year first. */
export function listeningOnThisDay(plays: { ts: number; trackId: string | null }[], now = Date.now()): { year: number; trackId: string; plays: number }[] {
  const t = new Date(now), out: { year: number; trackId: string; plays: number }[] = [];
  for (let y = t.getFullYear() - 1; y >= t.getFullYear() - 8; y--) {
    const centre = new Date(y, t.getMonth(), t.getDate()).getTime();
    const n = new Map<string, number>();
    for (const p of plays) if (p.trackId && Math.abs(p.ts - centre - DAY / 2) <= DAY) n.set(p.trackId, (n.get(p.trackId) ?? 0) + 1);
    const best = [...n.entries()].sort((a, b) => b[1] - a[1])[0];
    if (best && best[1] >= 2) out.push({ year: y, trackId: best[0], plays: best[1] });
  }
  return out;
}
