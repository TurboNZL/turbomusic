import type { Library } from './library.ts';
import { useStore } from './store.ts';

/** When each memory of a track was added, newest first (only memories added since they were recorded; older ones are in the counter only). */
export function memoryDates(lib: Pick<Library, 'memoryLogs'>, trackId: string): { id: string; timestamp: number }[] {
  return (lib.memoryLogs ?? []).filter((m) => m.trackId === trackId).map((m) => ({ id: m.id, timestamp: m.timestamp })).sort((a, b) => b.timestamp - a.timestamp);
}

/** The newest recorded memory of a track, or null when none was recorded (a memory from before the log is just taken off the counter). */
export function newestMemory(logs: { id: string; trackId: string; timestamp: number }[], trackId: string): string | null {
  let best: { id: string; timestamp: number } | null = null;
  for (const m of logs) if (m.trackId === trackId && (!best || m.timestamp > best.timestamp)) best = m;
  return best?.id ?? null;
}

/** Adds a memory: the counter goes up and the moment is recorded. */
export function addMemory(trackId: string) {
  const s = useStore.getState();
  const cur = (s.rows.tracks.get(trackId)?.data as { memories?: number } | undefined)?.memories ?? 0;
  s.patch('tracks', trackId, { memories: cur + 1 });
  s.put('memoryLogs', { trackId, timestamp: Date.now() });
}

/** Removes a memory: the counter goes down and the newest recorded moment is deleted (it was rescinded, so it no longer counts). */
export function removeMemory(trackId: string) {
  const s = useStore.getState();
  const cur = (s.rows.tracks.get(trackId)?.data as { memories?: number } | undefined)?.memories ?? 0;
  if (cur < 1) return;
  s.patch('tracks', trackId, { memories: cur - 1 });
  const logs = [...s.rows.memoryLogs.values()].filter((r) => !r.deleted).map((r) => ({ id: r.id, ...(r.data as { trackId: string; timestamp: number }) }));
  const id = newestMemory(logs, trackId);
  if (id) s.remove('memoryLogs', id);
}
