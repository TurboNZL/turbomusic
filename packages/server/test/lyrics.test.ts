import { describe, expect, it } from 'vitest';
import { LyricsFinder } from '../src/lyrics.ts';

const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status });
const q = { artist: 'Drake', title: 'Hold On', album: 'Certified Lover Boy', duration: 200 };

describe('lyrics', () => {
  it('uses the exact match, sending artist, title, album and length', async () => {
    const urls: string[] = [];
    const f = (async (u: string) => { urls.push(u); return json({ syncedLyrics: '[00:01.00] hi', plainLyrics: 'hi', instrumental: false }); }) as unknown as typeof fetch;
    const r = await new LyricsFinder(f).find(q);
    expect(r).toMatchObject({ synced: '[00:01.00] hi', plain: 'hi', source: 'LRCLIB' });
    expect(urls[0]).toContain('lrclib.net/api/get?');
    expect(urls[0]).toContain('artist_name=Drake'); expect(urls[0]).toContain('duration=200');
  });
  it('falls back to the search result closest in length, and refuses a different recording', async () => {
    const f = (async (u: string) => u.includes('/api/get') ? json({}, 404) : json([{ duration: 260, plainLyrics: 'live' }, { duration: 203, plainLyrics: 'studio', syncedLyrics: null }])) as unknown as typeof fetch;
    expect((await new LyricsFinder(f).find(q))?.plain).toBe('studio');
    const far = (async (u: string) => u.includes('/api/get') ? json({}, 404) : json([{ duration: 400, plainLyrics: 'x' }])) as unknown as typeof fetch;
    expect(await new LyricsFinder(far).find(q)).toBeNull();
  });
  it('remembers answers, including misses', async () => {
    let n = 0;
    const f = (async () => { n++; return json({}, 404); }) as unknown as typeof fetch;
    const finder = new LyricsFinder(f);
    await finder.find(q); const first = n; await finder.find(q);
    expect(n).toBe(first);
  });
  it('reports an instrumental', async () => {
    const f = (async () => json({ instrumental: true, plainLyrics: null, syncedLyrics: null })) as unknown as typeof fetch;
    expect(await new LyricsFinder(f).find(q)).toMatchObject({ instrumental: true });
  });
  it('prefers a record with words over an instrumental one', async () => {
    const f = (async (u: string) => (u.includes('/api/get') ? json({ instrumental: true, plainLyrics: null, syncedLyrics: null })
      : json([{ duration: 200, instrumental: true, syncedLyrics: null, plainLyrics: null }, { duration: 190, instrumental: false, syncedLyrics: '[00:01.00] words', plainLyrics: 'words' }]))) as unknown as typeof fetch;
    expect(await new LyricsFinder(f).find(q)).toMatchObject({ instrumental: false, plain: 'words' });
  });
});
