import { statsPath } from '../lib/entityStats.ts';
import { BarChart3, Info, ListEnd, ListPlus, ListStart, Pencil, Play, Plus, Minus, Disc3, StickyNote, User } from 'lucide-react';
import { canPlay } from '../lib/spotifyPlayer.ts';
import type { Track } from '../lib/derive.ts';
import type { EditTarget } from '../lib/editor.ts';
import { useEditor } from '../lib/editor.ts';
import { usePlayer } from '../lib/player.ts';
import { addMemory, removeMemory } from '../lib/memories.ts';
import { trackPath } from '../lib/trackPath.ts';
import type { MenuItem } from './Menu.tsx';

/** The per-track menu (the old right-click menu) as menu items; shown by useMenu()/ContextMenu. */
export function useTrackMenuItems() {
  const edit = useEditor((s) => s.open);
  const enqueue = usePlayer((s) => s.enqueue);
  return (t: Track, onPlay: () => void): MenuItem[] => {
    const memories = t.memories ?? 0;
    const open = (target: EditTarget) => () => edit(target);
    return [
      { label: 'Play', icon: <Play size={15} />, run: onPlay, disabled: !canPlay(t) },
      { label: 'Play next', icon: <ListStart size={15} />, run: () => enqueue(t.id, 'next'), disabled: !canPlay(t) },
      { label: 'Add to queue', icon: <ListEnd size={15} />, run: () => enqueue(t.id, 'last'), disabled: !canPlay(t) },
      { label: 'Add to playlist…', icon: <ListPlus size={15} />, run: open({ kind: 'add-to-playlist', id: t.id }) },
      ...(t.albumId ? [] : [{ label: 'Add to album…', icon: <Disc3 size={15} />, run: open({ kind: 'add-to-album', id: t.id }) }]),
      { separator: true },
      { label: `Add memory (${memories})`, icon: <Plus size={15} />, run: () => addMemory(t.id) },
      { label: 'Remove a memory', icon: <Minus size={15} />, run: () => removeMemory(t.id), disabled: memories < 1 },
      { separator: true },
      ...t.leads.map((l) => ({ label: `Go to ${l.name}`, icon: <User size={15} />, to: `/artists/${l.id}` })),
      ...(t.albumId ? [{ label: 'Go to album', icon: <Disc3 size={15} />, to: trackPath(t) }] : []),
      { label: 'Write a note…', icon: <StickyNote size={15} />, run: open({ kind: 'new-note', id: `track:${t.id}` }) },
      { label: 'Info', icon: <Info size={15} />, run: open({ kind: 'track-details', id: t.id }) },
      { label: 'Stats page', icon: <BarChart3 size={15} />, to: statsPath('track', t.id) },
      { label: 'Edit…', icon: <Pencil size={15} />, run: open({ kind: 'track', id: t.id }) },
    ];
  };
}
