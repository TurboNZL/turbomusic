import { statsPath } from '../lib/entityStats.ts';
import { BarChart3, Swords, Info, ListEnd, ListMusic, ListPlus, ListStart, Replace, Pencil, Play, Plus, Minus, Disc3, Disc, Vault, Brain, Flag, FolderInput, GitMerge, StickyNote, User } from 'lucide-react';
import { canPlay } from '../lib/spotifyPlayer.ts';
import type { Track } from '../lib/derive.ts';
import type { EditTarget } from '../lib/editor.ts';
import { useEditor } from '../lib/editor.ts';
import { usePlayer } from '../lib/player.ts';
import { addMemory, removeMemory } from '../lib/memories.ts';
import { trackPath } from '../lib/trackPath.ts';
import { updateProfile } from '../lib/profile.ts';
import { useStore } from '../lib/store.ts';
import { group, type MenuItem } from './Menu.tsx';
import { PlaylistFlyout } from './PlaylistFlyout.tsx';
import { useLibrary } from '../lib/derive.ts';
import { makeSingleRelease } from '../lib/singleRelease.ts';

/** The per-track menu (the old right-click menu) as menu items; shown by useMenu()/ContextMenu. */
export function useTrackMenuItems() {
  const edit = useEditor((s) => s.open);
  const patch = useStore((s) => s.patch);
  const enqueue = usePlayer((s) => s.enqueue);
  const lib = useLibrary();
  const replaceRest = usePlayer((s) => s.replaceRest);
  const appendRest = usePlayer((s) => s.appendRest);
  const hasCurrent = usePlayer((s) => !!s.queue.currentId);
  return (t: Track, onPlay: () => void): MenuItem[] => {
    const memories = t.memories ?? 0;
    const open = (target: EditTarget) => () => edit(target);
    return [
      { label: 'Play', icon: <Play size={15} />, run: onPlay, disabled: !canPlay(t) },
      // one hover menu for everything about what plays after this song: pressing the row adds it to the queue
      ...group('Queue', <ListEnd size={15} />, [
        { label: 'Add to queue', icon: <ListEnd size={15} />, run: () => enqueue(t.id, 'last'), disabled: !canPlay(t) } as MenuItem,
        { label: 'Play next', icon: <ListStart size={15} />, run: () => enqueue(t.id, 'next'), disabled: !canPlay(t) } as MenuItem,
        ...(hasCurrent ? [
          { label: 'Replace lineup', icon: <Replace size={15} />, run: () => replaceRest([t.id], { type: 'search', id: t.title }), disabled: !canPlay(t) } as MenuItem,
          { label: 'Add to lineup', icon: <ListPlus size={15} />, run: () => appendRest([t.id]), disabled: !canPlay(t) } as MenuItem,
        ] : []),
      ]),
      { label: 'Add to playlist', icon: <ListMusic size={15} />, flyout: () => <PlaylistFlyout trackId={t.id} /> },
      { counter: { label: 'Memories', icon: <Brain size={15} />, value: memories, onMinus: () => removeMemory(t.id), onPlus: () => addMemory(t.id), minusDisabled: memories < 1 } },
      ...group('Info, notes and stats', <Info size={15} />, [
        { label: 'Info', icon: <Info size={15} />, run: open({ kind: 'track-details', id: t.id }) },
        { label: 'Stats page', icon: <BarChart3 size={15} />, to: statsPath('track', t.id) },
        { label: 'Write a note…', icon: <StickyNote size={15} />, run: open({ kind: 'new-note', id: `track:${t.id}` }) },
        { label: 'Rank it against other songs…', icon: <Swords size={15} />, to: `/vote?place=${t.id}` },
      ]),
      // pressing "Go to" opens the track's own page (its album, or its stats page for a single); the arrow lists the artists too
      ...group('Go to', <Disc3 size={15} />, [
        { label: t.albumId ? 'Go to album' : 'Go to this single', icon: <Disc3 size={15} />, to: t.albumId ? trackPath(t) : statsPath('track', t.id) },
        ...t.leads.map((l) => ({ label: `Go to ${l.name}`, icon: <User size={15} />, to: `/artists/${l.id}` })),
      ]),
      ...group('Edit and organise', <Pencil size={15} />, [
        { label: 'Edit…', icon: <Pencil size={15} />, run: open({ kind: 'track', id: t.id }) },
        // a single that promoted an album joins it here once the album is out (also: a song on one album can be added to another)
        { label: t.albumId ? 'Add to another album…' : 'Add this single to an album…', icon: <FolderInput size={15} />, run: open({ kind: 'add-to-album', id: t.id }) },
        ...(t.albumId ? [{ label: 'Make a single release (looks up its date)', icon: <Disc size={15} />, run: () => { void makeSingleRelease(lib, t).then((id) => id && edit({ kind: 'release', id })); } }] : []),
        { label: 'Merge with another track…', icon: <GitMerge size={15} />, run: open({ kind: 'merge-with', id: `track:${t.id}` }) },
        ...(!t.albumId ? [t.vault ? { label: 'Not from the vault after all', icon: <Vault size={15} />, run: () => patch('tracks', t.id, { vault: false }) } : { label: 'Mark as from the vault', icon: <Vault size={15} />, run: () => patch('tracks', t.id, { vault: true }) }] as MenuItem[] : []),
      ]),
    ];
  };
}
