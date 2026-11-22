import type { SpotifyImportTrack, SpotifyList } from './api.ts';
import type { Library } from './library.ts';
import type { Listen } from './listens.ts';
import { spotifyTrackId } from './spotify.ts';

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export interface HistoryCandidates { list: SpotifyList; artists: number; tracks: number; plays: number }

/**
 * The songs in your listening history that the library has no entry for, as a Spotify list (so the Spotify import code can make them):
 * only for artists you played at least `minPlays` times (otherwise a long history would make thousands of one-play entries). Each song
 * keeps its Spotify link and album name; they are made as "not imported yet" and stay out of the lists until you show them or import them.
 */
export function historyCandidates(lib: Library, listens: Listen[], minPlays: number): HistoryCandidates {
  void lib;
  const byUri = new Map<string, { l: Listen; plays: number }>();
  for (const l of listens) {
    if (l.trackId || l.skipped || l.source !== 'spotify' || !l.uri || !l.title || !l.artist) continue;
    const e = byUri.get(l.uri); if (e) e.plays++; else byUri.set(l.uri, { l, plays: 1 });
  }
  const artistPlays = new Map<string, number>();
  for (const { l, plays } of byUri.values()) artistPlays.set(norm(l.artist), (artistPlays.get(norm(l.artist)) ?? 0) + plays);
  const tracks: SpotifyImportTrack[] = [];
  let plays = 0;
  const artists = new Set<string>();
  for (const [uri, { l, plays: n }] of byUri) {
    if ((artistPlays.get(norm(l.artist)) ?? 0) < minPlays) continue;
    const id = spotifyTrackId(uri); if (!id) continue;
    tracks.push({ uri: `spotify:track:${id}`, id, title: l.title, artists: [l.artist], album: l.album, albumUri: null, albumArtist: l.artist, durationMs: null, cover: null, releaseDate: null, trackNumber: null, isrc: null });
    artists.add(norm(l.artist)); plays += n;
  }
  return { list: { kind: 'playlist', name: 'Listening history', description: null, cover: null, owner: null, tracks, source: 'file' }, artists: artists.size, tracks: tracks.length, plays };
}
