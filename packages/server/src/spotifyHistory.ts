import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { SyncRecord } from '@turbomusic/core';
import type { Store } from './db.ts';
import { SpotifyError, type RecentPlay, type SpotifyAccount } from './spotify.ts';

/**
 * The automatic listening-history check: every few minutes the server asks Spotify what was played recently and adds the new plays to
 * the library's history (the same records an export file makes, so Stats and the track pages see them at once). Spotify only
 * remembers the last 50 plays, which is plenty for a check every quarter of an hour. One tiny request each time.
 *
 * The plays are marked `via: 'api'`: the app drops one when the same play is also in an export file or in TurboMusic's own log, so
 * importing an export later or playing through TurboMusic never counts a play twice.
 */
export interface HistoryState { enabled: boolean; /** the newest play already stored (ms) */ cursor: number; lastCheck: number | null; lastError: string | null; added: number; lastAdded: number }

const INTERVAL_MS = 15 * 60_000;
const DEVICE = 'server-spotify-history';
export const playId = (p: RecentPlay) => `sp-${p.playedAt}-${p.uri.split(':').pop()}`.slice(0, 64);

export function playRecord(p: RecentPlay, now: number): SyncRecord {
  const data = {
    trackId: '', timestamp: p.playedAt, duration: Math.round(p.durationMs / 1000), sourceType: 'spotify', sourceId: null, isSkip: false,
    imported: 'spotify', via: 'api', name: p.name, artist: p.artist, album: p.album, uri: p.uri, platform: 'Spotify', reasonEnd: 'trackdone',
  };
  return { table: 'playbackLogs', id: playId(p), updatedAt: now, deviceId: DEVICE, deleted: false, data };
}

export class SpotifyHistory {
  private file: string;
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;
  private spotify: Pick<SpotifyAccount, 'recentlyPlayed' | 'status'>;
  private store: Pick<Store, 'push'>;
  private o: { now?: () => number; intervalMs?: number };
  constructor(dataDir: string, spotify: Pick<SpotifyAccount, 'recentlyPlayed' | 'status'>, store: Pick<Store, 'push'>, o: { now?: () => number; intervalMs?: number } = {}) {
    this.file = join(dataDir, 'spotify-history.json'); this.spotify = spotify; this.store = store; this.o = o;
  }
  private now() { return (this.o.now ?? Date.now)(); }
  private load(): HistoryState { try { return { enabled: false, cursor: 0, lastCheck: null, lastError: null, added: 0, lastAdded: 0, ...(JSON.parse(readFileSync(this.file, 'utf8')) as Partial<HistoryState>) }; } catch { return { enabled: false, cursor: 0, lastCheck: null, lastError: null, added: 0, lastAdded: 0 }; } }
  private save(s: HistoryState) { mkdirSync(dirname(this.file), { recursive: true }); writeFileSync(this.file, JSON.stringify(s, null, 2)); }

  status() { const s = this.load(); const sp = this.spotify.status(); return { ...s, canHistory: sp.canHistory, signedIn: sp.signedIn, everyMinutes: Math.round((this.o.intervalMs ?? INTERVAL_MS) / 60000) }; }
  setEnabled(on: boolean) { const s = this.load(); s.enabled = on; this.save(s); if (on) { this.start(); void this.check(); } else this.stop(); }

  /** One check. Returns how many plays were new. Never throws: a failure is kept in the status. */
  async check(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    const s = this.load();
    try {
      const plays = await this.spotify.recentlyPlayed(s.cursor || undefined);
      const fresh = plays.filter((p) => p.playedAt > s.cursor);
      if (fresh.length) this.store.push(fresh.map((p) => playRecord(p, this.now())));
      s.cursor = Math.max(s.cursor, ...plays.map((p) => p.playedAt));
      s.added += fresh.length; s.lastAdded = fresh.length; s.lastError = null;
      s.lastCheck = this.now();
      this.save(s);
      return fresh.length;
    } catch (e) {
      s.lastCheck = this.now(); s.lastError = e instanceof SpotifyError ? e.message : (e as Error).message;
      this.save(s);
      return 0;
    } finally { this.running = false; }
  }

  start() { if (this.timer || !this.load().enabled) return; this.timer = setInterval(() => void this.check(), this.o.intervalMs ?? INTERVAL_MS); this.timer.unref?.(); }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = undefined; }
}
