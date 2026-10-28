import { useNavigate } from 'react-router-dom';
import { leaveRemoved } from '../lib/leave.ts';
import { isQuickPlaylist, playlistTrackIds } from '../lib/playlists.ts';
import { canPlay } from '../lib/spotifyPlayer.ts';
import { statsPath } from '../lib/entityStats.ts';
import { GitMerge, BarChart3, Disc, Download, FileAudio, ListEnd, ListPlus, ListStart, Pencil, Play, Plus, Shuffle, User, Layers, Search } from 'lucide-react';
import { shuffleWithRules } from '@turbomusic/core';
import { useLibrary, type Library } from '../lib/derive.ts';
import { useEditor } from '../lib/editor.ts';
import { usePlayer } from '../lib/player.ts';
import { planConvertToSingle } from '../lib/albumOps.ts';
import { eraPatches } from '../lib/eraOps.ts';
import { useStore } from '../lib/store.ts';
import type { MenuItem } from './Menu.tsx';

/** What a menu does to a list of tracks: play it, shuffle it (with the playback rules), queue it. */
function useTrackListActions() {
  const lib = useLibrary();
  const play = usePlayer((s) => s.play);
  const enqueue = usePlayer((s) => s.enqueue);
  return (ids: string[], source: Parameters<typeof play>[2]): MenuItem[] => {
    const playable = ids.filter((id) => canPlay(lib.trackById.get(id)));
    const none = !playable.length;
    return [
      { label: 'Play', icon: <Play size={15} />, run: () => play(playable[0], playable, source), disabled: none },
      { label: 'Shuffle', icon: <Shuffle size={15} />, run: () => { const s = shuffleWithRules(playable, lib.rules); play(s[0], s, source); }, disabled: none },
      // each goes right after the one before it, so "next" keeps the list's order
      { label: 'Play next', icon: <ListStart size={15} />, run: () => [...playable].reverse().forEach((id) => enqueue(id, 'next')), disabled: none },
      { label: 'Add to queue', icon: <ListEnd size={15} />, run: () => playable.forEach((id) => enqueue(id, 'last')), disabled: none },
    ];
  };
}

type Album = Library['albums'][number];

/** Make a one-song album a single right now (no questions). Returns the track id, or null when the album is not eligible. */
export function convertToSingleNow(lib: Library, album: Album): string | null {
  const plan = planConvertToSingle(lib, album);
  if (!plan) return null;
  const { patch, remove } = useStore.getState();
  patch('tracks', plan.trackId, plan.trackPatch);
  for (const e of eraPatches(lib, 'album', plan.removeAlbumId, [])) patch('eras', e.id, e.patch); // the album leaves its eras...
  for (const e of eraPatches(lib, 'track', plan.trackId, plan.eraIds)) patch('eras', e.id, e.patch); // ...and the single joins them
  for (const r of plan.removeReleaseIds) remove('releases', r);
  remove('albums', plan.removeAlbumId);
  return plan.trackId;
}

/** Turns an album that is really one song into a single (after asking). Returns false when the album is not eligible. */
export function useConvertToSingle() {
  const lib = useLibrary();
  const nav = useNavigate();
  return (album: Album) => {
    const plan = planConvertToSingle(lib, album);
    if (!plan) return false;
    const t = lib.trackById.get(plan.trackId)!;
    if (!confirm(`Turn “${album.title}” into a single?\n\n“${t.title}” keeps its cover, credits and genres and leaves the album. The album and its ${plan.removeReleaseIds.length} release${plan.removeReleaseIds.length === 1 ? '' : 's'} are deleted (other releases' covers are lost).`)) return true;
    const single = convertToSingleNow(lib, album);
    // the album's page is gone: the single's page replaces it (nothing happens when this was done from a list)
    leaveRemoved(nav, 'album', album.id, { to: single ? statsPath('track', single) : null, fallback: '/singles' });
    return true;
  };
}

