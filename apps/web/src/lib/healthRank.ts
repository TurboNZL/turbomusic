import type { Library } from './library.ts';
import type { HealthItem } from './health.ts';
import { playCounts } from './listens.ts';

/**
 * How much a problem matters: what you play and rate highly comes first, so fixing the top of a list helps most.
 * A track scores by its rating and how often it was played; an album or release by its best song and its plays; an artist by their plays.
 * Things with no usage data (genres, roles) score 0 and keep alphabetical order.
 */
export function healthScores(lib: Library, items: HealthItem[]): Map<string, number> {
  const plays = playCounts(lib);
  const trackScore = (id: string) => { const t = lib.trackById.get(id); return t ? (t.effectiveRating || 5) * 0.5 + Math.log1p(plays.get(id) ?? 0) * 2 : 0; };
  const albumScore = (albumId: string | undefined | null) => {
    const a = albumId ? lib.albumById.get(albumId) : undefined;
    if (!a) return 0;
    let best = 0, total = 0;
    for (const id of a.trackIds) { best = Math.max(best, trackScore(id)); total += plays.get(id) ?? 0; }
    return best + Math.log1p(total);
  };
  let artistPlays: Map<string, number> | null = null;
  const artistScore = (id: string) => {
    if (!artistPlays) { artistPlays = new Map(); for (const t of lib.tracks) { const n = plays.get(t.id) ?? 0; if (n) for (const l of t.leads) artistPlays.set(l.id, (artistPlays.get(l.id) ?? 0) + n); } }
    return Math.log1p(artistPlays.get(id) ?? 0) * 2;
  };
  const out = new Map<string, number>();
  for (const i of items) {
    const key = `${i.kind}:${i.id}`;
    out.set(key, i.kind === 'track' ? trackScore(i.id) : i.kind === 'album' || i.kind === 'album-source' ? albumScore(i.id) : i.kind === 'release' ? albumScore(lib.releases.find((r) => r.id === i.id)?.albumId) : i.kind === 'artist' ? artistScore(i.id) : 0);
  }
  return out;
}

/** Sort a check's items by relevance (groups of duplicates stay together, ordered by their most relevant member) and keep those matching the search words. */
export function rankHealthItems(lib: Library, items: HealthItem[], search: string): HealthItem[] {
  const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const kept = words.length ? items.filter((i) => { const hay = `${i.label} ${i.detail ?? ''} ${i.note ?? ''}`.toLowerCase(); return words.every((w) => hay.includes(w)); }) : items;
  const score = healthScores(lib, kept);
  const of = (i: HealthItem) => score.get(`${i.kind}:${i.id}`) ?? 0;
  const groupBest = new Map<string, number>();
  for (const i of kept) if (i.group !== undefined) groupBest.set(i.group, Math.max(groupBest.get(i.group) ?? -1, of(i)));
  const rank = (i: HealthItem) => (i.group !== undefined ? groupBest.get(i.group)! : of(i));
  return [...kept].sort((a, b) => rank(b) - rank(a) || (a.group ?? '').localeCompare(b.group ?? '') || of(b) - of(a) || a.label.localeCompare(b.label));
}
