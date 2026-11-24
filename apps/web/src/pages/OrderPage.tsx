import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowDown, ArrowUp, ChevronLeft, GripVertical, Pause, Play } from 'lucide-react';
import type { VoteData } from '@turbomusic/core';
import { useLibrary } from '../lib/derive.ts';
import { usePlayer } from '../lib/player.ts';
import { canPlay } from '../lib/spotifyPlayer.ts';
import { useStore } from '../lib/store.ts';
import { Cover } from '../components/Cover.tsx';
import { cn } from '../lib/cn.ts';

/**
 * Put an album's songs in order of preference, on a page so the songs can be played while deciding (a pop-up would sit over the player).
 * Favourite first: drag the rows or use the arrows. Saving turns the order into votes between neighbours, each marked `order`: they guide
 * the ratings but count less as the songs are compared the ordinary way (see library.ts), so a first impression does not outweigh later votes.
 */
export function OrderPage() {
  const { albumId = '' } = useParams();
  const lib = useLibrary();
  const nav = useNavigate();
  const put = useStore((s) => s.put);
  const play = usePlayer((s) => s.play);
  const toggle = usePlayer((s) => s.toggle);
  const currentId = usePlayer((s) => s.queue.currentId);
  const playing = usePlayer((s) => s.playing);
  const album = lib.albumById.get(albumId);
  const start = useMemo(() => (album?.trackIds ?? []).filter((x) => lib.trackById.has(x)), [album, lib]);
  const [order, setOrder] = useState<string[] | null>(null);
  const list = order ?? start;
  const [drag, setDrag] = useState<number | null>(null);
  if (!album) return <div className="text-muted">Album not found.</div>;
  const move = (from: number, to: number) => { if (to < 0 || to >= list.length || from === to) return; const n = [...list]; const [x] = n.splice(from, 1); n.splice(to, 0, x); setOrder(n); };
  const save = () => {
    const now = Date.now();
    list.slice(0, -1).forEach((a, i) => { const data: VoteData = { trackAId: a, trackBId: list[i + 1], winnerId: a, isEqual: false, order: true, timestamp: now + i }; put('votes', data); });
    nav(`/albums/${album.id}`);
  };
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link to={`/albums/${album.id}`} className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg"><ChevronLeft size={15} />{album.title}</Link>
      <div><h1 className="text-2xl font-bold">Order by preference</h1>
        <p className="text-sm text-muted">Play the songs, then put your favourite first. Drag the rows or use the arrows. The order only guides the ratings: it counts less the more you compare these songs the ordinary way.</p></div>
      <ol className="card divide-y divide-line/60 overflow-hidden">
        {list.map((tid, i) => { const t = lib.trackById.get(tid)!; const here = currentId === tid; const ok = canPlay(t); return (
          <li key={tid} draggable onDragStart={() => setDrag(i)} onDragOver={(e) => e.preventDefault()} onDrop={() => { if (drag !== null) move(drag, i); setDrag(null); }} onDragEnd={() => setDrag(null)}
            className={cn('flex items-center gap-2 px-2 py-1.5 text-sm', drag === i && 'opacity-40', here && 'bg-accent/10')}>
            <GripVertical size={15} className="shrink-0 cursor-grab text-muted" aria-hidden />
            <span className="w-6 shrink-0 text-right text-xs tabular-nums text-muted">{i + 1}</span>
            <button type="button" disabled={!ok} className="group relative shrink-0 disabled:opacity-50" aria-label={here && playing ? `Pause ${t.title}` : `Play ${t.title}`} onClick={() => (here ? toggle() : play(tid, list, { type: 'search', id: `Order: ${album.title}` }))}>
              <Cover hash={t.cover} seed={t.albumTitle ?? t.title} className="h-10 w-10">
              <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-white opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 data-[on=true]:opacity-100" data-on={here}>{here && playing ? <Pause size={16} /> : <Play size={16} />}</span>
              </Cover>
            </button>
            <span className="min-w-0 flex-1"><span className="block truncate font-medium">{t.title}</span><span className="block truncate text-xs text-muted">{t.artistName}</span></span>
            <button type="button" className="btn btn-ghost !p-1.5" aria-label={`Move ${t.title} up`} disabled={i === 0} onClick={() => move(i, i - 1)}><ArrowUp size={14} /></button>
            <button type="button" className="btn btn-ghost !p-1.5" aria-label={`Move ${t.title} down`} disabled={i === list.length - 1} onClick={() => move(i, i + 1)}><ArrowDown size={14} /></button>
          </li>); })}
      </ol>
      <div className="flex items-center gap-2"><span className="text-sm text-muted">{list.length < 2 ? 'Needs at least two songs' : `${list.length - 1} comparisons will be saved`}</span>
        <Link to={`/albums/${album.id}`} className="btn ml-auto">Cancel</Link><button className="btn btn-accent" disabled={list.length < 2} onClick={save}>Save the order</button></div>
    </div>
  );
}
