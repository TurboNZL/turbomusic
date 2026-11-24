import { useEffect } from 'react';
import { canPlay } from '../lib/spotifyPlayer.ts';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowDownToLine, CheckSquare, Info, ListEnd, ListStart, MoreHorizontal, Pencil, Play } from 'lucide-react';
import type { Track } from '../lib/derive.ts';
import { usePlayer } from '../lib/player.ts';
import { useStore } from '../lib/store.ts';
import { useEditor } from '../lib/editor.ts';
import { cn } from '../lib/cn.ts';
import { Rating } from './Rating.tsx';
import { useMenu } from './Menu.tsx';
import { useTrackMenuItems } from './TrackMenu.tsx';
import { ArtistLinks } from './ArtistLinks.tsx';
import { Cover } from './Cover.tsx';
import { fmtDate } from './SingleCard.tsx';
import { statsPath } from '../lib/entityStats.ts';
import { isInteractive, useSelection } from '../lib/useSelection.ts';
import { TrackSelectionBar } from './SelectionBar.tsx';
import type { SourceType } from '@turbomusic/core';

/** Compact rows for ranking/editing lists. `list` is the playback order handed to the queue. */
export function TrackTable({ tracks, queue, source, sourceId = null, numbered = false, showAlbum = true, covers = false, linkTitles = false, keepQueue = false, selectable = true, allowDelete = false, extra, below }: {
  tracks: Track[];
  /** the whole list when `tracks` is only the part drawn so far: playing a row queues all of it */
  queue?: Track[]; source: SourceType; sourceId?: string | null; numbered?: boolean; showAlbum?: boolean;
  /** a small cover (the track's own, else its album's) before the title: for singles and search results, where the album is not around */
  covers?: boolean;
  /** the title always opens the song's own stats page (the Singles page: a song on an album can also be a single) */
  linkTitles?: boolean;
  /** play only the chosen track and leave what was queued after it as it was (search results: see Settings > Playback) */
  keepQueue?: boolean;
  /** click / Shift-click select rows and a bar offers what to do with them (on by default) */
  selectable?: boolean;
  /** the selection bar may delete the selected songs for good (the library-wide lists) */
  allowDelete?: boolean;
  /** extra controls at the end of each row (e.g. move/remove in a playlist) */
  extra?: (t: Track, index: number) => React.ReactNode;
  /** a full-width line under a row (e.g. a playlist note) */
  below?: (t: Track, index: number) => React.ReactNode;
}) {
  const play = usePlayer((s) => s.play);
  const enqueue = usePlayer((s) => s.enqueue);
  const current = usePlayer((s) => s.queue.currentId);
  const edit = useEditor((s) => s.open);
  const cache = useStore((s) => s.audioCache);
  const ids = (queue ?? tracks).map((t) => t.id);
  const playRow = (id: string) => {
    if (!keepQueue) { play(id, ids, { type: source, id: sourceId }); return; }
    const st = usePlayer.getState();
    play(id, [id, ...st.queue.active.filter((x) => x !== id)], st.queue.currentId ? st.source : { type: source, id: sourceId }); // what was coming next still comes next
  };
  const menu = useMenu();
  const itemsFor = useTrackMenuItems();
  const sel = useSelection(ids);
  // ?track=<id> (from "Go to track") scrolls that row into view and flashes it
  const focus = useSearchParams()[0].get('track');
  const present = focus ? tracks.some((t) => t.id === focus) : false;
  useEffect(() => {
    if (!focus || !present) return;
    const row = document.querySelector<HTMLElement>(`[data-track-id="${CSS.escape(focus)}"]`);
    if (!row) return;
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    row.classList.add('bt-row-flash');
    const t = window.setTimeout(() => row.classList.remove('bt-row-flash'), 2600);
    return () => window.clearTimeout(t);
  }, [focus, present]);

  return (
    <div className="divide-y divide-line/60 [container-type:inline-size]">
      {tracks.map((t, i) => (
        <div key={t.id}>
        <div data-track-id={t.id} data-selected={sel.has(t.id) || undefined} className={cn('bt-row group flex items-center gap-3 px-3', current === t.id && 'bt-row-current')} style={{ paddingBlock: 'var(--row-y)' }}
          onMouseDown={(e) => { if (selectable && e.shiftKey && !isInteractive(e.target)) e.preventDefault(); }} // Shift-click must select rows, not highlight text
          onClick={(e) => { if (selectable && !isInteractive(e.target)) sel.click(t.id, e); }}
          onContextMenu={(e) => menu.onContextMenu(selectable ? [{ label: sel.has(t.id) ? 'Deselect' : 'Select', icon: <CheckSquare size={15} />, run: () => sel.toggle(t.id) }, { separator: true }, ...itemsFor(t, () => playRow(t.id))] : itemsFor(t, () => playRow(t.id)), `Actions for ${t.title}`, t.id)(e)}
          // double-click anywhere on the row that is not a button, link or field plays it
          onDoubleClick={(e) => { if ((e.target as Element).closest('a, button, input, select, textarea, [role="menu"]') || !canPlay(t)) return; window.getSelection()?.removeAllRanges(); playRow(t.id); }}>
          {covers ? <>
            {numbered && <span className={cn('w-6 shrink-0 text-center text-sm text-muted', current === t.id && 'text-accent')}>{i + 1}</span>}
            {/* the cover is the play button: the Play glyph appears over it on hover or focus (and a tap on a phone plays) */}
            <button className="relative block w-10 shrink-0 overflow-hidden leading-none disabled:cursor-not-allowed" style={{ borderRadius: 'min(var(--radius, 0.5rem), 22%)' }} disabled={!canPlay(t)} aria-label={canPlay(t) ? `Play ${t.title}` : 'No audio file yet'}
              onClick={() => playRow(t.id)} title={canPlay(t) ? 'Play' : 'No audio file yet'}>
              <Cover hash={t.cover} seed={t.albumTitle ?? t.title} className="w-full" />
              {canPlay(t) && <span className="absolute inset-0 grid place-items-center bg-black/55 text-white opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"><Play size={16} fill="currentColor" /></span>}
            </button>
          </> : (
          <button className="relative w-6 shrink-0 text-center text-sm text-muted disabled:cursor-not-allowed" disabled={!canPlay(t)}
            onClick={() => playRow(t.id)} title={canPlay(t) ? 'Play' : 'No audio file yet'}>
            <span className={cn(canPlay(t) && 'group-hover:hidden', current === t.id && canPlay(t) && 'text-accent')}>{numbered ? i + 1 : ''}</span>
            {canPlay(t) && <Play size={14} fill="currentColor" className="mx-auto hidden group-hover:block" />}
          </button>)}
          <div className="min-w-0 flex-1">
            <div className={cn('truncate text-sm font-medium', !t.file && 'text-fg/70')}>{t.albumId && !linkTitles ? t.title : <Link to={statsPath('track', t.id)} className="hover:underline" title="Open this single (its stats: it has no album page)">{t.title}</Link>}</div>
            <div className="truncate text-xs text-muted">
              <ArtistLinks leads={t.leads} featured={t.featured} />
              {showAlbum && t.albumTitle && <> · <Link to={`/albums/${t.albumId}`} className="hover:text-fg hover:underline">{t.albumTitle}</Link></>}
              {!t.albumId && t.releaseDate && <> · {fmtDate(t.releaseDate)}</>}
              {t.alsoOn.length > 0 && <span className="ml-1.5 rounded-full border border-line px-1.5 text-[10px] text-muted" title={`Also on: ${t.alsoOn.map((a) => a.title).join(', ')}`}>also on {t.alsoOn.length === 1 ? t.alsoOn[0].title : `${t.alsoOn.length} albums`}</span>}
            </div>
          </div>
          <div className="hidden w-40 justify-end gap-1 overflow-hidden [@container(min-width:36rem)]:flex">{t.allGenres.slice(0, 2).map((g) => <span key={g} className="chip">{g}</span>)}</div>
          <span className="w-4 text-muted" title={t.file && cache[t.file] ? 'Saved on this device' : ''}>{t.file && cache[t.file] && <ArrowDownToLine size={13} />}</span>
          <div className="hidden w-24 text-right text-xs tabular-nums text-muted [@container(min-width:56rem)]:block" title="Release date">{t.releaseDate ? fmtDate(t.releaseDate) : ''}</div>
          <div className="hidden w-14 text-right text-xs tabular-nums text-muted [@container(min-width:46rem)]:block">{t.bitrate ?? ''}</div>
          <div className="hidden w-28 justify-end gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 [@container(min-width:42rem)]:flex">
            <button className="p-1 text-muted hover:text-fg" title="Details" onClick={() => edit({ kind: 'track-details', id: t.id })}><Info size={15} /></button>
            <button className="p-1 text-muted hover:text-fg" title="Edit" onClick={() => edit({ kind: 'track', id: t.id })}><Pencil size={15} /></button>
            <button className="p-1 text-muted hover:text-fg" title="Play next" disabled={!canPlay(t)} onClick={() => enqueue(t.id, 'next')}><ListStart size={15} /></button>
            <button className="p-1 text-muted hover:text-fg" title="Add to queue" disabled={!canPlay(t)} onClick={() => enqueue(t.id, 'last')}><ListEnd size={15} /></button>
          </div>
          <button data-menu-trigger className="p-1 text-muted hover:text-fg" aria-label={`More actions for ${t.title}`} aria-haspopup="menu" aria-expanded={menu.at?.key === t.id} onClick={(e) => menu.toggle(e.currentTarget, t.id, itemsFor(t, () => play(t.id, ids, { type: source, id: sourceId })), `Actions for ${t.title}`)}><MoreHorizontal size={16} /></button>
          <div className="flex w-20 justify-end"><Rating track={t} size="sm" /></div>
          {extra?.(t, i)}
        </div>
        {below?.(t, i)}
        </div>
      ))}
      {menu.element}
      {selectable && <TrackSelectionBar sel={sel} total={ids.length} allowDelete={allowDelete} />}
      {!tracks.length && <div className="p-6 text-center text-sm text-muted">No tracks.</div>}
    </div>
  );
}
