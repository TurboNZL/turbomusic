/**
 * Genre names are free text on albums and tracks, and the sources that suggest them disagree about spelling ("Hip-Hop/Rap", "hip hop",
 * "Rap"). These are the pure rules for matching a suggestion to the genres the library already has, and for merging tags.
 */
export const genreKey = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
const compact = (s: string) => genreKey(s).replace(/ /g, '');

export type GenreMatch =
  | { kind: 'existing'; name: string }
  /** the suggestion is not a genre the library has, but is made of / contains ones it has ("Hip-Hop/Rap" when "Hip-Hop" and "Rap" exist): ask which */
  | { kind: 'similar'; candidates: string[] }
  | { kind: 'new' };

export function matchGenre(candidate: string, existing: string[]): GenreMatch {
  const c = compact(candidate);
  if (!c) return { kind: 'new' };
  const exact = existing.find((e) => compact(e) === c);
  if (exact) return { kind: 'existing', name: exact };
  const parts = candidate.split(/[\/,;]| and | & /i).map(compact).filter(Boolean);
  const spaced = ` ${genreKey(candidate)} `;
  const similar = existing.filter((e) => { const k = compact(e); return k && (parts.includes(k) || spaced.includes(` ${genreKey(e)} `)); });
  return similar.length ? { kind: 'similar', candidates: similar } : { kind: 'new' };
}

export interface GenreHolder { id: string; genres: string[] }

/** The genre lists after every name in `from` is replaced by `into` (case-insensitively, without duplicates). Only changed holders are returned. */
export function planGenreMerge(holders: GenreHolder[], from: string[], into: string): { id: string; genres: string[] }[] {
  const gone = new Set(from.map((f) => f.toLowerCase()));
  gone.delete(into.toLowerCase());
  const out: { id: string; genres: string[] }[] = [];
  for (const h of holders) {
    if (!h.genres.some((g) => gone.has(g.toLowerCase()))) continue;
    const next: string[] = [];
    for (const g of h.genres) { const v = gone.has(g.toLowerCase()) ? into : g; if (!next.some((n) => n.toLowerCase() === v.toLowerCase())) next.push(v); }
    out.push({ id: h.id, genres: next });
  }
  return out;
}
