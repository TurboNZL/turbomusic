import type { Library } from './library.ts';

const fold = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** YouTube's channel names carry decorations: "Drake - Topic", "DrakeVEVO", "Drake Official". */
export const cleanArtistName = (s: string) => s.replace(/\s*-\s*topic$/i, '').replace(/\s*vevo$/i, '').replace(/\s+official(\s+(channel|artist channel))?$/i, '').trim();

/** "Album - Take Care" (YouTube Music's own playlist title) is the album "Take Care". */
export const cleanAlbumTitle = (s: string) => s.replace(/^album\s*-\s*/i, '').replace(/\s*[([]\s*(official\s+)?(full\s+)?(album|audio)\s*[)\]]\s*$/i, '').trim();

/** The library artist a scraped name stands for (accents, case and channel decorations do not matter), or undefined. */
export function matchArtist<T extends { name: string; aliases?: string[] }>(artists: T[], scraped: string): T | undefined {
  const want = fold(cleanArtistName(scraped));
  if (!want) return undefined;
  // a primary name beats an alias, so an artist called "Future" is not taken over by someone whose alias it is
  return artists.find((a) => fold(a.name) === want) ?? artists.find((a) => (a.aliases ?? []).some((x) => fold(x) === want));
}

/** "AKA: A, B & 2 more" for a name and its aliases, or null when there are none. */
export function akaLine(aliases: string[] | undefined, show = 2): string | null {
  const list = (aliases ?? []).filter(Boolean);
  if (!list.length) return null;
  const head = list.slice(0, show), rest = list.length - head.length;
  return `AKA: ${head.length > 1 ? `${head.slice(0, -1).join(', ')}${rest ? ', ' : ' & '}${head[head.length - 1]}` : head[0]}${rest ? ` & ${rest} more` : ''}`;
}

/** Make `alias` the displayed name: the old name moves into the aliases. */
export function makePrimary(name: string, aliases: string[], alias: string): { name: string; aliases: string[] } {
  return { name: alias, aliases: [name, ...aliases.filter((x) => x !== alias)] };
}

/** The genres an artist's albums and tracks use most, as the starting genres for something new by them (at most `n`). */
export function genresFor(lib: Library, artistId: string, n = 3): string[] {
  const count = new Map<string, number>();
  const bump = (g: string) => count.set(g, (count.get(g) ?? 0) + 1);
  for (const a of lib.albums) if (a.leads.some((l) => l.id === artistId)) a.genres.forEach(bump);
  for (const t of lib.tracks) if (!t.albumId && t.leads.some((l) => l.id === artistId)) t.allGenres.forEach(bump);
  return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n).map(([g]) => g);
}

const FEAT_WORD = '(?:feat(?:uring)?\\.?|ft\\.?)';
// "(feat. A & B)", "[ft. A]", "(with A)" at the end; or a bare " feat. A" / " - feat. A" tail
const FEAT_GROUPED = new RegExp(`\\s*[(\\[]\\s*(?:${FEAT_WORD}|with)\\s+([^)\\]]+?)\\s*[)\\]]\\s*$`, 'i');
const FEAT_BARE = new RegExp(`\\s+(?:-\\s*)?${FEAT_WORD}\\s+(.+)$`, 'i');

/** Splits "Song (feat. A & B)" into the title and the featured names, so credits can carry them instead of the title. */
export function splitFeaturing(title: string): { title: string; featured: string[] } {
  let t = title.trim(), names = '';
  // a title can hold several tails ("Song (feat. A) [Remix]"): only the LAST group is looked at, then the rest again
  const g = FEAT_GROUPED.exec(t);
  if (g) { names = g[1]; t = t.slice(0, g.index).trim(); }
  else { const b = FEAT_BARE.exec(t); if (b) { names = b[1]; t = t.slice(0, b.index).trim(); } }
  if (!names || !t) return { title: title.trim(), featured: [] };
  const featured = names.split(/\s*(?:,|&|\+|\band\b|\bx\b|\bwith\b)\s*/i).map((n) => n.trim()).filter(Boolean);
  return { title: t, featured: [...new Set(featured)] };
}
