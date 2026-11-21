import { canonicalPlatform } from './legacyNames.ts';
import { allSpotifyIds } from './spotifyLinks.ts';
import type { Library } from './library.ts';
import { spotifyTrackId } from './spotify.ts';

/** One play, from TurboMusic's own player or imported from Spotify, with the track resolved to the library when it can be. */
export interface Listen {
  id: string;
  /** when it ended, ms */
  ts: number;
  /** how long it was heard, ms */
  ms: number;
  /** the library track, if there is one */
  trackId: string | null;
  /** the library's main artist and album of that track (for links to their stats pages), when matched */
  artistId: string | null;
  albumId: string | null;
  title: string;
  /** the main artist (first lead for library tracks, Spotify's album artist otherwise) */
  artist: string;
  album: string;
  uri: string | null;
  skipped: boolean;
  /** the track's length in seconds, when the play recorded it */
  length?: number | null;
  /** the silent mirror streamed it on Spotify too */
  mirrored?: boolean;
  /** found by the server's automatic check of Spotify's recently played (no exact length) */
  viaApi?: boolean;
  shuffle: boolean | null;
  platform: string | null;
  reasonEnd: string | null;
  source: 'spotify' | 'turbomusic';
}

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();

/** Which library tracks a Spotify play belongs to: by the track's Spotify link first, then by title and main artist. */
export function trackMatcher(lib: Library) {
  const byId = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const t of lib.tracks) {
    for (const id of allSpotifyIds(t)) if (!byId.has(id)) byId.set(id, t.id); // a song's single and album versions are different Spotify tracks
    const key = `${norm(t.title)}|${norm(t.leads[0]?.name ?? t.artistName)}`;
    if (!byName.has(key)) byName.set(key, t.id);
  }
  return (uri: string | null | undefined, name: string, artist: string): string | null =>
    (uri && byId.get(spotifyTrackId(uri) ?? '')) || byName.get(`${norm(name)}|${norm(artist)}`) || null;
}

/** Plays per track (TurboMusic's own and imported Spotify plays; skips are not plays). */
export function playCounts(lib: Library): Map<string, number> {
  const out = new Map<string, number>();
  for (const l of buildListens(lib)) if (l.trackId && !l.skipped) out.set(l.trackId, (out.get(l.trackId) ?? 0) + 1);
  return out;
}

const cache = new WeakMap<Library, Listen[]>();

/** Every play, oldest first. Cached per library snapshot. */
export function buildListens(lib: Library): Listen[] {
  const hit = cache.get(lib);
  if (hit) return hit;
  const match = trackMatcher(lib);
  const out: Listen[] = [];
  for (const l of lib.logs) {
    if (l.imported === 'spotify') {
      const trackId = l.trackId || match(l.uri, l.name ?? '', l.artist ?? '');
      const t = trackId ? lib.trackById.get(trackId) : undefined;
      out.push({ id: l.id, ts: l.timestamp, ms: Math.round((l.duration ?? 0) * 1000), trackId: t?.id ?? null, artistId: t?.leads[0]?.id ?? null, albumId: t?.albumId ?? null, title: t?.title ?? l.name ?? '', artist: t ? (t.leads[0]?.name ?? t.artistName) : l.artist ?? '',
        album: t?.albumTitle ?? l.album ?? '', uri: l.uri ?? null, skipped: !!l.isSkip, shuffle: l.shuffle ?? null, platform: canonicalPlatform(l.platform), reasonEnd: l.reasonEnd ?? null, source: 'spotify', ...(l.via === 'api' ? { viaApi: true } : {}) });
    } else {
      const t = lib.trackById.get(l.trackId);
      if (!t) continue;
      out.push({ id: l.id, ts: l.timestamp, ms: Math.round((l.duration ?? 0) * 1000), trackId: t.id, artistId: t.leads[0]?.id ?? null, albumId: t.albumId ?? null, title: t.title, artist: t.leads[0]?.name ?? t.artistName, album: t.albumTitle ?? '',
        uri: spotifyTrackId(t.spotifyUrl) ? `spotify:track:${spotifyTrackId(t.spotifyUrl)}` : null, skipped: !!l.isSkip, length: l.length ?? null, ...(l.mirrored ? { mirrored: true } : {}), shuffle: null, platform: 'TurboMusic', reasonEnd: null, source: 'turbomusic' });
    }
  }
  out.sort((a, b) => a.ts - b.ts);
  const merged = dropApiTwins(dropMirrorTwins(out));
  cache.set(lib, merged);
  return merged;
}

/**
 * Once Spotify's own history is imported it holds the plays the silent mirror made, so the TurboMusic play that the mirror accompanied
 * (flagged `mirrored`) and an imported play of the same track ending within three minutes of it are one play: the import wins (it is
 * Spotify's own record), the TurboMusic row is dropped. Without an import the mirrored plays count as the TurboMusic plays they are.
 */
export function dropMirrorTwins(listens: Listen[]): Listen[] {
  const spotify = new Map<string, number[]>();
  for (const l of listens) if (l.source === 'spotify' && l.trackId) spotify.set(l.trackId, [...(spotify.get(l.trackId) ?? []), l.ts]);
  if (!spotify.size) return listens;
  return listens.filter((l) => !(l.mirrored && l.trackId && (spotify.get(l.trackId) ?? []).some((ts) => Math.abs(ts - l.ts) <= 180_000)));
}

/**
 * The server's automatic check of Spotify's recently played (`viaApi`) sees plays that are also somewhere better: in an export file
 * (it has the real length), or in TurboMusic's own log (the song was played here through Spotify). An API play with the same song
 * ending within five minutes of one of those is the same play and is dropped; the rest are new plays, kept.
 */
export function dropApiTwins(listens: Listen[]): Listen[] {
  if (!listens.some((l) => l.viaApi)) return listens;
  const keyOf = (l: Listen) => l.trackId ?? l.uri ?? `${norm(l.title)}|${norm(l.artist)}`;
  const better = new Map<string, number[]>();
  for (const l of listens) if (!l.viaApi) { const k = keyOf(l); (better.get(k) ?? better.set(k, []).get(k)!).push(l.ts); }
  return listens.filter((l) => !(l.viaApi && (better.get(keyOf(l)) ?? []).some((ts) => Math.abs(ts - l.ts) <= 300_000)));
}

/**
 * Plays of a tied pre-release version counted as plays of the released track (its title, artist and album replace the "[U]" version's).
 * Without this each pre-release is its own entry in the stats, marked "[U]".
 */
export function combinePreReleases(lib: Library, listens: Listen[]): Listen[] {
  if (!lib.preReleases.length) return listens;
  return listens.map((l) => {
    const pre = l.trackId ? lib.trackById.get(l.trackId) : undefined;
    const t = pre?.preReleaseOf ? lib.trackById.get(pre.preReleaseOf) : undefined;
    if (!t) return l;
    return { ...l, trackId: t.id, artistId: t.leads[0]?.id ?? null, albumId: t.albumId ?? null, title: t.title, artist: t.leads[0]?.name ?? t.artistName, album: t.albumTitle ?? '' };
  });
}
