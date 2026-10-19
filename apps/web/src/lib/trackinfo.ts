import type { Library } from './library.ts';
import { buildListens } from './listens.ts';
import { memoryDates } from './memories.ts';

export interface VoteLine { voteId: string; opponent: string; opponentExists: boolean; result: 'won' | 'lost' | 'equal' | 'thumb up' | 'thumb down'; timestamp: number }
export interface PlayLine { logId: string; timestamp: number; seconds: number; isSkip: boolean; source: string | null; imported?: boolean }
export interface TrackInfo {
  /** every logged play of this track, newest first */
  history: PlayLine[];
  wins: number; losses: number; draws: number;
  votes: VoteLine[];
  /** when each memory was added since they were recorded, newest first (earlier ones are only in the track's counter) */
  memories: { id: string; timestamp: number }[];
  plays: number; skips: number; secondsListened: number; lastPlayed: number | null;
}

/** Everything the details dialog shows about one track: its vote record and listening history. */
export function trackInfo(lib: Library, trackId: string): TrackInfo {
  const votes: VoteLine[] = [];
  let wins = 0, losses = 0, draws = 0;
  for (const v of lib.votes) {
    if (v.trackAId !== trackId && v.trackBId !== trackId) continue;
    if (v.boost) {
      votes.push({ voteId: v.id, opponent: v.boost > 0 ? 'Thumbs up' : 'Thumbs down', opponentExists: false, result: v.boost > 0 ? 'thumb up' : 'thumb down', timestamp: v.timestamp });
      if (v.boost > 0) wins++; else losses++;
      continue;
    }
    const otherId = v.trackAId === trackId ? v.trackBId : v.trackAId;
    const result = v.isEqual ? 'equal' : v.winnerId === trackId ? 'won' : 'lost';
    if (result === 'won') wins++; else if (result === 'lost') losses++; else draws++;
    const other = lib.trackById.get(otherId);
    votes.push({ voteId: v.id, opponent: other ? `${other.title} · ${other.artistName}` : '(deleted track)', opponentExists: !!other, result, timestamp: v.timestamp });
  }
  votes.sort((a, b) => b.timestamp - a.timestamp);
  // TurboMusic's own plays and the ones imported from Spotify (matched to this track by link or by title and artist)
  const logs = buildListens(lib).filter((l) => l.trackId === trackId);
  const sourceOf = new Map(lib.logs.map((l) => [l.id, l.sourceType ?? null] as const));
  const history = logs.map((l) => ({ logId: l.id, timestamp: l.ts, seconds: l.ms / 1000, isSkip: l.skipped, source: l.source === 'spotify' ? 'Spotify' : sourceOf.get(l.id) ?? null, imported: l.source === 'spotify' }))
    .sort((a, b) => b.timestamp - a.timestamp);
  return {
    history, wins, losses, draws, votes, memories: memoryDates(lib, trackId),
    plays: logs.length, skips: logs.filter((l) => l.skipped).length,
    secondsListened: logs.reduce((s, l) => s + l.ms / 1000, 0),
    lastPlayed: logs.length ? Math.max(...logs.map((l) => l.ts)) : null,
  };
}
