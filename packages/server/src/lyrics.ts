/**
 * Lyrics from LRCLIB (https://lrclib.net), a free, open lyrics database that needs no key. The server asks on behalf of the app so the
 * browser never has to reach another site (no CORS, one User-Agent, a shared cache). `GET /api/get` matches artist + title (+ album, length);
 * when that finds nothing a plain search is tried. Results are kept in memory for a day, misses for an hour.
 */
export interface Lyrics { synced: string | null; plain: string | null; instrumental: boolean; source: string }
export interface LyricsQuery { artist: string; title: string; album?: string; duration?: number }

type Fetch = typeof fetch;
const UA = 'TurboMusic (https://github.com/TurboNZL/turbomusic)';

const fromRecord = (j: any): Lyrics | null => {
  if (!j || typeof j !== 'object') return null;
  const synced = typeof j.syncedLyrics === 'string' && j.syncedLyrics.trim() ? j.syncedLyrics : null;
  const plain = typeof j.plainLyrics === 'string' && j.plainLyrics.trim() ? j.plainLyrics : null;
  if (!synced && !plain && !j.instrumental) return null;
  return { synced, plain, instrumental: !!j.instrumental, source: 'LRCLIB' };
};

export class LyricsFinder {
  private cache = new Map<string, { at: number; value: Lyrics | null }>();
  private f: Fetch;
  constructor(f: Fetch = fetch) { this.f = f; }

  async find(q: LyricsQuery): Promise<Lyrics | null> {
    const key = `${q.artist}|${q.title}|${q.album ?? ''}|${Math.round(q.duration ?? 0)}`.toLowerCase();
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < (hit.value ? 86_400_000 : 3_600_000)) return hit.value;
    const value = await this.lookup(q);
    if (this.cache.size > 300) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, { at: Date.now(), value });
    return value;
  }

  private async get(url: string): Promise<any | null> {
    const res = await this.f(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10_000) });
    return res.ok ? res.json() : null;
  }

  private async lookup(q: LyricsQuery): Promise<Lyrics | null> {
    const p = new URLSearchParams({ artist_name: q.artist, track_name: q.title });
    if (q.album) p.set('album_name', q.album);
    if (q.duration && q.duration > 0) p.set('duration', String(Math.round(q.duration)));
    const exact = fromRecord(await this.get(`https://lrclib.net/api/get?${p}`).catch(() => null));
    // a record marked instrumental is the last resort, not an answer: LRCLIB also lists instrumental cuts under the same name, and a song with words must not read "Instrumental."
    const asked = /instrumental/i.test(q.title);
    if (exact && (!exact.instrumental || asked)) return exact;
    // no exact match (the album or length differ): take the search result closest in length that has the best lyrics
    const list = await this.get(`https://lrclib.net/api/search?${new URLSearchParams({ artist_name: q.artist, track_name: q.title })}`).catch(() => null);
    if (!Array.isArray(list)) return exact;
    const withWords = (r: any) => !!(r.syncedLyrics?.trim?.() || r.plainLyrics?.trim?.());
    const ok = list.filter((r) => fromRecord(r) && (withWords(r) || asked)).sort((a, b) => {
      const da = q.duration ? Math.abs((a.duration ?? 0) - q.duration) : 0, db = q.duration ? Math.abs((b.duration ?? 0) - q.duration) : 0;
      return da - db || (b.syncedLyrics ? 1 : 0) - (a.syncedLyrics ? 1 : 0);
    });
    const best = ok[0];
    if (!best || (q.duration && best.duration && Math.abs(best.duration - q.duration) > 15)) return exact; // a different recording: only an instrumental record (if any) is left
    return fromRecord(best);
  }
}
