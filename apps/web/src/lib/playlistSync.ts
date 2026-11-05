import type { PlaylistData } from '@turbomusic/core';
import type { SpotifyImportTrack } from './api.ts';
import type { Library } from './library.ts';
import { trackMatcher } from './listens.ts';
import { allSpotifyIds } from './spotifyLinks.ts';
import { spotifyTrackId } from './spotify.ts';

/**
 * Keeping a TurboMusic playlist and a Spotify playlist in step. A three-way merge: `base` is what both held at the last sync, so a
 * track that disappeared from one side is a removal (and goes from the other too), while a track only one side has is an addition.
 * Pure; `planSync` says what would happen, the caller does it. Order follows the playlist here; tracks new from Spotify go at the end.
 */
export type SyncMode = 'both' | 'from-spotify' | 'to-spotify';
export type Link = NonNullable<PlaylistData['spotify']>;

export interface SyncPlan {
  /** the playlist afterwards: track ids, with `uri:<spotify uri>` for a Spotify track the library does not have yet */
  local: string[];
  /** what Spotify holds afterwards (track URIs); tracks with no Spotify link cannot be there */
  remote: string[];
  /** Spotify tracks the library does not have, to be made before the local list can point at them */
  create: SpotifyImportTrack[];
  /** local tracks that have no Spotify link, so they stay here only */
  unsynced: string[];
  pull: { added: number; removed: number };
  push: { added: number; removed: number };
  changesLocal: boolean; changesRemote: boolean;
}

export const uriOf = (id: string) => `spotify:track:${id}`;
const uniq = <T,>(xs: T[]) => [...new Set(xs)];

export function planSync(lib: Library, playlist: Pick<PlaylistData, 'trackIds' | 'spotify'>, remote: SpotifyImportTrack[], modeOverride?: SyncMode): SyncPlan {
  const mode = modeOverride ?? playlist.spotify?.mode ?? 'both';
  const match = trackMatcher(lib);
  // an entry is a library track when we know it, else the Spotify track itself
  const keyOfRemote = (t: SpotifyImportTrack) => match(t.uri, t.title, t.artists[0] ?? '') ?? `uri:${t.uri}`;
  const remoteKey = new Map(remote.map((t) => [t.uri, keyOfRemote(t)] as const));
  const keyOfUri = (u: string) => remoteKey.get(u) ?? match(u, '', '') ?? `uri:${u}`;
  const urlOf = new Map<string, string>(); // entry -> the Spotify URI it is sent as
  const L = uniq(playlist.trackIds.filter((id) => lib.trackById.has(id)));
  const unsynced: string[] = [];
  for (const id of L) {
    const ids = allSpotifyIds(lib.trackById.get(id));
    if (ids.length) urlOf.set(id, uriOf(ids[0])); else unsynced.push(id);
  }
  const R = uniq(remote.map(keyOfRemote));
  for (const t of remote) { const k = keyOfRemote(t); if (!urlOf.has(k)) urlOf.set(k, t.uri); }
  // a library track on both sides may be linked to several Spotify tracks; send the one Spotify already has
  for (const t of remote) { const k = keyOfRemote(t); if (!k.startsWith('uri:')) urlOf.set(k, t.uri); }
  const B = uniq((playlist.spotify?.base ?? []).map(keyOfUri));
  const sL = new Set(L), sR = new Set(R), sB = new Set(B);
  const first = !playlist.spotify || !playlist.spotify.syncedAt;

  let keys: string[];
  if (mode === 'from-spotify') keys = [...R, ...L.filter((k) => unsynced.includes(k))];
  else if (mode === 'to-spotify') keys = L;
  else {
    const removedL = new Set(B.filter((k) => !sL.has(k))), removedR = new Set(B.filter((k) => !sR.has(k)));
    keys = [...L.filter((k) => !removedR.has(k)), ...R.filter((k) => !sL.has(k) && !removedL.has(k))];
    if (first) keys = [...L, ...R.filter((k) => !sL.has(k))];
  }
  keys = uniq(keys);
  const sendable = keys.filter((k) => urlOf.has(k) && !unsynced.includes(k));
  const remoteAfter = mode === 'from-spotify' ? R.map((k) => urlOf.get(k)!) : sendable.map((k) => urlOf.get(k)!);
  const remoteNow = R.map((k) => urlOf.get(k)!);
  const create: SpotifyImportTrack[] = [];
  const seen = new Set<string>();
  for (const k of keys) if (k.startsWith('uri:') && !seen.has(k)) { seen.add(k); const t = remote.find((r) => `uri:${r.uri}` === k); if (t) create.push(t); }
  const diff = (a: string[], b: string[]) => ({ added: b.filter((x) => !a.includes(x)).length, removed: a.filter((x) => !b.includes(x)).length });
  const pull = diff(L, keys);
  const push = mode === 'from-spotify' ? { added: 0, removed: 0 } : diff(remoteNow, remoteAfter);
  return {
    local: keys, remote: remoteAfter, create, unsynced, pull, push,
    changesLocal: pull.added + pull.removed > 0 || keys.some((k, i) => k !== L[i]),
    changesRemote: mode !== 'from-spotify' && (push.added + push.removed > 0 || remoteAfter.some((u, i) => u !== remoteNow[i])),
  };
}

/** Does this playlist have anything that could be sent to Spotify? */
export const sendable = (lib: Library, trackIds: string[]) => trackIds.filter((id) => allSpotifyIds(lib.trackById.get(id)).length > 0);

/** The URIs of the library tracks in the playlist that Spotify can have, in order (used to make a new Spotify playlist from a TurboMusic one). */
export const urisFor = (lib: Library, trackIds: string[]) => uniq(trackIds.flatMap((id) => { const s = allSpotifyIds(lib.trackById.get(id)); return s.length ? [uriOf(s[0])] : []; }));

export { spotifyTrackId };

/**
 * A synced playlist's songs in two lists: those that are (or will be) on the Spotify side, and those that cannot be, which the page shows
 * apart below. A song cannot be on Spotify when it has no Spotify link; and when changes only come FROM Spotify, a song that Spotify's playlist
 * did not have at the last sync stays here only.
 */
export function splitSynced(lib: Library, playlist: Pick<PlaylistData, 'trackIds' | 'spotify'>): { onSpotify: string[]; localOnly: string[] } {
  const mode = playlist.spotify?.mode ?? 'both';
  const base = new Set((playlist.spotify?.base ?? []).map((u) => spotifyTrackId(u)).filter((x): x is string => !!x));
  const onSpotify: string[] = [], localOnly: string[] = [];
  for (const id of playlist.trackIds) {
    const t = lib.trackById.get(id);
    if (!t) continue;
    const ids = allSpotifyIds(t);
    const there = ids.length > 0 && (mode !== 'from-spotify' || ids.some((i) => base.has(i)));
    (there ? onSpotify : localOnly).push(id);
  }
  return { onSpotify, localOnly };
}
