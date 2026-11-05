/** Which recap the owner has already opened or dismissed on this device, so Home announces each new one once. */
const KEY = 'turbomusic.recapSeen', WKEY = 'turbomusic.wrappedSeen';
const read = (k: string) => { try { return Number(localStorage.getItem(k)) || 0; } catch { return 0; } };
const write = (k: string, v: number) => { try { localStorage.setItem(k, String(v)); } catch { /* private window */ } };
export const recapSeen = () => read(KEY);
export const markRecapSeen = (weekStartTs: number) => write(KEY, Math.max(weekStartTs, read(KEY)));
export const wrappedSeen = () => read(WKEY);
export const markWrappedSeen = (year: number) => write(WKEY, Math.max(year, read(WKEY)));
/** Wrapped is announced from November on (Spotify's arrives in early December), for the current year only. */
export const wrappedSeason = (now = new Date()) => now.getMonth() >= 10;
