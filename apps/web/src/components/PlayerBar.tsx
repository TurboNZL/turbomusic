import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { trackPath } from '../lib/trackPath.ts';
import { Cast, Info, Maximize2, ListMusic, Loader2, Pause, Play, SkipBack, SkipForward, Volume2 } from 'lucide-react';
import { useLibrary, type Track } from '../lib/derive.ts';
import { usePlayer } from '../lib/player.ts';
import { useStore } from '../lib/store.ts';
import { usePopups } from '../lib/popups.ts';
import { usePresence } from '../lib/presence.ts';
import { useEditor } from '../lib/editor.ts';
import { cn, fmtTime } from '../lib/cn.ts';
import { Cover } from './Cover.tsx';
import { Rating } from './Rating.tsx';
import { RateBlock } from './RateBlock.tsx';
import { ArtistLinks } from './ArtistLinks.tsx';
import { MiniQueue } from './MiniQueue.tsx';
import { DevicesPopover } from './Devices.tsx';
import { usePlaybackView } from '../lib/connect.ts';
import { CoverPreview } from './CoverPreview.tsx';
import { useMenu } from './Menu.tsx';
import { useTrackMenuItems } from './TrackMenu.tsx';

/** The filled part of a range, for the styles that draw their own track. */
const pct = (v: number, max: number) => ({ '--p': `${max > 0 ? Math.min(100, (v / max) * 100) : 0}%` }) as React.CSSProperties;

/**
 * Not shown until something is selected. It enters and leaves with the UI style's own motion (--player-in / --player-out:
 * nothing for the old Windows styles, a slide for Windows 11, floating-glass for Liquid Glass).
 */
