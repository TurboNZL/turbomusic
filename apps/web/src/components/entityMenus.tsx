import { useNavigate } from 'react-router-dom';
import { leaveRemoved } from '../lib/leave.ts';
import { isQuickPlaylist, playlistTrackIds } from '../lib/playlists.ts';
import { canPlay } from '../lib/spotifyPlayer.ts';
import { readShuffle, writeShuffle } from './PlayControls.tsx';
import { openImportIntoAlbum } from '../lib/openImport.ts';
import { statsPath } from '../lib/entityStats.ts';
import { YouTubeMusicIcon } from './BrandIcons.tsx';
import { ListOrdered, FolderInput, PackagePlus, RotateCcw, GitMerge, BarChart3, Disc, Download, FileAudio, ListEnd, ListMusic, ListPlus, ListStart, Pencil, Replace, Play, Plus, Shuffle, User, Layers, Search, Check, Eye, EyeOff, Trash2, Vault } from 'lucide-react';
import { shuffleWithRules } from '@turbomusic/core';
import { useLibrary, type Library } from '../lib/derive.ts';
import { useEditor } from '../lib/editor.ts';
import { usePlayer } from '../lib/player.ts';
import { planConvertToSingle } from '../lib/albumOps.ts';
import { eraPatches } from '../lib/eraOps.ts';
import { useStore } from '../lib/store.ts';
import { group, type MenuItem } from './Menu.tsx';

