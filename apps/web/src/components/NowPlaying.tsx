import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Maximize2, Minimize2, Moon, Pause, Play, Loader2, SkipBack, SkipForward, X, Mic2, Minus, Plus } from 'lucide-react';
import { useLibrary } from '../lib/derive.ts';
import { usePlaybackView } from '../lib/connect.ts';
import { usePopups } from '../lib/popups.ts';
import { useFileUrl } from '../lib/files.ts';
import { useLyrics } from '../lib/lyrics.ts';
import { activeLine } from '../lib/lrc.ts';
import { cn, fmtTime } from '../lib/cn.ts';
import { ArtistLinks } from './ArtistLinks.tsx';

/**
 * The full-screen now-playing view: the cover large over a blurred copy of itself, the lyrics scrolling with the song (synced when
 * the database has timings), and a screensaver mode that hides everything but a slowly drifting cover and the title. Controls and the
 * mouse pointer hide after a few seconds without movement; any movement or key brings them back. Esc closes.
 */
const OFFSET_KEY = 'turbomusic.lyricsOffset';
const loadOffset = () => { try { const n = Number(localStorage.getItem(OFFSET_KEY)); return Number.isFinite(n) ? Math.max(-5, Math.min(5, n)) : 0; } catch { return 0; } };

/**
 * The playback position for the lyrics. The player reports its position only a few times a second (about 4/s in the browser, 2/s in the
 * Android app), which made lines change up to half a second late, so between reports the clock runs on its own and is re-synced to every
 * report. Not running while paused.
 */
function useSmoothTime(time: number, playing: boolean): number {
  const base = useRef({ time, at: performance.now() });
  const [now, setNow] = useState(time);
  useEffect(() => { base.current = { time, at: performance.now() }; setNow(time); }, [time]);
  useEffect(() => {
    if (!playing) return;
    const t = window.setInterval(() => setNow(base.current.time + (performance.now() - base.current.at) / 1000), 100);
    return () => window.clearInterval(t);
  }, [playing]);
  return playing ? now : time;
}

