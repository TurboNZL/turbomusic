import { haptic } from '../lib/haptics.ts';
import { ThemedSelect } from '../components/ThemedSelect.tsx';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Play, Equal, SkipForward, Undo2, Volume2, ChevronsUp } from 'lucide-react';
import { STRONG_WEIGHT } from '@turbomusic/core';
import type { VoteData } from '@turbomusic/core';
import { useLibraryLive, type Track } from '../lib/derive.ts';
import { buildListens } from '../lib/listens.ts';
import { heardTrackIds, onlyHeard } from '../lib/heard.ts';
import { useEditor } from '../lib/editor.ts';
import { pairLacksAudio, pickPair, rankPool, tierPool, TIERS, type Tier, type TierChoice } from '../lib/pairing.ts';
import { useStore } from '../lib/store.ts';
import { EloQuestions } from '../components/EloQuestions.tsx';
import { usePreviews } from '../lib/usePreviews.ts';
import { fadeOut, loadPreview, middle, release, SNIPPET_MS, type Preview } from '../lib/preview.ts';
import { usePlayer } from '../lib/player.ts';
import { Cover } from '../components/Cover.tsx';
import { Rating } from '../components/Rating.tsx';
import { cn } from '../lib/cn.ts';
import { cssMs } from '../lib/presence.ts';
import { useSearchParams } from 'react-router-dom';
import { RankCard } from '../components/RankCard.tsx';
import { PlaceRank } from '../components/PlaceRank.tsx';
import { useMenu } from '../components/Menu.tsx';
import { useTrackMenuItems } from '../components/TrackMenu.tsx';

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
      // offsetTop, not getBoundingClientRect: the page's entrance animation moves it with a transform, which made the first measurement wrong and the cards jump when it ended
      let top = 0; for (let n: HTMLElement | null = el; n && n !== main; n = n.offsetParent as HTMLElement | null) top += n.offsetTop;
      const mainBox = main.getBoundingClientRect();
      const pageTop = mainBox.top + top - main.scrollTop;
      // the page ends just above whatever floats over the bottom of the screen (player bar, tab bar, dock): measured, not guessed from the area's padding, which reserves more room than those bars use
      let barTop = mainBox.bottom;
      for (const bar of document.querySelectorAll('.bt-player, .bt-tabbar, .bt-dock')) { const r = bar.getBoundingClientRect(); if (r.height > 0 && r.bottom > 0 && r.top < barTop) barTop = r.top; }
      setHeight(Math.max(200, Math.floor(barTop - pageTop - 10)));
    };
    const poll = setInterval(measure, 500); // the player bar appears and goes without the area itself resizing
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(main);
    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);
    return () => { clearInterval(poll); ro.disconnect(); window.removeEventListener('resize', measure); window.visualViewport?.removeEventListener('resize', measure); };
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

let keptPair: [string, string] | null = null;

