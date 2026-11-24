import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CheckSquare, EyeOff, Eye, ListEnd, ListMusic, ListStart, Play, Shuffle, Trash2, X } from 'lucide-react';
import { shuffleWithRules } from '@turbomusic/core';
import { useLibrary } from '../lib/derive.ts';
import { usePlayer } from '../lib/player.ts';
import { useStore } from '../lib/store.ts';
import { useEditor } from '../lib/editor.ts';
import { useBottomOffset } from '../lib/useBottomOffset.ts';
import { canPlay } from '../lib/spotifyPlayer.ts';
import { plural } from '../lib/cn.ts';
import type { Selection } from '../lib/useSelection.ts';
import { PlaylistFlyout } from './PlaylistFlyout.tsx';

/** The bar that appears while rows are selected: how many, the actions, select all, clear. Sits just above the player bar. */
export function SelectionBar({ count, total, onAll, onClear, children, noun = 'selected' }: { count: number; total: number; onAll: () => void; onClear: () => void; children: ReactNode; noun?: string }) {
  const bottom = useBottomOffset(count > 0, 10);
  if (!count) return null;
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 z-[54] flex justify-center px-3" style={{ bottom }} role="region" aria-label="Selection">
      <div className="bt-menu pointer-events-auto flex max-w-full flex-wrap items-center gap-1.5 rounded-theme p-2 text-sm shadow-lg">
        <span className="px-2 font-medium">{count.toLocaleString()} {noun}</span>
        {children}
        {count < total && <button type="button" className="btn btn-ghost !px-2 !py-1 text-xs" onClick={onAll}><CheckSquare size={14} />All {total.toLocaleString()}</button>}
        <button type="button" className="btn btn-ghost !p-1.5" aria-label="Clear the selection" title="Clear (Esc)" onClick={onClear}><X size={15} /></button>
      </div>
    </div>, document.body);
}

/** What you can do with selected songs: play them, queue them, put them on a playlist, delete them. */
export function TrackSelectionBar({ sel, total, allowDelete = false }: { sel: Selection; total: number; allowDelete?: boolean }) {
  const lib = useLibrary(true);
  const { play, enqueue } = usePlayer.getState();
  const label = useStore((s) => s.settings.deviceName); void label;
  const [pl, setPl] = useState(false);
  const ids = sel.ordered;
  const playable = ids.filter((id) => canPlay(lib.trackById.get(id)));
  const run = (fn: () => void) => () => { fn(); };
  return (
    <SelectionBar count={sel.size} total={total} onAll={sel.selectAll} onClear={() => { setPl(false); sel.clear(); }} noun={sel.size === 1 ? 'song selected' : 'songs selected'}>
      <button type="button" className="btn btn-accent !px-2.5 !py-1 text-xs" disabled={!playable.length} onClick={run(() => play(playable[0], playable, { type: 'search', id: 'Selection' }))}><Play size={14} fill="currentColor" />Play</button>
      <button type="button" className="btn !px-2.5 !py-1 text-xs" disabled={!playable.length} title="Play them in a random order" onClick={run(() => { const o = shuffleWithRules(playable, lib.rules); play(o[0], o, { type: 'search', id: 'Selection' }); })}><Shuffle size={14} />Shuffle</button>
      <button type="button" className="btn !px-2.5 !py-1 text-xs" disabled={!playable.length} onClick={run(() => [...playable].reverse().forEach((id) => enqueue(id, 'next')))}><ListStart size={14} />Next</button>
      <button type="button" className="btn !px-2.5 !py-1 text-xs" disabled={!playable.length} onClick={run(() => playable.forEach((id) => enqueue(id, 'last')))}><ListEnd size={14} />Queue</button>
      <span className="relative">
        <button type="button" data-menu-trigger className={`btn !px-2.5 !py-1 text-xs ${pl ? 'btn-accent' : ''}`} aria-expanded={pl} onClick={() => setPl(!pl)}><ListMusic size={14} />Playlist</button>
        {pl && <div className="bt-menu absolute bottom-full left-1/2 z-10 mb-2 w-64 -translate-x-1/2 rounded-theme shadow-lg" role="menu"><PlaylistFlyout trackIds={ids} /></div>}
      </span>
      {allowDelete && <button type="button" className="btn !px-2.5 !py-1 text-xs text-bad" onClick={() => useEditor.getState().open({ kind: 'delete-tracks', id: ids.join(',') })}><Trash2 size={14} />Delete</button>}
    </SelectionBar>
  );
}

/** What you can do with selected albums or artists: play their songs, queue them, hide them. */
export function EntitySelectionBar({ sel, total, trackIdsOf, hide }: { sel: Selection; total: number; trackIdsOf: (id: string) => string[]; hide?: { hidden: (id: string) => boolean; set: (id: string, v: boolean) => void } }) {
  const lib = useLibrary(true);
  const { play, enqueue } = usePlayer.getState();
  const ids = [...new Set(sel.ordered.flatMap(trackIdsOf))].filter((id) => canPlay(lib.trackById.get(id)));
  const allHidden = !!hide && sel.ordered.every(hide.hidden);
  return (
    <SelectionBar count={sel.size} total={total} onAll={sel.selectAll} onClear={sel.clear} noun="selected">
      <button type="button" className="btn btn-accent !px-2.5 !py-1 text-xs" disabled={!ids.length} onClick={() => play(ids[0], ids, { type: 'search', id: 'Selection' })}><Play size={14} fill="currentColor" />Play</button>
      <button type="button" className="btn !px-2.5 !py-1 text-xs" disabled={!ids.length} onClick={() => { const o = shuffleWithRules(ids, lib.rules); play(o[0], o, { type: 'search', id: 'Selection' }); }}><Shuffle size={14} />Shuffle</button>
      <button type="button" className="btn !px-2.5 !py-1 text-xs" disabled={!ids.length} onClick={() => [...ids].reverse().forEach((id) => enqueue(id, 'next'))}><ListStart size={14} />Next</button>
      <button type="button" className="btn !px-2.5 !py-1 text-xs" disabled={!ids.length} onClick={() => ids.forEach((id) => enqueue(id, 'last'))}><ListEnd size={14} />Queue</button>
      {hide && <button type="button" className="btn !px-2.5 !py-1 text-xs" onClick={() => { for (const id of sel.ordered) hide.set(id, !allHidden); sel.clear(); }}>{allHidden ? <Eye size={14} /> : <EyeOff size={14} />}{allHidden ? 'Show' : 'Hide'}</button>}
    </SelectionBar>
  );
}
