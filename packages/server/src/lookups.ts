/**
 * Open-data lookups for the library's own gaps: a picture of an artist and the genres of an album. Both answer only for an EXACT name match
 * (a near miss would put the wrong face or genre on something), and both can fail quietly: offline, rate limited, nothing found.
 *  - artist picture: Deezer's public search (no key). Placeholder pictures (an empty hash in the URL) are ignored; of several exact
 *    matches the one with the most fans wins.
 *  - album genres: iTunes Search's primary genre for an exact album + artist match, and MusicBrainz release-group tags (the community's own,
 *    more specific, used only when a tag has been given at least twice).
 */
type Fetch = typeof fetch;
const UA = 'TurboMusic/1.0 (personal music library; https://github.com/TurboNZL/turbomusic)';

export const plainName = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/^the\s+/, '').replace(/\s*[(\[][^)\]]*[)\]]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Deezer `search/artist` data: the best exact-name match that has a real picture. Returns the picture link or null. */
export function pickDeezerArtist(data: unknown, names: string[]): { image: string; name: string } | null {
  const want = new Set(names.map(plainName).filter(Boolean));
  const hits = (Array.isArray(data) ? data : [])
    .filter((a) => want.has(plainName(String(a?.name ?? ''))) && typeof (a?.picture_xl ?? a?.picture_big) === 'string' && !/\/images\/artist\/\/|\/artist\/\/\d/.test(String(a.picture_xl ?? a.picture_big)))
    .sort((a, b) => Number(b?.nb_fan ?? 0) - Number(a?.nb_fan ?? 0));
  const best = hits[0];
  return best ? { image: String(best.picture_xl ?? best.picture_big), name: String(best.name) } : null;
}

export async function lookupArtistImage(names: string[], o: { fetchImpl?: Fetch } = {}): Promise<{ image: string; name: string; source: 'deezer' } | null> {
  const f = o.fetchImpl ?? fetch;
  for (const n of names.map((x) => x.trim()).filter(Boolean).slice(0, 3)) {
    try {
      const res = await f(`https://api.deezer.com/search/artist?${new URLSearchParams({ q: n, limit: '8' })}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(7000) });
      if (!res.ok) continue;
      const hit = pickDeezerArtist(((await res.json()) as { data?: unknown }).data, names);
      if (hit) return { ...hit, source: 'deezer' };
    } catch { /* offline or slow: the next name */ }
  }
  return null;
}

export interface GenreHit { name: string; source: 'itunes' | 'musicbrainz' }

/** iTunes `results`: the primary genre of the album with exactly this title by this artist ("Hip-Hop/Rap", "Pop"...). */
export function pickItunesGenre(results: unknown, album: string, artist: string): string | null {
  const t = plainName(album), a = plainName(artist);
  const hit = (Array.isArray(results) ? results : []).find((r) => plainName(String(r?.collectionName ?? '')) === t && plainName(String(r?.artistName ?? '')) === a && typeof r?.primaryGenreName === 'string');
  const g = hit ? String(hit.primaryGenreName).trim() : '';
  return g && !/^music$/i.test(g) ? g : null;
}

/** MusicBrainz release-group search: tags given at least twice (best first) by an exact match scoring 90 or more. */
export function pickMusicBrainzGenres(json: unknown, album: string, artist: string, max = 3): string[] {
  const groups = (json as { 'release-groups'?: any[] } | null)?.['release-groups'] ?? [];
  const t = plainName(album), a = plainName(artist);
  const hit = groups.find((g) => Number(g?.score ?? 0) >= 90 && plainName(String(g?.title ?? '')) === t && (g['artist-credit'] ?? []).some((c: any) => plainName(String(c?.name ?? c?.artist?.name ?? '')) === a));
  const tags: { name: string; count: number }[] = (hit?.tags ?? []).map((x: any) => ({ name: String(x?.name ?? '').trim(), count: Number(x?.count ?? 0) })).filter((x: { name: string; count: number }) => x.name && x.count >= 2);
  return tags.sort((x, y) => y.count - x.count).slice(0, max).map((x) => x.name);
}

export async function lookupAlbumGenres(q: { album: string; artist: string }, o: { fetchImpl?: Fetch } = {}): Promise<GenreHit[]> {
  const f = o.fetchImpl ?? fetch;
  const album = q.album.trim(), artist = q.artist.trim();
  if (!album || !artist || artist === 'Unknown artist') return [];
  const out: GenreHit[] = [];
  try {
    const res = await f(`https://itunes.apple.com/search?${new URLSearchParams({ term: `${artist} ${album}`, entity: 'album', limit: '10' })}`, { signal: AbortSignal.timeout(7000) });
    if (res.ok) { const g = pickItunesGenre(((await res.json()) as { results?: unknown }).results, album, artist); if (g) out.push({ name: g, source: 'itunes' }); }
  } catch { /* offline or slow */ }
  try {
    const query = `releasegroup:"${album.replace(/"/g, '')}" AND artist:"${artist.replace(/"/g, '')}"`;
    const res = await f(`https://musicbrainz.org/ws/2/release-group/?${new URLSearchParams({ query, fmt: 'json', limit: '5' })}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
    if (res.ok) for (const name of pickMusicBrainzGenres(await res.json(), album, artist)) if (!out.some((g) => g.name.toLowerCase() === name.toLowerCase())) out.push({ name, source: 'musicbrainz' });
  } catch { /* offline, rate limited */ }
  return out;
}