/** What a menu does to a list of tracks: play it, shuffle it (with the playback rules), queue it. */
export function useTrackListActions() {
  const lib = useLibrary();
  const play = usePlayer((s) => s.play);
  const enqueue = usePlayer((s) => s.enqueue);
  const replaceRest = usePlayer((s) => s.replaceRest);
  const appendRest = usePlayer((s) => s.appendRest);
  const hasCurrent = usePlayer((s) => !!s.queue.currentId);
  return (ids: string[], source: Parameters<typeof play>[2], label?: string): MenuItem[] => {
    const playable = ids.filter((id) => canPlay(lib.trackById.get(id)));
    const none = !playable.length;
    // the one Shuffle switch (the same one the Play button on playlists and artists uses): Play, Play next and Add to queue all follow it
    const ordered = () => (readShuffle() ? shuffleWithRules(playable, lib.rules) : playable);
    return [
      { label: 'Play', icon: <Play size={15} />, run: () => { const o = ordered(); play(o[0], o, source); }, disabled: none },
      { label: 'Shuffle', icon: <Shuffle size={15} />, checked: readShuffle(), keepOpen: true, run: () => writeShuffle(!readShuffle()) },
      // everything about what plays after: one hover menu, pressing the row adds the list to the queue
      ...group('Queue', <ListEnd size={15} />, [
        { label: () => (readShuffle() ? 'Add to queue (shuffled)' : 'Add to queue'), icon: <ListEnd size={15} />, run: () => ordered().forEach((id) => enqueue(id, 'last', label)), disabled: none } as MenuItem,
        // each goes right after the one before it, so "next" keeps the order (the shuffled order when Shuffle is on)
        { label: () => (readShuffle() ? 'Play next (shuffled)' : 'Play next'), icon: <ListStart size={15} />, run: () => [...ordered()].reverse().forEach((id) => enqueue(id, 'next', label)), disabled: none } as MenuItem,
        // only while something is playing: the lineup is what comes after it
        ...(hasCurrent ? [
          { label: () => (readShuffle() ? 'Replace lineup (shuffled)' : 'Replace lineup'), icon: <Replace size={15} />, run: () => replaceRest(ordered(), source), disabled: none } as MenuItem,
          { label: () => (readShuffle() ? 'Add to lineup (shuffled)' : 'Add to lineup'), icon: <ListPlus size={15} />, run: () => appendRest(ordered()), disabled: none } as MenuItem,
        ] : []),
      ]),
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
  return (album: Album, ids: string[] = album.trackIds, full = false): MenuItem[] => [
    ...actions(ids, { type: 'album', id: album.id }, album.title),
    { separator: true },
    { label: 'Stats page', icon: <BarChart3 size={15} />, to: statsPath('album', album.id) },
    { label: 'Edit album…', icon: <Pencil size={15} />, run: () => edit({ kind: 'album', id: album.id }) },
    (album as { vault?: boolean }).vault
      ? { label: 'Not from the vault after all', icon: <Vault size={15} />, run: () => patch('albums', album.id, { vault: false }) }
      : { label: 'Mark as from the vault', icon: <Vault size={15} />, run: () => patch('albums', album.id, { vault: true }) },
    ...(album.trackIds.length > 1 ? [{ label: 'Order its songs by preference…', icon: <ListOrdered size={15} />, to: `/order/${album.id}` } as MenuItem] : []),
    { label: 'Add to an album playlist…', icon: <ListMusic size={15} />, run: () => edit({ kind: 'add-album-to-playlist', id: album.id }) },
    ...group('Import and merge', <YouTubeMusicIcon size={15} />, [
      { label: 'Import a release from YouTube Music…', icon: <YouTubeMusicIcon size={15} />, run: () => void openImportIntoAlbum(album.id), keepOpen: true },
      ...(full && lib.releases.filter((r) => r.albumId === album.id).length === 1 ? [{ label: 'Add to another album…', icon: <FolderInput size={15} />, run: () => edit({ kind: 'merge-album', id: album.id }) }] : []),
      { label: 'Re-read credits from YouTube Music…', icon: <YouTubeMusicIcon size={15} />, run: () => edit({ kind: 'reparse-credits', id: album.id }) },
      { label: 'Fix artists from a pasted list…', icon: <User size={15} />, run: () => edit({ kind: 'paste-credits', id: album.id }) },
      { label: 'Merge with another album…', icon: <GitMerge size={15} />, run: () => edit({ kind: 'merge-with', id: `album:${album.id}` }) },
      ...(full && planConvertToSingle(lib, album) ? [{ label: 'Convert to a single…', icon: <Disc size={15} />, run: () => convert(album) }] : []),
    ]),
    ...(full ? group('Files and status', <FileAudio size={15} />, [
      { label: 'Add audio files…', icon: <FileAudio size={15} />, run: () => edit({ kind: 'upload', id: album.id }) } as MenuItem,
      { label: 'New release…', icon: <PackagePlus size={15} />, run: () => edit({ kind: 'new-release', id: album.id }) } as MenuItem,
      (album as { complete?: boolean }).complete
        ? { label: 'Suggest a YouTube Music link for it again', icon: <RotateCcw size={15} />, run: () => patch('albums', album.id, { complete: false }) }
        : { label: 'Stop suggesting a YouTube Music link for it', icon: <Check size={15} />, run: () => patch('albums', album.id, { complete: true }) },
      (album as { hidden?: boolean }).hidden
        ? { label: 'Show this album again', icon: <Eye size={15} />, run: () => patch('albums', album.id, { hidden: false }) }
        : { label: 'Hide this album', icon: <EyeOff size={15} />, run: () => patch('albums', album.id, { hidden: true }) },
      (album as { noYoutube?: boolean }).noYoutube
        ? { label: 'Has a YouTube Music link after all', icon: <YouTubeMusicIcon size={15} />, run: () => patch('albums', album.id, { noYoutube: false }) }
        : { label: 'Not on YouTube Music', icon: <EyeOff size={15} />, run: () => patch('albums', album.id, { noYoutube: true }) },
      { label: 'Delete album…', icon: <Trash2 size={15} />, run: () => edit({ kind: 'delete-album', id: album.id }) } as MenuItem,
    ]) : []),
    ...group('Go to', <User size={15} />, [
      ...album.leads.map((l) => ({ label: `Go to ${l.name}`, icon: <User size={15} />, to: `/artists/${l.id}` })),
      ...(full ? album.eraIds.flatMap((e) => lib.eraById.get(e) ?? []).map((e) => ({ label: `Go to ${e.name}`, icon: <Layers size={15} />, to: `/eras/${e.id}` })) : []),
    ]),
  ];
}

/** The menu of an artist: everything they are credited on. */
export function useArtistMenuItems() {
  const lib = useLibrary();
  const patch = useStore((s) => s.patch);
  const edit = useEditor((s) => s.open);
  const actions = useTrackListActions();
  const replaceRest = usePlayer((s) => s.replaceRest);
  const appendRest = usePlayer((s) => s.appendRest);
  const hasCurrent = usePlayer((s) => !!s.queue.currentId);
  return (artistId: string): MenuItem[] => {
    const ids = lib.tracks.filter((t) => t.credits.some((c) => c.artistId === artistId)).sort((a, b) => b.effectiveRating - a.effectiveRating).map((t) => t.id);
    const playable = ids.filter((id) => canPlay(lib.trackById.get(id)));
    return [
      ...actions(ids, { type: 'search', id: `Artist: ${lib.artistById.get(artistId)?.name ?? ''}` }, lib.artistById.get(artistId)?.name),
      { separator: true },
      { label: 'Stats page', icon: <BarChart3 size={15} />, to: statsPath('artist', artistId) },
      { label: 'Edit artist…', icon: <Pencil size={15} />, run: () => edit({ kind: 'artist', id: artistId }) },
      (lib.artistById.get(artistId) as { hidden?: boolean } | undefined)?.hidden
        ? { label: 'Show this artist again', icon: <Eye size={15} />, run: () => patch('artists', artistId, { hidden: false }) }
        : { label: 'Hide this artist', icon: <EyeOff size={15} />, run: () => patch('artists', artistId, { hidden: true }) },
      { label: 'Merge with another artist…', icon: <GitMerge size={15} />, run: () => edit({ kind: 'merge-with', id: `artist:${artistId}` }) },
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
      ...actions(playlistTrackIds(lib, playlist), source, playlist.name),
      ...(isQuickPlaylist(playlist.id) ? [] : [
        { separator: true } as MenuItem,
        { label: 'Stats page', icon: <BarChart3 size={15} />, to: statsPath('playlist', playlist.id) },
        { label: 'Edit playlist…', icon: <Pencil size={15} />, run: () => edit({ kind: 'playlist', id: playlist.id }) },
        ...(playlist.kind === 'albums' ? [] : group('Merge', <GitMerge size={15} />, [
          { label: 'Merge other playlists into this…', icon: <GitMerge size={15} />, run: () => edit({ kind: 'merge-playlist', id: `into:${playlist.id}` }) } as MenuItem,
          { label: playlist.spotify ? 'Merge into another playlist…' : 'Merge into a synced playlist…', icon: <GitMerge size={15} />, run: () => edit({ kind: 'merge-playlist', id: `from:${playlist.id}` }) } as MenuItem,
        ])),
      ]),
    ];
  };
}
