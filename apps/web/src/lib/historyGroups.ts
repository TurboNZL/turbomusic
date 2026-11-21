import type { PlaybackLogData } from '@turbomusic/core';

/** What the history manager can group imported plays by. */
export type GroupBy = 'account' | 'artist' | 'album' | 'year' | 'source';

export interface Group {
  key: string;
  label: string;
  sub?: string;
  plays: number;
  /** listening time, ms */
  ms: number;
  ids: string[];
  /** every play of the group is hidden */
  hidden: boolean;
}

export interface LogRow { id: string; data: PlaybackLogData }

/** Plays that came from Spotify (an export file or the automatic check): the ones the manager works on. */
export const isSpotifyLog = (l: PlaybackLogData) => l.imported === 'spotify';

const keyFor = (l: PlaybackLogData, by: GroupBy): { key: string; label: string; sub?: string } => {
  switch (by) {
    case 'account': { const a = l.account?.trim() || ''; return { key: a, label: a || 'No account named' }; }
    case 'artist': { const a = (l.artist ?? '').trim() || 'Unknown artist'; return { key: a.toLowerCase(), label: a }; }
    case 'album': { const al = (l.album ?? '').trim() || 'No album', ar = (l.artist ?? '').trim(); return { key: `${al.toLowerCase()}|${ar.toLowerCase()}`, label: al, sub: ar }; }
    case 'year': { const y = String(new Date(l.timestamp).getFullYear()); return { key: y, label: y }; }
    case 'source': return l.via === 'api' ? { key: 'api', label: 'Found automatically (recently played)' } : { key: 'file', label: 'Imported from export files' };
  }
};

/** Group plays (hidden ones included) for the manager, biggest listening time first. */
export function groupLogs(rows: readonly LogRow[], by: GroupBy): Group[] {
  const m = new Map<string, Group & { hid: number }>();
  for (const r of rows) {
    if (!isSpotifyLog(r.data)) continue;
    const { key, label, sub } = keyFor(r.data, by);
    const g = m.get(key) ?? { key, label, sub, plays: 0, ms: 0, ids: [], hidden: false, hid: 0 };
    g.plays++; g.ms += Math.max(0, (r.data.duration ?? 0) * 1000); g.ids.push(r.id);
    if (r.data.hidden) g.hid++;
    m.set(key, g);
  }
  return [...m.values()].map(({ hid, ...g }) => ({ ...g, hidden: hid === g.plays })).sort((a, b) => b.ms - a.ms || b.plays - a.plays || a.label.localeCompare(b.label));
}

/** Words typed as "asmr, sleep sounds" → the plays whose artist, album or title contains any of them. */
export function matchWords(rows: readonly LogRow[], words: string): string[] {
  const list = words.split(/[,\n]/).map((w) => w.trim().toLowerCase()).filter(Boolean);
  if (!list.length) return [];
  return rows.filter((r) => isSpotifyLog(r.data) && list.some((w) => `${r.data.artist ?? ''} ${r.data.album ?? ''} ${r.data.name ?? ''}`.toLowerCase().includes(w))).map((r) => r.id);
}

/** Before an import: the entries a "leave out" choice removes (words, and whole artists ticked in the preview). */
export function leaveOut<T extends { master_metadata_album_artist_name?: string | null; master_metadata_album_album_name?: string | null; master_metadata_track_name?: string | null }>(entries: readonly T[], opts: { words: string; artists: ReadonlySet<string> }): T[] {
  const list = opts.words.split(/[,\n]/).map((w) => w.trim().toLowerCase()).filter(Boolean);
  if (!list.length && !opts.artists.size) return [...entries];
  return entries.filter((e) => {
    const artist = (e.master_metadata_album_artist_name ?? '').trim().toLowerCase();
    if (opts.artists.has(artist)) return false;
    const text = `${e.master_metadata_album_artist_name ?? ''} ${e.master_metadata_album_album_name ?? ''} ${e.master_metadata_track_name ?? ''}`.toLowerCase();
    return !list.some((w) => text.includes(w));
  });
}