export function PlayerBar() {
  const lib = useLibrary();
  const p = usePlayer();
  const spotifyDevice = useStore((st) => st.settings.spotifyDeviceName);
  const v = usePlaybackView();
  const edit = useEditor((s) => s.open);
  const menu = useMenu();
  const itemsFor = useTrackMenuItems();
  const current = v.trackId ? lib.trackById.get(v.trackId) : undefined;
  const last = useRef<Track | undefined>(undefined);
  if (current) last.current = current;
  const { mounted, leaving } = usePresence(!!current, '--player-ms');
  const queueOpen = usePopups((s) => s.queueOpen);
  const coverOpen = usePopups((s) => s.coverOpen);
  const { toggleQueue, toggleCover } = usePopups.getState();
  const [coverBtn, setCoverBtn] = useState<HTMLButtonElement | null>(null);
  const [queueBtn, setQueueBtn] = useState<HTMLButtonElement | null>(null);
  const [devBtn, setDevBtn] = useState<HTMLButtonElement | null>(null);
  const devicesOpen = usePopups((s) => s.devicesOpen);
  // the cover card belongs to the playing track; it closes with it
  useEffect(() => { if (!current) usePopups.getState().closeCover(); }, [current]);

  if (!mounted) return null;
  const track = current ?? last.current;
  return (
    <div className="bt-player bt-shell" data-leaving={leaving || undefined}>
      {p.error && <div className="bg-bad/15 px-4 py-1 text-center text-xs text-bad">{p.error}</div>}
      <div className="bt-pbar flex items-center gap-3 px-3 py-2 md:gap-6 md:px-4">
        <div className="flex min-w-0 flex-1 items-center gap-3 md:w-1/3 md:flex-none" onContextMenu={track ? menu.onContextMenu(itemsFor(track, () => { if (!v.playing) v.toggle(); }), `Actions for ${track.title}`, 'playing') : undefined}>
          {track && <>
            <button ref={setCoverBtn} type="button" data-popover-trigger aria-expanded={coverOpen} aria-label="Show a larger cover" title="Larger cover" className="bt-cover-btn shrink-0 rounded-theme" onClick={toggleCover}>
              <Cover hash={track.cover} seed={track.albumTitle ?? track.title} className="h-12 w-12" />
            </button>
            <div className="min-w-0">
              <div className="bt-ptitle truncate text-sm font-medium"><Link to={trackPath(track)} className="hover:underline" title="Go to this track in your library">{track.title}</Link></div>
              <div className="bt-partist truncate text-xs text-muted"><ArtistLinks leads={track.leads} featured={track.featured} className="hover:underline" /></div>
              {!v.remote && p.engine === 'spotify' && <div className="flex items-center gap-1 truncate text-[11px] font-medium text-accent"><Cast size={11} />Playing on {spotifyDevice || 'Spotify'}</div>}
              {v.remote && <div className="flex items-center gap-1 truncate text-[11px] font-medium text-accent"><Cast size={11} />Playing on {v.remote.name}</div>}
            </div>
            <button type="button" className="btn btn-ghost !p-1.5 shrink-0" title="Track info" aria-label="Track info" onClick={() => edit({ kind: 'track-details', id: track.id })}><Info size={16} /></button>
            <div className="hidden xl:block"><Rating track={track} size="sm" /></div>
            <RateBlock track={track} className="hidden md:grid" />
          </>}
        </div>
        <div className="flex shrink-0 flex-col items-center gap-1 md:flex-1">
          <div className="flex items-center gap-2">
            <button className="btn-ghost btn !p-2" title="Previous" onClick={v.prev}><SkipBack size={18} /></button>
            <button className="btn btn-accent !rounded-full !p-2.5" title={v.loading ? 'Loading…' : v.playing ? 'Pause' : 'Play'} aria-busy={v.loading || undefined} onClick={v.toggle}>{v.loading ? <Loader2 size={18} className="animate-spin" /> : v.playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}</button>
            <button className="btn-ghost btn !p-2" title="Next" onClick={v.next}><SkipForward size={18} /></button>
            <button type="button" data-popover-trigger className={cn('btn-ghost btn !p-2 md:hidden', (devicesOpen || v.remote) && 'text-accent')} title="Play on a device" aria-label="Play on a device" onClick={usePopups.getState().toggleDevices}><Cast size={16} /></button>
            <button type="button" data-popover-trigger className={cn('btn-ghost btn !p-2 md:hidden', queueOpen && 'text-accent')} title="Queue" aria-label="Queue" aria-expanded={queueOpen} onClick={toggleQueue}><ListMusic size={16} /></button>
          </div>
          <div className="bt-times hidden w-full max-w-xl items-center gap-2 text-xs tabular-nums text-muted sm:flex">
            <span className="w-9 text-right">{fmtTime(v.time)}</span>
            <input type="range" aria-label="Seek" className="bt-range bt-hit flex-1" style={pct(v.time, v.duration)} min={0} max={v.duration || 1} step={0.1} value={v.time} onChange={(e) => v.seek(Number(e.target.value))} />
            <span className="w-9">{fmtTime(v.duration)}</span>
          </div>
        </div>
        <div className="hidden w-1/3 items-center justify-end gap-2 md:flex">
          <button ref={setDevBtn} type="button" data-popover-trigger className={cn('btn-ghost btn !p-2', (devicesOpen || v.remote) && 'text-accent')} title="Play on a device" aria-label="Play on a device" aria-expanded={devicesOpen} onClick={usePopups.getState().toggleDevices}><Cast size={16} /></button>
          <button ref={setQueueBtn} type="button" data-popover-trigger className={cn('btn-ghost btn !p-2', queueOpen && 'text-accent')} title="Queue" aria-label="Queue" aria-expanded={queueOpen} onClick={toggleQueue}><ListMusic size={16} /></button>
          <button type="button" className="btn-ghost btn !p-2" title="Full screen: cover and lyrics" aria-label="Full screen now playing" onClick={() => { usePopups.getState().setNow(true); void document.documentElement.requestFullscreen?.().catch(() => undefined); }}><Maximize2 size={16} /></button>
          <Volume2 size={16} className="text-muted" />
          <input type="range" aria-label="Volume" className="bt-range bt-hit w-24" style={pct(v.volume, 1)} min={0} max={1} step={0.01} value={v.volume} onChange={(e) => v.setVolume(Number(e.target.value))} />
        </div>
      </div>
      <div className="h-0.5 w-full bg-line/60 sm:hidden" aria-hidden><div className="h-full bg-accent" style={{ width: `${v.duration > 0 ? Math.min(100, (v.time / v.duration) * 100) : 0}%` }} /></div>
      <CoverPreview anchor={coverBtn} track={track} />
      <MiniQueue anchor={queueBtn} />
      <DevicesPopover anchor={devBtn} />
      {menu.element}
    </div>
  );
}