export function NowPlaying() {
  const open = usePopups((s) => s.nowOpen);
  const setNow = usePopups((s) => s.setNow);
  const lib = useLibrary();
  const v = usePlaybackView();
  const track = v.trackId ? lib.trackById.get(v.trackId) : undefined;
  const [saver, setSaver] = useState(false);
  const [showLyrics, setShowLyrics] = useState(true);
  const [idle, setIdle] = useState(false);
  const [full, setFull] = useState(!!document.fullscreenElement);
  const cover = useFileUrl(track?.cover);
  const lyrics = useLyrics(track ? { id: track.id, title: track.title, artist: track.leads[0]?.name ?? track.artistName, album: track.albumTitle } : undefined, v.duration, open && showLyrics && !saver);
  const lines = lyrics.state === 'ready' ? lyrics.synced : null;
  const [offset, setOffsetState] = useState(loadOffset);
  const setOffset = (n: number) => { const x = Math.round(Math.max(-5, Math.min(5, n)) * 10) / 10; setOffsetState(x); try { localStorage.setItem(OFFSET_KEY, String(x)); } catch { /* private mode */ } };
  const clock = useSmoothTime(v.time, v.playing);
  const active = lines ? activeLine(lines, clock + 0.3 + offset) : -1;
  const listRef = useRef<HTMLDivElement>(null);
  const idleTimer = useRef<number>(0);

  /** From the screensaver the Lyrics button leaves it and shows the lyrics (it used to toggle them off as well); otherwise it toggles them. */
  const pickLyricsRef = useRef<() => void>(() => undefined);
  const pickLyrics = () => pickLyricsRef.current();
  pickLyricsRef.current = () => { if (saver) { setSaver(false); setShowLyrics(true); } else setShowLyrics((x) => !x); };
  // On a touch screen the controls stay until the screensaver is on (there is no pointer to bring them back, and a tap on invisible buttons used to do nothing).
  const touch = useRef(typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches);
  const saverRef = useRef(saver); saverRef.current = saver;
  const wake = () => { setIdle(false); window.clearTimeout(idleTimer.current); if (touch.current && !saverRef.current) return; idleTimer.current = window.setTimeout(() => setIdle(true), 4000); };
  useEffect(() => {
    if (!open) return;
    wake();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.fullscreenElement) setNow(false);
      else if (e.key.toLowerCase() === 'l') pickLyrics();
      else if (e.key.toLowerCase() === 's') setSaver((x) => !x);
      wake();
    };
    const fs = () => setFull(!!document.fullscreenElement);
    window.addEventListener('keydown', key); document.addEventListener('fullscreenchange', fs);
    // keep the screen on while it is a screensaver (not supported everywhere)
    let lock: { release(): Promise<void> } | null = null;
    (navigator as unknown as { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock?.request('screen').then((l) => { lock = l; }).catch(() => undefined);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prevOverflow; window.removeEventListener('keydown', key); document.removeEventListener('fullscreenchange', fs); window.clearTimeout(idleTimer.current); void lock?.release(); if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined); };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // the sung line stays in the middle of the lyrics
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-line="${active}"]`);
    if (el && listRef.current) listRef.current.scrollTo({ top: el.offsetTop - listRef.current.clientHeight / 2 + el.clientHeight / 2, behavior: 'smooth' });
  }, [active]);
  useEffect(() => { if (open && !track) setNow(false); }, [open, track, setNow]);

  const toggleFull = () => { if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen().catch(() => undefined); };
  const plain = useMemo(() => (lyrics.state === 'ready' && !lines ? lyrics.plain : null), [lyrics, lines]);
  if (!open || !track) return null;
  const hidden = idle;
  const canFull = !!document.documentElement.requestFullscreen; // not on iPhones; the view already fills the screen there

  return (
    <div className={cn('bt-now fixed inset-x-0 top-0 z-[90] flex h-[100dvh] flex-col overflow-hidden bg-black text-white', hidden && 'cursor-none')} role="dialog" aria-modal="true" aria-label="Now playing" onMouseMove={wake} onTouchStart={wake} onClick={() => { if (saver) setSaver(false); else if (idle) wake(); }}>
      {cover && <div className="absolute inset-0 scale-125 bg-cover bg-center opacity-60 blur-3xl" style={{ backgroundImage: `url(${cover})` }} aria-hidden />}
      <div className="absolute inset-0 bg-black/40" aria-hidden />
      <header className={cn('relative z-10 flex items-center gap-2 p-3 pt-[max(0.75rem,env(safe-area-inset-top))] transition-opacity duration-500', hidden && 'pointer-events-none opacity-0')}>
        <button className="btn !border-0 !bg-white/10 !text-white" onClick={() => setNow(false)} aria-label="Close"><X size={18} /></button>
        <div className="ml-auto flex gap-2">
          <button className={cn('btn !border-0 !text-white', showLyrics && !saver ? '!bg-white/25' : '!bg-white/10')} aria-pressed={showLyrics} title="Lyrics (L)" onClick={pickLyrics}><Mic2 size={16} /><span className="max-sm:hidden">Lyrics</span></button>
          <button className={cn('btn !border-0 !text-white', saver ? '!bg-white/25' : '!bg-white/10')} aria-pressed={saver} title="Screensaver (S)" onClick={() => setSaver((x) => !x)}><Moon size={16} /><span className="max-sm:hidden">Screensaver</span></button>
          {canFull && <button className="btn !border-0 !bg-white/10 !text-white" title="Full screen" aria-label="Full screen" onClick={toggleFull}>{full ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button>}
        </div>
      </header>
      <main className={cn('relative z-10 flex min-h-0 flex-1 items-center justify-center gap-8 px-6 pb-4 max-md:flex-col max-md:gap-3 max-md:px-4 max-md:pb-2 md:gap-14 md:px-12', saver && 'justify-center')}>
        <div className={cn('shrink-0', saver ? 'bt-drift w-[min(78vmin,44rem)]' : showLyrics ? 'w-[min(30vh,62vw,22rem)] md:w-[min(46vh,28rem)]' : 'w-[min(50vh,calc(100vw-2rem),34rem)] md:w-[min(60vh,34rem)]')}>
          {cover ? <img src={cover} alt="" className="aspect-square w-full rounded-2xl object-cover shadow-2xl" draggable={false} /> : <div className="aspect-square w-full rounded-2xl bg-white/10" />}
          {!saver && <div className="mt-2 min-w-0 text-center md:mt-4 md:text-left"><div className="truncate text-2xl font-bold md:text-3xl">{track.title}</div>
            <div className="truncate text-base text-white/70"><ArtistLinks leads={track.leads} featured={track.featured} className="hover:underline" />{track.albumTitle && <> · <Link to={track.albumId ? `/albums/${track.albumId}` : '#'} onClick={() => setNow(false)} className="hover:underline">{track.albumTitle}</Link></>}</div></div>}
        </div>
        {showLyrics && !saver && (
          <div ref={listRef} className="relative min-h-0 w-full max-w-2xl flex-1 overflow-y-auto scroll-smooth py-[20vh] md:h-full md:py-[30vh] [mask-image:linear-gradient(to_bottom,transparent,black_18%,black_82%,transparent)]" aria-label="Lyrics">
            {lyrics.state === 'loading' && <p className="text-center text-white/60">Looking for lyrics…</p>}
            {(lyrics.state === 'none' || lyrics.state === 'error') && <p className="text-center text-white/60">{lyrics.message ?? 'No lyrics found for this track.'}</p>}
            {lyrics.state === 'ready' && lyrics.instrumental && !lines && !plain && <p className="text-center text-white/60">Instrumental.</p>}
            {lines && lines.map((l, i) => (
              <button key={i} data-line={i} className={cn('block w-full px-2 py-2 text-left text-2xl font-bold leading-[1.35] [overflow-wrap:anywhere] transition-all duration-300 md:text-4xl', i === active ? 'text-white' : i < active ? 'text-white/30' : 'text-white/45', !l.text && 'opacity-60')} onClick={() => v.seek(l.time)}>{l.text || '♪'}</button>))}
            {plain && <p className="whitespace-pre-wrap px-2 text-xl font-semibold leading-relaxed text-white/85 md:text-2xl">{plain}</p>}
            {lyrics.state === 'ready' && <p className="mt-8 text-center text-xs text-white/40">Lyrics from {lyrics.source}{lines ? ' · tap a line to jump to it' : ''}</p>}
            {lines && <div className="mt-2 flex items-center justify-center gap-2 text-xs text-white/60">
              <span>Timing</span>
              <button className="btn !border-0 !bg-white/10 !p-1 !text-white" aria-label="Lyrics later" title="Show lines later" onClick={() => setOffset(offset - 0.1)}><Minus size={12} /></button>
              <span className="w-12 text-center tabular-nums">{offset > 0 ? '+' : ''}{offset.toFixed(1)} s</span>
              <button className="btn !border-0 !bg-white/10 !p-1 !text-white" aria-label="Lyrics earlier" title="Show lines earlier" onClick={() => setOffset(offset + 0.1)}><Plus size={12} /></button>
            </div>}
          </div>)}
      </main>
      {saver && <div className="pointer-events-none absolute bottom-6 left-6 z-10 max-w-[60vw] opacity-80"><div className="truncate text-lg font-semibold">{track.title}</div><div className="truncate text-sm text-white/70">{track.artistName}</div></div>}
      <footer className={cn('relative z-10 mx-auto flex w-full max-w-3xl shrink-0 flex-col gap-2 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] transition-opacity duration-500', (hidden || saver) && 'pointer-events-none opacity-0')}>
        <div className="flex items-center gap-2 text-xs tabular-nums text-white/70">
          <span className="w-10 text-right">{fmtTime(v.time)}</span>
          <input type="range" aria-label="Seek" className="bt-range bt-hit flex-1" style={{ '--p': `${v.duration > 0 ? Math.min(100, (v.time / v.duration) * 100) : 0}%` } as React.CSSProperties} min={0} max={v.duration || 1} step={0.1} value={v.time} onChange={(e) => v.seek(Number(e.target.value))} />
          <span className="w-10">{fmtTime(v.duration)}</span>
        </div>
        <div className="flex items-center justify-center gap-3">
          <button className="btn !border-0 !bg-white/10 !text-white" title="Previous" onClick={v.prev}><SkipBack size={20} /></button>
          <button className="btn !rounded-full !border-0 !bg-white !p-3.5 !text-black" title={v.playing ? 'Pause' : 'Play'} onClick={v.toggle}>{v.loading ? <Loader2 size={22} className="animate-spin" /> : v.playing ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" />}</button>
          <button className="btn !border-0 !bg-white/10 !text-white" title="Next" onClick={v.next}><SkipForward size={20} /></button>
        </div>
      </footer>
    </div>
  );
}
