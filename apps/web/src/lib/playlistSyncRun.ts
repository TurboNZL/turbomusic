import type { PlaylistData } from '@turbomusic/core';
import { getLibrary } from './derive.ts';
import { logJournal } from './journal.ts';
import { planSync, urisFor, type SyncMode, type SyncPlan } from './playlistSync.ts';
import { createFromPlan } from './spotifyCreate.ts';
import { withLink } from './spotifyLinks.ts';
import { planImport } from './spotifyImport.ts';
import { trackMatcher } from './listens.ts';
import { api, useStore } from './store.ts';

export interface SyncResult {
  addedHere: number; removedHere: number; addedThere: number; removedThere: number;
  /** tracks that were not in the library and have been made (each in an album waiting for a YouTube link) */
  created: number; albumsMade: number;
  /** tracks of this playlist that have no Spotify link, so they stay here only */
  unsynced: number;
  upToDate: boolean;
}

const sum = (p: SyncPlan, created: number, albumsMade: number): SyncResult => ({
  addedHere: p.pull.added, removedHere: p.pull.removed, addedThere: p.push.added, removedThere: p.push.removed,
  created, albumsMade, unsynced: p.unsynced.length, upToDate: !p.changesLocal && !p.changesRemote,
});

/** What a sync would do, without doing it (reads the Spotify playlist). */
export async function previewSync(playlistId: string, mode?: SyncMode): Promise<SyncPlan> {
  const lib = getLibrary();
  const pl = lib.playlists.find((p) => p.id === playlistId);
  if (!pl?.spotify) throw new Error('This playlist is not linked to a Spotify playlist.');
  const remote = await api().spotifyPlaylist(pl.spotify.id);
  return planSync(lib, pl, remote.tracks, mode);
}

/**
 * Bring a linked playlist and its Spotify twin in step: changes are sent to Spotify first (if that fails nothing here changes), then
 * the local list is updated, creating the tracks Spotify has that the library does not. Remembers what both held for the next time.
 */
export async function syncPlaylist(playlistId: string, mode?: SyncMode): Promise<SyncResult> {
  const lib = getLibrary();
  const pl = lib.playlists.find((p) => p.id === playlistId);
  if (!pl?.spotify) throw new Error('This playlist is not linked to a Spotify playlist.');
  const link = pl.spotify;
  const remote = await api().spotifyPlaylist(link.id);
  const plan = planSync(lib, pl, remote.tracks, mode);
  const { put, patch } = useStore.getState();
  if (plan.changesRemote) await api().spotifySetPlaylistTracks(link.id, plan.remote);

  // tracks the library has under another Spotify track (a single vs the album version) learn the new link
  const match = trackMatcher(lib);
  for (const t of remote.tracks) {
    const id = match(t.uri, t.title, t.artists[0] ?? '');
    const have = id ? lib.trackById.get(id) : undefined;
    const more = have && withLink(have, `https://open.spotify.com/track/${t.id}`);
    if (more && id) patch('tracks', id, more);
  }
  let created = 0, albumsMade = 0;
  const made = new Map<string, string>();
  if (plan.create.length) {
    const ip = planImport(lib, { kind: 'playlist', name: pl.name, description: null, cover: null, owner: null, source: 'api', tracks: plan.create });
    const r = createFromPlan(lib, ip, { put, patch }, { makeAlbums: true });
    for (const [uri, id] of r.trackIdOf) made.set(`uri:${uri}`, id);
    created = r.tracksMade; albumsMade = r.albumsMade;
  }
  const ids = plan.local.map((k) => (k.startsWith('uri:') ? made.get(k) : k)).filter((x): x is string => !!x);
  const spotify: NonNullable<PlaylistData['spotify']> = { ...link, syncedAt: Date.now(), base: plan.remote };
  patch('playlists', playlistId, { trackIds: ids, spotify });
  const res = sum(plan, created, albumsMade);
  if (!res.upToDate) logJournal('edit', `Synced “${pl.name}” with Spotify`, `${res.addedHere} added here, ${res.addedThere} added on Spotify`, playlistId);
  return res;
}

/** Tie a playlist to a Spotify playlist that exists, then do the first sync (a union of both). */
export async function linkToSpotify(playlistId: string, spotifyId: string, mode: SyncMode = 'both'): Promise<SyncResult> {
  useStore.getState().patch('playlists', playlistId, { spotify: { id: spotifyId, mode, syncedAt: 0, base: [] } });
  return syncPlaylist(playlistId);
}

/** Make a new private Spotify playlist from a TurboMusic one (tracks with a Spotify link) and tie the two together. */
export async function createOnSpotify(playlistId: string, mode: SyncMode = 'both'): Promise<{ url: string; skipped: number }> {
  const lib = getLibrary();
  const pl = lib.playlists.find((p) => p.id === playlistId);
  if (!pl) throw new Error('Playlist not found.');
  const uris = urisFor(lib, pl.trackIds);
  const made = await api().spotifyCreatePlaylist(pl.name, pl.description ?? '', uris);
  useStore.getState().patch('playlists', playlistId, { spotify: { id: made.id, mode, syncedAt: Date.now(), base: uris } });
  return { url: made.url, skipped: pl.trackIds.length - uris.length };
}

/** Add the tracks of other playlists to one (each track once, the target's order first, notes kept), optionally deleting the others. */
export function mergePlaylists(targetId: string, sourceIds: string[], deleteSources: boolean): { added: number } {
  const lib = getLibrary();
  const target = lib.playlists.find((p) => p.id === targetId);
  const sources = sourceIds.flatMap((id) => lib.playlists.find((p) => p.id === id) ?? []).filter((p) => p.id !== targetId);
  if (!target || !sources.length) return { added: 0 };
  const have = new Set(target.trackIds);
  const trackIds = [...target.trackIds];
  const notes: Record<string, string> = { ...(target.trackNotes ?? {}) };
  for (const s of sources) {
    for (const id of s.trackIds) if (!have.has(id) && lib.trackById.has(id)) { have.add(id); trackIds.push(id); }
    for (const [k, v] of Object.entries(s.trackNotes ?? {})) if (have.has(k) && !notes[k]) notes[k] = v;
  }
  const { patch, remove } = useStore.getState();
  patch('playlists', targetId, { trackIds, ...(Object.keys(notes).length ? { trackNotes: notes } : {}) });
  if (deleteSources) for (const s of sources) remove('playlists', s.id);
  logJournal('edit', `Merged ${sources.length} playlist${sources.length === 1 ? '' : 's'} into “${target.name}”`, sources.map((s) => s.name).join(', '), targetId);
  return { added: trackIds.length - target.trackIds.length };
}

/** Forget the tie; both playlists stay as they are. */
export function unlinkFromSpotify(playlistId: string) {
  const { patch } = useStore.getState();
  patch('playlists', playlistId, { spotify: undefined });
}
