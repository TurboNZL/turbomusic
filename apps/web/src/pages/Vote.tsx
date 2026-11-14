import { haptic } from '../lib/haptics.ts';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, Check, Loader2, Pause, Play, Equal, SkipForward, Volume2 } from 'lucide-react';
import type { VoteData } from '@turbomusic/core';
import { useLibraryLive, type Track } from '../lib/derive.ts';
import { buildListens } from '../lib/listens.ts';
import { heardTrackIds, onlyHeard } from '../lib/heard.ts';
import { useEditor } from '../lib/editor.ts';
import { pairLacksAudio, pickPair, rankPool, tierPool, TIERS, type Tier, type TierChoice } from '../lib/pairing.ts';
import { useStore } from '../lib/store.ts';
import { loadPreview, middle, release, SNIPPET_MS, type Preview } from '../lib/preview.ts';
import { usePlayer } from '../lib/player.ts';
import { Cover } from '../components/Cover.tsx';
import { Rating } from '../components/Rating.tsx';
import { cn } from '../lib/cn.ts';
import { cssMs } from '../lib/presence.ts';
import { ArtistLinks } from '../components/ArtistLinks.tsx';

/** how long the chosen card plays its "picked" animation before the next pair appears (0 where the UI style has no motion) */
const pickDelay = () => cssMs('--vote-ms', 440);

/**
 * The height left for the page inside the scrolling content area, so the two cards and the buttons always fit on
 * screen (on a phone the lower card used to slide under the player bar). Re-measured when the window or the player changes.
 */
function useFitHeight() {
  // a callback ref: the page can mount its root later (it shows a message until the library has two tracks)
  const [el, ref] = useState<HTMLDivElement | null>(null);
  const [height, setHeight] = useState<number | undefined>();
  useLayoutEffect(() => {
    const main = el?.closest('main');
    if (!el || !main) return;
    const measure = () => {
      const css = getComputedStyle(main);
      // offsetTop, not getBoundingClientRect: the page's entrance animation moves it with a transform, which made the first measurement wrong and the cards jump when it ended
      let top = 0; for (let n: HTMLElement | null = el; n && n !== main; n = n.offsetParent as HTMLElement | null) top += n.offsetTop;
      const below = parseFloat(css.paddingBottom) + 16; // whatever floats over the bottom of the area, and the page padding
      setHeight(Math.max(200, Math.floor(main.clientHeight - top - below)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(main);
    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); window.visualViewport?.removeEventListener('resize', measure); };
  }, [el]);
  return { ref, height };
}

/**
 * A very small window (a split screen on a phone, a narrow window): about square and little more than a couple of hundred pixels each way.
 * Everything that is not the two tracks and the buttons is trimmed, so a card is just a cover, a title and "This one".
 */
function useCompact(height: number | undefined) {
  const [w, setW] = useState(() => window.innerWidth);
  useEffect(() => { const f = () => setW(window.innerWidth); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f); }, []);
  return w < 360 || (height !== undefined && height < 440);
}