function DuelRank() {
  const lib = useLibraryLive();
  const edit = useEditor((s) => s.open);
  const menu = useMenu();
  const trackItems = useTrackMenuItems();
  const put = useStore((s) => s.put);
  const removeRow = useStore((s) => s.remove);
  /** the next pick counts as "much better" (weight in the preference fit); switches itself off after one vote */
  const [strong, setStrong] = useState(false);
  /** the last vote of this visit, so a slip can be taken back (the pair comes back too) */
  const [last, setLast] = useState<{ id: string; pair: [string, string] } | null>(null);
  // the pair survives leaving the tab and coming back (kept in `keptPair`), so a visit does not hand out a new one
  const [pair, setPair] = useState<[string, string] | null>(() => (keptPair && lib.trackById.has(keptPair[0]) && lib.trackById.has(keptPair[1]) ? keptPair : null));
  useEffect(() => { keptPair = pair; }, [pair]);
  // ranking is about listening, so tracks with audio come first by default
  const [onlyPlayable, setOnlyPlayable] = useState(true);
  /** the tracks of the pair on screen whose preview is buffered and can start at once */
  const [ready, setReady] = useState<ReadonlySet<string>>(new Set());
  const [playing, setPlaying] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  /** the card that was just chosen (or both, for equal) while its animation plays */
  const [picked, setPicked] = useState<string | 'equal' | null>(null);
  const lastArrow = useRef<{ key: string; pair: string } | null>(null);
  /** both tracks of the pair are loaded as soon as the pair appears, so a preview starts at once */
  const previews = useRef(new Map<string, Promise<Preview | null>>());
  const loadSeq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const fit = useFitHeight();
  const compact = useCompact(fit.height);
  // which class of track both sides come from ("top 10% against top 10%"); kept for next time
  const [tier, setTierState] = useState<TierChoice>(() => { try { return { tier: 'any' as Tier, min: 7, max: 10, ...JSON.parse(localStorage.getItem('turbomusic.rankTier') ?? '{}') }; } catch { return { tier: 'any', min: 7, max: 10 }; } });
  // changing the band does not throw the pair on screen away: it applies from the next pair
  const setTier = (t: TierChoice) => { setTierState(t); try { localStorage.setItem('turbomusic.rankTier', JSON.stringify(t)); } catch { /* ignore */ } };
  // only tracks that were played at least once are ranked: ranking is about songs you know (the "Try something new" list on the home page is for the rest)
  const heard = useMemo(() => heardTrackIds(buildListens(lib)), [lib]);
  const { pool: knownPool, fellBack: noHistory } = useMemo(() => onlyHeard(lib.tracks.filter((t) => !t.versionOf), heard), [lib, heard]); // another recording of a song shares the main one's votes: it is not asked about twice
  const { pool: audioPool, fellBack } = useMemo(() => rankPool(knownPool, onlyPlayable), [knownPool, onlyPlayable]);
  const tiered = useMemo(() => tierPool(audioPool, tier), [audioPool, tier]);
  const tooFew = tiered.length < 2;
  const pool = tooFew ? audioPool : tiered; // a band with fewer than two tracks cannot make a pair: use everything and say so

  const volume = usePlayer((s) => s.volume);
  const playerPlaying = usePlayer((s) => s.playing);

  const stop = useCallback(() => {
    clearTimeout(timer.current);
    loadSeq.current++; // a preview still resolving its source must not start after this
    previews.current.forEach((p) => void p.then((v) => { if (v) void fadeOut(v.el); }));
    setPlaying(null);
  }, []);
  const next = useCallback(() => {
    stop();
    setPair((prev) => { const p = pickPair(pool, Math.random, prev ?? undefined); return p ? [p[0].id, p[1].id] : null; });
  }, [pool, stop]);
  useEffect(() => { if (!pair) next(); }, [pair, next]);
  useEffect(() => stop, [stop]);
  // a preview must not keep playing once the app is left (the phone's home button, another app, a locked screen)
  useEffect(() => { const f = () => { if (document.hidden) stop(); }; document.addEventListener('visibilitychange', f); window.addEventListener('pagehide', stop); return () => { document.removeEventListener('visibilitychange', f); window.removeEventListener('pagehide', stop); }; }, [stop]);
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
    const data: VoteData = { trackAId: pair[0], trackBId: pair[1], winnerId, isEqual, timestamp: Date.now(), ...(strong && !isEqual ? { weight: STRONG_WEIGHT } : {}) };
    const voteId = put('votes', data);
    setLast({ id: voteId, pair });
    haptic('confirm');
    setFlash(isEqual ? 'Marked equal' : `${strong ? 'Much better: ' : 'Voted for '}${lib.trackById.get(winnerId!)?.title}`);
    setStrong(false);
    setTimeout(() => setFlash(null), 1500);
    lastArrow.current = null;
    const wait = pickDelay();
    if (!wait) { setPair(null); return; }
    stop();
    setPicked(isEqual ? 'equal' : winnerId);
    setTimeout(() => { setPicked(null); setPair(null); }, wait);
  }, [pair, picked, put, lib, stop, strong]);
  const undo = () => {
    if (!last || picked) return;
    removeRow('votes', last.id);
    stop(); setPair(last.pair); setLast(null);
    setFlash('Vote taken back'); setTimeout(() => setFlash(null), 1500);
  };

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
      } else if (e.key.toLowerCase() === 'm') { setStrong((x) => !x); }
      else if (e.key.toLowerCase() === 'z' && last) { undo(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); vote(null, true); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (!picked) next(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pair, picked, vote, next, lib, last]); // eslint-disable-line react-hooks/exhaustive-deps

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

  if (lib.tracks.length < 2) return <div className="text-muted">Add at least two tracks to start ranking.</div>;

  return (
    <div ref={fit.ref} className="mx-auto flex max-w-4xl flex-col" style={{ height: fit.height ?? 'calc(100dvh - 16rem)' }}>
      <div className={cn('flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1', compact ? 'mb-1 text-xs' : 'mb-2 sm:mb-3')}>
        <h1 className={cn('mr-auto font-bold', compact ? 'sr-only' : 'text-xl max-sm:sr-only sm:text-2xl')}>Which is better?</h1>
        <ThemedSelect className="input !w-auto !py-1 text-sm" aria-label="Which tracks to compare" title="Which tracks to compare" value={tier.tier} onChange={(e) => setTier({ ...tier, tier: e.target.value as Tier })}>{TIERS.map((x) => <option key={x.id} value={x.id}>{x.id === 'any' ? 'Compare: anything' : x.label}</option>)}</ThemedSelect>
        {tier.tier === 'range' && <span className="flex items-center gap-1">
          <input type="number" min={0} max={10} step={0.5} className="input !w-16 !py-0.5" aria-label="Lowest rating" value={tier.min} onChange={(e) => setTier({ ...tier, min: Number(e.target.value) })} />–
          <input type="number" min={0} max={10} step={0.5} className="input !w-16 !py-0.5" aria-label="Highest rating" value={tier.max} onChange={(e) => setTier({ ...tier, max: Number(e.target.value) })} /></span>}
        <label className="flex items-center gap-1.5 text-sm text-muted"><input type="checkbox" checked={onlyPlayable} onChange={(e) => {
          setOnlyPlayable(e.target.checked);
          // the pair on screen stays unless it holds a track the filter now excludes
          if (e.target.checked && pairLacksAudio(pair, lib.trackById)) setPair(null);
        }} />With audio{onlyPlayable && fellBack ? ' (too few)' : ''}</label>
        <span className="text-sm text-muted tabular-nums">{lib.votes.length} votes{tier.tier !== 'any' && !compact ? (tooFew ? ' · too few in this band, using all' : ` · ${tiered.length} in this band`) : ''}</span>
        {noHistory && !compact && <span className="basis-full text-xs text-warn">Fewer than two tracks have been played yet, so every track is used.</span>}
      </div>
      {/* each card fills its share of the height that is left (on a phone they stack and share it), and lays itself out inside that space */}
      <div className={cn('grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[repeat(2,minmax(0,1fr))] sm:grid-cols-2 sm:grid-rows-[minmax(0,1fr)] sm:gap-4', compact ? 'gap-1.5' : 'gap-3')}>
        {[a, b].map((t, i) => t && (
          // the cover is the biggest thing on the card; the text and the button stay small. Swipe it either way to pick it.
          <RankCard key={t.id} t={t} compact={compact} playing={playing === t.id} onPreview={() => { if (!picked) snippet(t); }}
            fx={picked === t.id ? 'win' : picked === 'equal' ? 'equal' : picked ? 'lose' : null}
            swipe={{ dirs: 'both', right: 'Pick', onSwipe: () => vote(t.id) }}
            badge={<Rating track={t} size="sm" />}
            onStats={() => edit({ kind: 'track-details', id: t.id })}
            onMenu={menu.onContextMenu(trackItems(t, () => usePlayer.getState().play(t.id, [t.id], { type: 'search', id: 'Rank' })), t.title)}
            action={<button className="btn btn-accent shrink-0 !px-2.5 !py-1 text-xs" onClick={(e) => { e.stopPropagation(); vote(t.id); }}>{i === 0 ? '← ' : ''}This one{i === 1 ? ' →' : ''}</button>} />
        ))}
      </div>
      {menu.element}
      <div className={cn('flex shrink-0 flex-col items-center gap-1', compact ? 'mt-1' : 'mt-2 sm:mt-3')}>
        <div className="flex flex-nowrap justify-center gap-1.5">
          <button className="btn !px-2.5 !py-1 text-xs" onClick={() => vote(null, true)} title="Both are as good as each other. This is saved as a draw and moves both ratings towards each other."><Equal size={14} />Equal<span className="max-sm:hidden"> (↓)</span></button>
          <button className={cn('btn !px-2.5 !py-1 text-xs', strong && 'btn-accent')} aria-pressed={strong} onClick={() => setStrong((x) => !x)} title="Your next pick counts for more: use it when the difference is obvious to you (M)"><ChevronsUp size={14} />Much better<span className="max-sm:hidden"> next (M)</span></button>
          <button className={cn('btn btn-ghost !px-2.5 !py-1 text-xs', !last && 'invisible')} disabled={!last} tabIndex={last ? 0 : -1} onClick={undo} title="Take back your last vote and see that pair again (Z)"><Undo2 size={14} />Undo</button>
          <button className="btn btn-ghost !px-2.5 !py-1 text-xs" onClick={() => !picked && next()} title="Not sure, or you don't want to rank this pair. Nothing is saved; you just get a new pair."><SkipForward size={14} />Skip<span className="max-sm:hidden">, save nothing (↑)</span></button>
        </div>
        {/* one fixed line, whatever it says: a long title must never change the height under the cards, or they move when the next pair loads */}
        <div className={cn('h-4 w-full truncate text-center text-[11px] leading-4 text-good', compact && 'sr-only')} aria-live="polite">{flash ?? <span className="text-muted"><span className="hidden sm:inline">← or → once previews, twice picks that track. </span><span className="sm:hidden">Tap to preview, swipe to pick. </span>Equal = draw; Skip = nothing.</span>}</div>
      </div>
    </div>
  );
}

