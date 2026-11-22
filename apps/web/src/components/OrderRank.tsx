import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, GripVertical } from 'lucide-react';
import type { VoteData } from '@turbomusic/core';
import { useLibrary } from '../lib/derive.ts';
import { useStore } from '../lib/store.ts';
import { Cover } from './Cover.tsx';
import { Modal } from './forms.tsx';

/**
 * Put songs in order of preference (for a first listen to an album: favourite at the top). Saving turns the order into votes between
 * neighbours, each marked `order`: they guide the ratings but count less and less as the songs get compared the ordinary way, so a first
 * impression does not outweigh what you decide later. `id` is an album id, or `tracks:<id>,<id>…`.
 */
export function OrderRankDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const lib = useLibrary();
  const put = useStore((s) => s.put);
  const start = useMemo(() => {
    const ids = id.startsWith('tracks:') ? id.slice(7).split(',') : lib.albumById.get(id)?.trackIds ?? [];
    return ids.filter((x) => lib.trackById.has(x));
  }, [id, lib]);
  const [order, setOrder] = useState(start);
  const [drag, setDrag] = useState<number | null>(null);
  const move = (from: number, to: number) => setOrder((o) => { if (to < 0 || to >= o.length || from === to) return o; const n = [...o]; const [x] = n.splice(from, 1); n.splice(to, 0, x); return n; });
  const title = id.startsWith('tracks:') ? 'these songs' : lib.albumById.get(id)?.title ?? 'this album';
  const save = () => {
    const now = Date.now();
    order.slice(0, -1).forEach((a, i) => { const data: VoteData = { trackAId: a, trackBId: order[i + 1], winnerId: a, isEqual: false, order: true, timestamp: now + i }; put('votes', data); });
    onClose();
  };
  return (
    <Modal title={`Order ${title} by preference`} onClose={onClose}
      footer={<><span className="text-sm text-muted">{order.length < 2 ? 'Needs at least two songs' : `${order.length - 1} comparisons will be saved`}</span><button className="btn ml-auto" onClick={onClose}>Cancel</button><button className="btn btn-accent" disabled={order.length < 2} onClick={save}>Save the order</button></>}>
      <p className="text-sm text-muted">Favourite first. Drag the rows (or use the arrows). The order only guides the ratings: it counts less the more you compare these songs the ordinary way.</p>
      <ol className="divide-y divide-line/60 rounded-theme border border-line">
        {order.map((tid, i) => { const t = lib.trackById.get(tid)!; return (
          <li key={tid} draggable onDragStart={() => setDrag(i)} onDragOver={(e) => e.preventDefault()} onDrop={() => { if (drag !== null) move(drag, i); setDrag(null); }} onDragEnd={() => setDrag(null)}
            className={`flex items-center gap-2 px-2 py-1.5 text-sm ${drag === i ? 'opacity-40' : ''}`}>
            <GripVertical size={15} className="shrink-0 cursor-grab text-muted" aria-hidden />
            <span className="w-6 shrink-0 text-right text-xs tabular-nums text-muted">{i + 1}</span>
            <Cover hash={t.cover} seed={t.albumTitle ?? t.title} className="h-8 w-8 shrink-0" />
            <span className="min-w-0 flex-1"><span className="block truncate font-medium">{t.title}</span><span className="block truncate text-xs text-muted">{t.artistName}</span></span>
            <button type="button" className="btn btn-ghost !p-1.5" aria-label={`Move ${t.title} up`} disabled={i === 0} onClick={() => move(i, i - 1)}><ArrowUp size={14} /></button>
            <button type="button" className="btn btn-ghost !p-1.5" aria-label={`Move ${t.title} down`} disabled={i === order.length - 1} onClick={() => move(i, i + 1)}><ArrowDown size={14} /></button>
          </li>); })}
      </ol>
    </Modal>
  );
}