export function VotePage() {
  const lib = useLibraryLive();
  const edit = useEditor((s) => s.open);
  const put = useStore((s) => s.put);
  const [pair, setPair] = useState<[string, string] | null>(null);
  // ranking is about listening, so tracks with audio come first by default
  const [onlyPlayable, setOnlyPlayable] = useState(true);
  /** the tracks of the pair on screen whose preview is buffered and can start at once */
  const [ready, setReady] = useState<ReadonlySet<string>>(new Set());
  const [playing, setPlaying] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  /** the card that was just chosen (or both, for equal) while its animation plays */
  const [picked, setPicked] = useState<string | 'equal' | null>(null);
  /** a finger dragging a card sideways: swiping a card right picks it (phones; replaces tapping twice) */
  const [drag, setDrag] = useState<{ id: string; dx: number; settle?: boolean } | null>(null);
  const finger = useRef<{ id: string; x: number; y: number; w: number; locked: boolean } | null>(null);
  const swallowClick = useRef(false);
  const lastArrow = useRef<{ key: string; pair: string } | null>(null);
  /** both tracks of the pair are loaded as soon as the pair appears, so a preview starts at once */
  const previews = useRef(new Map<string, Promise<Preview | null>>());
  const loadSeq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const fit = useFitHeight();
  const compact = useCompact(fit.height);
  // which class of track both sides come from ("top 10% against top 10%"); kept for next time
  const [tier, setTierState] = useState<TierChoice>(() => { try { return { tier: 'any' as Tier, min: 7, max: 10, ...JSON.parse(localStorage.getItem('turbomusic.rankTier') ?? '{}') }; } catch { return { tier: 'any', min: 7, max: 10 }; } });
  const setTier = (t: TierChoice) => { setTierState(t); setPair(null); try { localStorage.setItem('turbomusic.rankTier', JSON.stringify(t)); } catch { /* ignore */ } };
  // only tracks that were played at least once are ranked: ranking is about songs you know (the "Try something new" list on the home page is for the rest)
  const heard = useMemo(() => heardTrackIds(buildListens(lib)), [lib]);
  const { pool: knownPool, fellBack: noHistory } = useMemo(() => onlyHeard(lib.tracks, heard), [lib, heard]);
  const { pool: audioPool, fellBack } = useMemo(() => rankPool(knownPool, onlyPlayable), [knownPool, onlyPlayable]);
  const tiered = useMemo(() => tierPool(audioPool, tier), [audioPool, tier]);
  const tooFew = tiered.length < 2;
  const pool = tooFew ? audioPool : tiered; // a band with fewer than two tracks cannot make a pair: use everything and say so

  const volume = usePlayer((s) => s.volume);
  const playerPlaying = usePlayer((s) => s.playing);

  const stop = useCallback(() => {
    clearTimeout(timer.current);
    loadSeq.current++; // a preview still resolving its source must not start after this
    previews.current.forEach((p) => void p.then((v) => v?.el.pause()));
    setPlaying(null);
  }, []);
  const next = useCallback(() => {
    stop();
    setPair((prev) => { const p = pickPair(pool, Math.random, prev ?? undefined); return p ? [p[0].id, p[1].id] : null; });
  }, [pool, stop]);
  useEffect(() => { if (!pair) next(); }, [pair, next]);
  useEffect(() => stop, [stop]);
  // the previews follow the player's volume slider, also while one is playing
  useEffect(() => { previews.current.forEach((p) => void p.then((v) => { if (v) v.el.volume = volume; })); }, [volume]);
  // starting the main player (play button, a track in a list) ends a preview, so the two never overlap
  useEffect(() => { if (playerPlaying) stop(); }, [playerPlaying, stop]);

  const [a, b] = pair ? [lib.trackById.get(pair[0]), lib.trackById.get(pair[1])] : [];

  // load both tracks of the new pair now (and let go of the last pair's)
  const pairKey = pair?.join('|') ?? '';
  useEffect(() => {
    const map = previews.current;
    setReady(new Set());
    if (!pair) return;
    let live = true;
    for (const id of pair) {
      const t = lib.trackById.get(id);
      if (!t?.file) continue;
      const p = loadPreview(t.file, usePlayer.getState().volume);
      map.set(id, p);
      void p.then((v) => { if (v && live) setReady((r) => new Set(r).add(id)); });
    }
    return () => { live = false; map.forEach((p) => void p.then(release)); map.clear(); };
  }, [pairKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const vote = useCallback((winnerId: string | null, isEqual = false) => {
    if (!pair || picked) return;
    const data: VoteData = { trackAId: pair[0], trackBId: pair[1], winnerId, isEqual, timestamp: Date.now() };
    put('votes', data);
    haptic('confirm');
    setFlash(isEqual ? 'Marked equal' : `Voted for ${lib.trackById.get(winnerId!)?.title}`);
    setTimeout(() => setFlash(null), 1500);
    lastArrow.current = null;
    const wait = pickDelay();
    if (!wait) { setPair(null); return; }
    stop();
    setPicked(isEqual ? 'equal' : winnerId);
    setTimeout(() => { setPicked(null); setPair(null); }, wait);
  }, [pair, picked, put, lib, stop]);

  /** Starts a preview (never stops one: the key that previews is also the first half of "pick") */
  const previewRef = useRef<(t: Track) => void>(() => undefined);

  // ← / → once previews that side, the same arrow again picks it; the other arrow starts over. ↑ skips, ↓ is equal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !pair || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const id = pair[e.key === 'ArrowLeft' ? 0 : 1];
        const key = pair.join('|');
        if (lastArrow.current?.key === e.key && lastArrow.current.pair === key) vote(id);
        else {
          lastArrow.current = { key: e.key, pair: key };
          const t = lib.trackById.get(id);
          if (t) previewRef.current(t);
        }
      } else if (e.key === 'ArrowDown') { e.preventDefault(); vote(null, true); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (!picked) next(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pair, picked, vote, next, lib]);

  /** Play 15 s from the middle of the track, as the original cleanup page did. The music player is paused meanwhile. */
  function snippet(t: Track, onlyStart = false) {
    if (playing === t.id) return onlyStart ? undefined : stop();
    const loading = previews.current.get(t.id);
    if (!t.file || !loading) return;
    stop();
    usePlayer.getState().pause();
    setPlaying(t.id);
    const seq = ++loadSeq.current;
    void loading.then((p) => {
      if (!p || seq !== loadSeq.current) return;
      p.el.volume = usePlayer.getState().volume;
      p.el.currentTime = middle(p.el);
      void p.el.play();
      timer.current = setTimeout(stop, SNIPPET_MS);
    });
  }

  previewRef.current = (t) => snippet(t, true);

  const swipeHandlers = (t: Track) => ({
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.pointerType !== 'touch' || picked || (e.target as Element).closest('a, button, input')) return;
      finger.current = { id: t.id, x: e.clientX, y: e.clientY, w: e.currentTarget.offsetWidth, locked: false };
    },
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
      const f = finger.current;
      if (!f || f.id !== t.id) return;
      const dx = e.clientX - f.x, dy = e.clientY - f.y;
      if (!f.locked) {
        if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { finger.current = null; return; } // the page is being scrolled
        if (Math.abs(dx) < 10) return;
        f.locked = true;
        e.currentTarget.setPointerCapture(e.pointerId);
      }
      setDrag({ id: t.id, dx: Math.max(0, dx) });
    },
    onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => {
      const f = finger.current; finger.current = null;
      if (!f?.locked || f.id !== t.id) return;
      swallowClick.current = true; // the tap that ends a drag is not a tap on the card
      setTimeout(() => { swallowClick.current = false; }, 0);
      if (e.clientX - f.x >= Math.max(90, f.w * 0.3)) { setDrag(null); vote(t.id); } else setDrag({ id: t.id, dx: 0, settle: true });
    },
    onPointerCancel: () => { finger.current = null; setDrag(null); },
  });

  if (lib.tracks.length < 2) return <div className="text-muted">Add at least two tracks to start ranking.</div>;

  return (
    <div ref={fit.ref} className="mx-auto flex max-w-4xl flex-col" style={{ height: fit.height ?? 'calc(100dvh - 16rem)' }}>
      <div className={cn('flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1', compact ? 'mb-1 text-xs' : 'mb-3')}>
        <h1 className={cn('mr-auto font-bold', compact ? 'sr-only' : 'text-xl sm:text-2xl')}>Which is better?</h1>
        <label className="flex items-center gap-1.5 text-sm text-muted"><input type="checkbox" checked={onlyPlayable} onChange={(e) => {
          setOnlyPlayable(e.target.checked);
          // the pair on screen stays unless it holds a track the filter now excludes
          if (e.target.checked && pairLacksAudio(pair, lib.trackById)) setPair(null);
        }} />{compact ? 'With audio' : 'Only tracks with audio'}{onlyPlayable && fellBack ? ' (too few)' : ''}</label>
        <span className="text-sm text-muted tabular-nums">{lib.votes.length} votes</span>
        {noHistory && !compact && <span className="basis-full text-xs text-warn">Fewer than two tracks have been played yet, so every track is used. Ranking normally covers only tracks you have heard.</span>}
      </div>
      {compact ? <select className="input mb-1 shrink-0 !py-0.5 text-xs" aria-label="Which tracks to compare" value={tier.tier} onChange={(e) => setTier({ ...tier, tier: e.target.value as Tier })}>{TIERS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select>
      : <div className="mb-3 flex shrink-0 flex-wrap items-center gap-1.5 text-sm" role="group" aria-label="Which tracks to compare">
        <span className="mr-1 text-muted">Compare</span>
        {TIERS.map((x) => <button key={x.id} type="button" title={x.hint} aria-pressed={tier.tier === x.id} onClick={() => setTier({ ...tier, tier: x.id })}
          className={cn('chip cursor-pointer', tier.tier === x.id ? 'bg-accent text-accent-fg' : 'hover:brightness-125')}>{x.label}</button>)}
        {tier.tier === 'range' && <span className="flex items-center gap-1">
          <input type="number" min={0} max={10} step={0.5} className="input !w-16 !py-0.5" aria-label="Lowest rating" value={tier.min} onChange={(e) => setTier({ ...tier, min: Number(e.target.value) })} />–
          <input type="number" min={0} max={10} step={0.5} className="input !w-16 !py-0.5" aria-label="Highest rating" value={tier.max} onChange={(e) => setTier({ ...tier, max: Number(e.target.value) })} /></span>}
        <span className="ml-auto text-xs text-muted">{tier.tier === 'any' ? '' : tooFew ? 'Fewer than two tracks fit: using all' : `${tiered.length} tracks in this band`}</span>
      </div>}
      {/* each card fills its share of the height that is left (on a phone they stack and share it), and lays itself out inside that space */}
      <div className={cn('grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[repeat(2,minmax(0,1fr))] sm:grid-cols-2 sm:grid-rows-[minmax(0,1fr)] sm:gap-4', compact ? 'gap-1.5' : 'gap-3')}>
        {[a, b].map((t, i) => t && (
          <div key={t.id} role="button" tabIndex={0} aria-pressed={playing === t.id} aria-label={`${playing === t.id ? 'Stop preview of' : 'Preview'} ${t.title}`}
            onClick={(e) => { if (swallowClick.current || (e.target as Element).closest('a, button, input')) return; if (!picked) snippet(t); }} {...swipeHandlers(t)}
            style={{ touchAction: 'pan-y', ...(drag?.id === t.id ? { transform: `translateX(${drag.dx}px)`, transition: drag.settle ? 'transform 200ms ease-out' : 'none' } : null) }}
            onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); if (!picked) snippet(t); } }}
            data-selected={playing === t.id || undefined} className={cn('card bt-sel vote-card flex min-h-0 min-w-0 cursor-pointer select-none flex-row items-center overflow-hidden max-sm:[container-type:size] sm:flex-col',
              compact ? 'gap-2 !p-1.5 sm:gap-1' : 'gap-3 p-3 sm:gap-2 sm:p-4',
              !t.file && 'cursor-default',
              picked === t.id && 'bt-vote-win', picked && picked !== t.id && picked !== 'equal' && 'bt-vote-lose', picked === 'equal' && 'bt-vote-equal')}>
            {/* a phone: a square cover as tall as the card allows (never more than 40% of its width) beside the text; wider screens give the cover all the room that is left */}
            <div className="flex shrink-0 items-center justify-center max-sm:[--s:min(40cqw,calc(100cqh-1.5rem))] max-sm:[height:var(--s)] max-sm:[width:var(--s)] sm:min-h-0 sm:w-full sm:flex-1 sm:[container-type:size]">
              <div className="relative aspect-square max-sm:h-full max-sm:w-full sm:h-auto sm:[width:min(100cqw,100cqh)]">
                <Cover hash={t.cover} seed={t.albumTitle ?? t.title} className="h-full w-full" />
                {playing === t.id && <span className="absolute inset-0 flex items-center justify-center rounded-theme bg-black/40 text-white"><Volume2 className="animate-pulse" size={26} /></span>}
                {drag?.id === t.id && drag.dx > 0 && <span className="absolute inset-0 flex items-center justify-center rounded-theme bg-accent/45 text-accent-fg" style={{ opacity: Math.min(1, drag.dx / 140) }}><Check size={44} strokeWidth={3} /></span>}
                {picked === t.id && <span className="absolute inset-0 flex items-center justify-center rounded-theme bg-accent/45 text-accent-fg"><Check className="bt-vote-check" size={44} strokeWidth={3} /></span>}
              </div>
            </div>
            <div className={cn('flex min-w-0 flex-1 justify-center', compact ? 'flex-row items-center gap-1.5' : 'flex-col gap-1.5 sm:w-full sm:flex-none sm:items-center')}>
              <div className={cn('min-w-0 text-left', compact ? 'flex-1' : 'sm:text-center')}><div className={cn('min-w-0 break-words font-semibold [overflow-wrap:anywhere]', compact ? 'truncate text-sm' : 'line-clamp-2 text-base sm:text-lg')}>{t.title}</div>
                <div className={cn('min-w-0 break-words text-muted [overflow-wrap:anywhere]', compact ? 'truncate text-xs' : 'line-clamp-2 text-sm')}><ArtistLinks leads={t.leads} featured={t.featured} />{t.albumTitle && ` · ${t.albumTitle}`}</div></div>
              <div className={cn('flex min-w-0 items-center gap-2 sm:justify-center', compact ? 'shrink-0' : 'flex-wrap')}>
                {!compact && <Rating track={t} />}
                <button type="button" className="btn btn-ghost !p-1.5" title="Stats" aria-label={`Stats for ${t.title}`} onClick={(e) => { e.stopPropagation(); edit({ kind: 'track-details', id: t.id }); }}><BarChart3 size={14} /></button>
              </div>
              <div className={cn('text-xs text-muted sm:text-center max-sm:[@container(max-height:11.5rem)]:hidden', compact && 'hidden')} aria-hidden>{!t.file ? 'No audio yet' : playing === t.id ? <span className="inline-flex items-center gap-1"><Pause size={11} />Tap to stop</span> : <span className="inline-flex items-center gap-1">{ready.has(t.id) ? <><Play size={11} />Tap to preview 15 s</> : <><Loader2 size={11} className="animate-spin" />Loading preview…</>}</span>}</div>
              <button className={cn('btn btn-accent min-w-0 text-sm', compact ? 'shrink-0 !px-2 !py-0.5 text-xs' : 'w-full !px-3 !py-1.5 sm:w-auto sm:!px-4')} onClick={(e) => { e.stopPropagation(); vote(t.id); }}>{i === 0 ? '← ' : ''}This one{i === 1 ? ' →' : ''}</button>
            </div>
          </div>
        ))}
      </div>
      <div className={cn('flex shrink-0 flex-col items-center gap-1.5', compact ? 'mt-1.5' : 'mt-3')}>
        <div className="flex flex-wrap justify-center gap-2">
          <button className="btn" onClick={() => vote(null, true)} title="Both are as good as each other. This is saved as a draw and moves both ratings towards each other."><Equal size={16} />{compact ? 'Equal' : 'They’re equal (↓)'}</button>
          <button className="btn btn-ghost" onClick={() => !picked && next()} title="Not sure, or you don't want to rank this pair. Nothing is saved; you just get a new pair."><SkipForward size={16} />{compact ? 'Skip' : 'Skip, save nothing (↑)'}</button>
        </div>
        <div className={cn('min-h-4 text-center text-xs text-good', compact && 'sr-only')} aria-live="polite">{flash ?? <span className="text-muted"><span className="hidden sm:inline">← or → once previews, twice picks that track. </span><span className="sm:hidden">Tap a card to preview, swipe it right to pick it. </span>Equal records a draw. Skip records nothing.</span>}</div>
      </div>
    </div>
  );
}