const MODE_KEY = 'turbomusic.rankMode';
type Mode = 'duel' | 'place' | 'albums' | 'triple' | 'quad' | 'odd' | 'benchmark' | 'love';
const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: 'duel', label: 'Head to head', hint: 'Two songs: which is better?' },
  { id: 'place', label: 'Place a song', hint: 'Find where one song you love belongs, by comparing it with a few others.' },
  { id: 'albums', label: 'Albums', hint: 'Two albums: which is better? A ranked album lifts the starting Elo of its tracks.' },
  { id: 'triple', label: 'Best of three', hint: 'Three close songs: pick your favourite, which settles two matches at once.' },
  { id: 'quad', label: 'Best of four', hint: 'Four close songs: pick your favourite, which settles three matches at once.' },
  { id: 'odd', label: 'Odd one out', hint: 'Three songs: which do you like least?' },
  { id: 'benchmark', label: 'Against your top 10%', hint: 'A song against the one at your top-10% line.' },
  { id: 'love', label: 'Gut check', hint: 'One song with almost no votes: love it or meh?' },
];
const loadMode = (): Mode => { try { const m = localStorage.getItem(MODE_KEY); return MODES.some((x) => x.id === m) ? (m as Mode) : 'duel'; } catch { return 'duel'; } };

/** The Rank page: choose how to rank (remembered), then answer. Head to head is the classic page; the others are the questions Home offers a taste of. */
export function VotePage() {
  const [params, setParams] = useSearchParams();
  const place = params.get('place') ?? undefined; // "Rank it against others" in a track's menu
  const [mode, setModeState] = useState<Mode>(() => (place ? 'place' : loadMode()));
  const setMode = (m: Mode) => { setModeState(m); if (params.has('place')) setParams({}, { replace: true }); try { localStorage.setItem(MODE_KEY, m); } catch { /* private mode */ } };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mx-auto mb-3 flex w-full max-w-4xl shrink-0 items-center gap-2 text-sm">
        <span className="text-muted">Rank by</span>
        <ThemedSelect className="input !w-auto !py-1" aria-label="How to rank" value={mode} onChange={(e) => setMode(e.target.value as Mode)}>{MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</ThemedSelect>
        <span className="min-w-0 truncate text-xs text-muted max-sm:hidden">{MODES.find((m) => m.id === mode)?.hint}</span>
      </div>
      {mode === 'duel' ? <DuelRank /> : mode === 'place' ? <PlaceRank key={place ?? 'pick'} initialId={place} /> : mode === 'albums' ? <AlbumRank /> : <div className="mx-auto w-full max-w-4xl"><EloQuestions key={mode} kind={mode} embedded /></div>}
    </div>
  );
}

