import { Link } from 'react-router-dom';
import { ListMusic, Pin, PinOff, Shuffle, Trash2, X } from 'lucide-react';
import { useLibrary } from '../lib/derive.ts';
import { usePlayer } from '../lib/player.ts';
import { usePopups } from '../lib/popups.ts';
import { Cover } from './Cover.tsx';
import { sourceLabel } from '../lib/sourceLabel.ts';
import { Popover } from './Popover.tsx';
import { cn } from '../lib/cn.ts';

/** What plays next, without leaving the page. Pin it to keep it open while you click around. */
export function MiniQueue({ anchor }: { anchor: HTMLElement | null }) {
  const lib = useLibrary();
  const open = usePopups((s) => s.queueOpen);
  const pinned = usePopups((s) => s.queuePinned);
  const { closeQueue, setPinned } = usePopups.getState();
  const q = usePlayer((s) => s.queue);
  const dequeue = usePlayer((s) => s.dequeue);
  const { shuffleQueued, shuffleRest, clearQueued, clearRest } = usePlayer.getState();
  const source = usePlayer((s) => s.source);
  const head = (label: string, count: number, onShuffle: () => void, onClear: () => void) => (
    <div className="flex items-center px-3 pt-2"><span className="mr-auto text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</span>
      {count > 1 && <button type="button" className="btn btn-ghost !p-1" title={`Shuffle: ${label.toLowerCase()}`} aria-label={`Shuffle ${label.toLowerCase()}`} onClick={onShuffle}><Shuffle size={13} /></button>}
      <button type="button" className="btn btn-ghost !p-1" title={`Clear: ${label.toLowerCase()}`} aria-label={`Clear ${label.toLowerCase()}`} onClick={onClear}><Trash2 size={13} /></button></div>
  );
  const row = (id: string, i: number, queued: boolean) => {
    const t = lib.trackById.get(id);
    if (!t) return null;
    return (
      <div key={`${queued ? 'u' : 'a'}${i}${id}`} className="group flex items-center gap-2 px-3 py-1.5 text-sm">
        <Cover hash={t.cover} seed={t.albumTitle ?? t.title} className="h-8 w-8 shrink-0" />
        <div className="min-w-0 flex-1"><div className="truncate">{t.title}</div><div className="truncate text-xs text-muted">{t.artistName}</div></div>
        {queued && <button type="button" className="btn btn-ghost !p-1 opacity-60 hover:opacity-100" aria-label={`Remove ${t.title} from the queue`} onClick={() => dequeue(i)}><X size={14} /></button>}
      </div>
    );
  };
  const from = sourceLabel(lib, source);
  const current = q.currentId ? lib.trackById.get(q.currentId) : undefined;
  return (
    <Popover open={open} anchor={anchor} onClose={closeQueue} align="right" pinned={pinned} label="Queue" className="w-80 max-w-[calc(100vw-1.5rem)]">
      <div className="flex items-center gap-2 border-b border-line/60 px-3 py-2">
        <ListMusic size={15} /><span className="mr-auto text-sm font-semibold">Queue</span>
        <button type="button" className={cn('btn btn-ghost !p-1.5', pinned && 'text-accent')} aria-pressed={pinned} title={pinned ? 'Unpin (closes when you click elsewhere)' : 'Pin: keep open while you use the app'} onClick={() => setPinned(!pinned)}>{pinned ? <PinOff size={15} /> : <Pin size={15} />}</button>
        <button type="button" className="btn btn-ghost !p-1.5" aria-label="Close" onClick={() => { setPinned(false); closeQueue(); }}><X size={15} /></button>
      </div>
      <div className="max-h-[55vh] overflow-y-auto py-1">
        {current && <><div className="px-3 pt-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Now playing</div>
          <div className="mx-1 rounded-theme bg-accent/10">{row(current.id, -1, false)}</div></>}
        {q.user.length > 0 && head('Queue · added by you', q.user.length, shuffleQueued, clearQueued)}
        {q.user.map((id, i) => row(id, i, true))}
        {q.active.length > 0 && head(from ? `Lineup · from ${from.text}` : 'Lineup · the rest of the album or list', q.active.length, shuffleRest, clearRest)}
        {q.active.slice(0, 30).map((id, i) => row(id, i, false))}
        {q.active.length > 30 && <div className="px-3 py-1 text-xs text-muted">and {q.active.length - 30} more</div>}
        {(q.parked ?? []).map((g, gi) => { const gl = sourceLabel(lib, g.source); return (
          <div key={`p${gi}`}>
            {head(gl ? `Waiting · from ${gl.text}` : 'Waiting · an earlier lineup', 0, () => undefined, () => usePlayer.getState().dropParked(gi))}
            {g.ids.slice(0, 15).map((id, i) => row(id, i, false))}
            {g.ids.length > 15 && <div className="px-3 py-1 text-xs text-muted">and {g.ids.length - 15} more</div>}
          </div>); })}
        {!q.user.length && !q.active.length && !(q.parked ?? []).length && <p className="px-3 py-3 text-sm text-muted">Nothing is queued after this track.</p>}
      </div>
      <div className="border-t border-line/60 px-3 py-2 text-right text-xs"><Link to="/queue" className="text-accent hover:underline" onClick={() => !pinned && closeQueue()}>Open the full queue</Link></div>
    </Popover>
  );
}