/** The right-click / ⋯ menu of an album (cards, the album page). `ids` overrides the tracks when a release is being viewed. */
export function useAlbumMenuItems() {
  const edit = useEditor((s) => s.open);
  const actions = useTrackListActions();
  const lib = useLibrary();
  const convert = useConvertToSingle();
  const patch = useStore((s) => s.patch);
  return (album: Album, ids: string[] = album.trackIds): MenuItem[] => [
    ...actions(ids, { type: 'album', id: album.id }),
    { separator: true },
    { label: 'Stats page', icon: <BarChart3 size={15} />, to: statsPath('album', album.id) },
    { label: 'Edit album…', icon: <Pencil size={15} />, run: () => edit({ kind: 'album', id: album.id }) },
    { label: 'Add to an album playlist…', icon: <ListPlus size={15} />, run: () => edit({ kind: 'add-album-to-playlist', id: album.id }) },
    { label: 'Add audio files…', icon: <FileAudio size={15} />, run: () => edit({ kind: 'upload', id: album.id }) },
    { label: 'New release…', icon: <Plus size={15} />, run: () => edit({ kind: 'new-release', id: album.id }) },
    { label: 'Import a release from YouTube Music…', icon: <Download size={15} />, run: () => edit({ kind: 'import-into-album', id: album.id }) },
    ...(lib.releases.filter((r) => r.albumId === album.id).length === 1 ? [{ label: 'Add to another album…', icon: <GitMerge size={15} />, run: () => edit({ kind: 'merge-album', id: album.id }) }] : []),
    ...(planConvertToSingle(lib, album) ? [{ label: 'Convert to a single…', icon: <Disc size={15} />, run: () => convert(album) }] : []),
    (album as { noYoutube?: boolean }).noYoutube
      ? { label: 'Has a YouTube Music link after all', icon: <Download size={15} />, run: () => patch('albums', album.id, { noYoutube: false }) }
      : { label: 'Not on YouTube Music', icon: <Download size={15} />, run: () => patch('albums', album.id, { noYoutube: true }) },
    { separator: true },
    ...album.leads.map((l) => ({ label: `Go to ${l.name}`, icon: <User size={15} />, to: `/artists/${l.id}` })),
    ...album.eraIds.flatMap((e) => lib.eraById.get(e) ?? []).map((e) => ({ label: `Go to ${e.name}`, icon: <Layers size={15} />, to: `/eras/${e.id}` })),
  ];
}

/** The menu of an artist: everything they are credited on. */
export function useArtistMenuItems() {
  const lib = useLibrary();
  const edit = useEditor((s) => s.open);
  const actions = useTrackListActions();
  return (artistId: string): MenuItem[] => {
    const ids = lib.tracks.filter((t) => t.credits.some((c) => c.artistId === artistId)).sort((a, b) => b.effectiveRating - a.effectiveRating).map((t) => t.id);
    return [
      ...actions(ids, { type: 'search', id: null }),
      { separator: true },
      { label: 'Stats page', icon: <BarChart3 size={15} />, to: statsPath('artist', artistId) },
      { label: 'Edit artist…', icon: <Pencil size={15} />, run: () => edit({ kind: 'artist', id: artistId }) },
    ];
  };
}

/** The menu of a playlist (cards and its own page): open, play, shuffle, queue, continue-with, stats, edit. */
export function usePlaylistMenuItems() {
  const lib = useLibrary();
  const edit = useEditor((s) => s.open);
  const actions = useTrackListActions();
  const replaceRest = usePlayer((s) => s.replaceRest);
  const appendRest = usePlayer((s) => s.appendRest);
  const hasCurrent = usePlayer((s) => !!s.queue.currentId);
  return (playlist: Library['playlists'][number]): MenuItem[] => {
    const playable = playlistTrackIds(lib, playlist).filter((id) => canPlay(lib.trackById.get(id)));
    const source = { type: 'playlist' as const, id: playlist.id };
    return [
      { label: 'Open', icon: <Play size={15} />, to: `/playlists/${playlist.id}` },
      ...actions(playlistTrackIds(lib, playlist), source),
      ...(hasCurrent ? [
        { label: 'Then: replace what is coming next', icon: <ListStart size={15} />, run: () => replaceRest(playable, source), disabled: !playable.length },
        { label: 'Add to the end of what is coming next', icon: <ListEnd size={15} />, run: () => appendRest(playable), disabled: !playable.length },
      ] : []),
      ...(isQuickPlaylist(playlist.id) ? [] : [
        { separator: true } as MenuItem,
        { label: 'Stats page', icon: <BarChart3 size={15} />, to: statsPath('playlist', playlist.id) },
        { label: 'Edit playlist…', icon: <Pencil size={15} />, run: () => edit({ kind: 'playlist', id: playlist.id }) },
      ]),
    ];
  };
}
