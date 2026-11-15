/**
 * A tiny in-memory "remember it for a while" for server answers that do not change from one page visit to the next (the server's
 * file counts, the download queue's state). Without it, leaving a tab and coming back asked the server again every time.
 */
const mem = new Map<string, { at: number; v: unknown }>();

/** what was last fetched under this key, if anything (even when old: show it at once, refresh behind it) */
export const peek = <T,>(key: string): T | undefined => mem.get(key)?.v as T | undefined;

/** the cached answer when it is younger than `ttlMs`, else fetch, remember and return a new one */
export async function fresh<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = mem.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.v as T;
  const v = await fn();
  mem.set(key, { at: Date.now(), v });
  return v;
}

/** forget one (or every) remembered answer, after something that changes it */
export const forget = (key?: string) => { if (key) mem.delete(key); else mem.clear(); };
