import type { PlaybackSnapshot } from '@turbomusic/core';
import { useStore } from './store.ts';

/**
 * The player's state, written to this device every few seconds while something plays, so a crash, a killed browser tab or a phone
 * that reclaimed the app loses nothing: Home offers "pick up where you left off" with the queue and the position, and the play that
 * was cut short is still written to the listening history when the app comes back.
 */
const KEY = 'turbomusic.session';
const EVERY_MS = 3000;

export interface PendingPlay { id: string; seconds: number; length: number | null; started: number; sourceType: string; sourceId: string | null }
export interface SavedSession { snap: PlaybackSnapshot; at: number; pending: PendingPlay | null; /** sound was playing at the last save: the app was closed or killed mid-song, not paused by you */ interrupted?: boolean }

export function readSession(): SavedSession | null {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as SavedSession | null; return v?.snap?.trackId ? v : null; } catch { return null; }
}
function write(v: SavedSession | null) {
  try { if (v) localStorage.setItem(KEY, JSON.stringify(v)); else localStorage.removeItem(KEY); } catch { /* storage blocked or full: just no session */ }
}
export const clearSession = () => write(null);

/** The play with this id was written to the history normally: nothing is left to recover for it. */
export function playLogged(id: string) {
  const s = readSession();
  if (s?.pending?.id === id) write({ ...s, pending: null });
}

/** What a crash cut short, once: the caller writes it to the history. */
export function takeCutShortPlay(): PendingPlay | null {
  const s = readSession();
  if (!s?.pending) return null;
  const p = s.pending;
  write({ ...s, pending: null });
  return p;
}

interface Playerish {
  getState(): { queue: { currentId: string | null }; playing: boolean; time: number; duration: number; source: { type: string; id: string | null }; snapshot(): PlaybackSnapshot };
  subscribe(fn: (s: ReturnType<Playerish['getState']>, prev: ReturnType<Playerish['getState']>) => void): () => void;
}

/** Started once by the player. Writes on a track or play/pause change at once, and on the clock at most every few seconds. */
export function startSessionSaving(player: Playerish) {
  if (typeof window === 'undefined') return;
  let last = 0, startedAt = 0, startedFor: string | null = null;
  const save = (force: boolean) => {
    const s = player.getState();
    const id = s.queue.currentId;
    if (!id) return; // a finished queue leaves the last session in place; "nothing playing" is not worth overwriting it with
    if (!force && Date.now() - last < EVERY_MS) return;
    last = Date.now();
    if (startedFor !== id) { startedFor = id; startedAt = Date.now() - Math.round(s.time * 1000); }
    const snap = s.snapshot();
    const prev = readSession();
    const pending: PendingPlay | null = s.playing || s.time >= 1
      ? { id, seconds: Math.round(s.time), length: s.duration > 0 ? Math.round(s.duration) : null, started: startedAt, sourceType: s.source.type, sourceId: s.source.id }
      : prev?.pending && prev.pending.id === id ? prev.pending : null;
    write({ snap: { ...snap, playing: false, meta: undefined }, at: Date.now(), pending, interrupted: s.playing });
  };
  player.subscribe((s, p) => {
    if (s.queue !== p.queue || s.playing !== p.playing || s.queue.currentId !== p.queue.currentId) save(true);
    else if (s.playing && s.time !== p.time) save(false);
  });
  // a play that a killed app (Android reclaiming it, a crash) left unwritten goes into the history as soon as the app is back, wherever it opens
  setTimeout(() => {
    const p = takeCutShortPlay();
    if (p && p.seconds >= 1) useStore.getState().put('playbackLogs', { trackId: p.id, timestamp: p.started, duration: p.seconds, length: p.length, sourceType: p.sourceType, sourceId: p.sourceId, isSkip: false } as never);
  }, 4000);
  window.addEventListener('pagehide', () => save(true));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') save(true); });
}