/** Albums head to head. Votes are stored like track votes with `album: true`; the library ranks the albums with them and a ranked album lifts the starting Elo of its tracks. */
function AlbumRank() {
  const lib = useLibraryLive();
  const put = useStore((s) => s.put);
  const pool = useMemo(() => lib.albums.filter((a) => a.trackIds.length >= 3).map((a) => ({ id: a.id, elo: lib.albumRank.get(a.id)?.elo ?? 1000, comparisons: lib.albumRank.get(a.id)?.comparisons ?? 0, rating: a.rating ?? 0 })), [lib]);
  const [pair, setPair] = useState<[string, string] | null>(() => { const p = pickPair(pool, Math.random); return p ? [p[0].id, p[1].id] : null; });
  const next = (prev?: [string, string] | null) => { const p = pickPair(pool, Math.random, prev ?? undefined); setPair(p ? [p[0].id, p[1].id] : null); };
  // a few of each album's best songs are buffered, and "Hear a song" steps through them (15 s each), so the albums can be told apart by ear
  const choices = useMemo(() => (pair ?? []).map((id) => (lib.albumById.get(id)?.trackIds ?? []).map((t) => lib.trackById.get(t)).filter((t): t is Track => !!t?.file).sort((x, y) => y.effectiveRating - x.effectiveRating).slice(0, 4)), [pair, lib]);
  const previews = usePreviews(useMemo(() => choices.flat(), [choices]));
  const [heard, setHeard] = useState<(Track | undefined)[]>([]);
  const turn = useRef<Record<number, number>>({});
  useEffect(() => { setHeard([]); turn.current = {}; }, [pair]);
  const hear = (i: number) => {
    const list = choices[i] ?? [];
    if (!list.length) return;
    const cur = heard[i];
    if (cur && previews.playing === cur.id) { previews.stop(); return; }
    const t = list[(turn.current[i] ?? 0) % list.length];
    turn.current[i] = (turn.current[i] ?? 0) + 1;
    setHeard((h) => { const n = [...h]; n[i] = t; return n; });
    previews.toggle(t);
  };
  const fit = useFitHeight();
  if (!pair) return <p className="text-sm text-muted">You need at least two albums with three or more tracks to rank albums.</p>;
  const albums = pair.map((id) => lib.albumById.get(id)).filter((a): a is NonNullable<typeof a> => !!a);
  if (albums.length < 2) { queueMicrotask(() => next()); return null; }
  const answer = (winner: string | null) => { previews.stop(); put('votes', { trackAId: pair[0], trackBId: pair[1], winnerId: winner, isEqual: winner === null, album: true, timestamp: Date.now() }); haptic('confirm'); next(pair); };
  return (
    // the same cards as head to head, filling the screen: tap to hear a song from the album, swipe any way to pick it (nothing here scrolls)
    <div ref={fit.ref} className="mx-auto flex max-w-4xl flex-col" style={{ height: fit.height ?? 'calc(100dvh - 16rem)' }}>
      <div className="mb-2 shrink-0 text-sm text-muted">Which album is better? <span className="max-sm:hidden">A high album gives its tracks a slightly higher starting rating.</span></div>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[repeat(2,minmax(0,1fr))] gap-3 sm:grid-cols-2 sm:grid-rows-[minmax(0,1fr)] sm:gap-4">
        {albums.map((a, i) => (
          <RankCard key={a.id} t={{ cover: a.cover, title: a.title, albumTitle: a.title, file: choices[i].length ? 'x' : null }}
            sub={`${a.artistName} · ${a.trackIds.length} tracks${a.rating != null ? ` · avg ${a.rating.toFixed(1)}` : ''}`}
            playing={!!previews.playing && heard[i]?.id === previews.playing} onPreview={() => hear(i)}
            swipe={{ dirs: 'both', right: 'Pick', onSwipe: () => answer(a.id) }}
            action={<button className="btn btn-accent shrink-0 !px-2.5 !py-1 text-xs" onClick={(e) => { e.stopPropagation(); answer(a.id); }}>This one</button>} />
        ))}
      </div>
      <div className="mt-2 flex shrink-0 flex-col items-center gap-1">
        <div className="flex gap-1.5"><button className="btn !px-2.5 !py-1 text-xs" onClick={() => answer(null)}><Equal size={14} />Equal</button><button className="btn btn-ghost !px-2.5 !py-1 text-xs" onClick={() => next(pair)}><SkipForward size={14} />Skip</button></div>
        <div className="text-[11px] text-muted">Tap a card to hear a song from it. Swipe it to pick it.</div>
      </div>
    </div>
  );
}
