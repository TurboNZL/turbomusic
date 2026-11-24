import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, Equal, RefreshCw, SkipForward, ThumbsDown, ThumbsUp } from 'lucide-react';
import { useLibraryLive, type Track } from '../lib/derive.ts';
import { buildListens } from '../lib/listens.ts';
import { heardTrackIds, onlyHeard } from '../lib/heard.ts';
import { useStore } from '../lib/store.ts';
import { makeQuestion, nextQuestion, votesFor, type Q, type Question } from '../lib/questions.ts';
import { usePreviews } from '../lib/usePreviews.ts';
import { RankCard, type SwipeSpec } from './RankCard.tsx';
import { Rating } from './Rating.tsx';
import { useEditor } from '../lib/editor.ts';
import { useMenu } from './Menu.tsx';
import { useTrackMenuItems } from './TrackMenu.tsx';
import { usePlayer } from '../lib/player.ts';
import { cn } from '../lib/cn.ts';
import { cssMs } from '../lib/presence.ts';
import { haptic } from '../lib/haptics.ts';

const LABEL: Record<Question['kind'], string> = { duel: 'Head to head', triple: 'Best of three', quad: 'Best of four', odd: 'Odd one out', benchmark: 'Against your top 10%', love: 'Gut check' };
const OPEN_KEY = 'turbomusic.eloQuestionOpen';
/** the question on screen survives leaving the home page and coming back */
let kept: Question | null = null;
const wasOpen = () => { try { return localStorage.getItem(OPEN_KEY) === '1'; } catch { return false; } };

/**
 * Home: a question about the ranking that is worth answering (lib/questions.ts), kept closed until asked for so it never takes over
 * the page. Open, it shows the tracks the way the Rank page does: tap a cover to hear 15 s, then answer.
 */
export function EloQuestions({ kind: fixedKind, embedded = false }: { kind?: Question['kind']; embedded?: boolean } = {}) {
  const lib = useLibraryLive();
  const put = useStore((s) => s.put);
  const edit = useEditor((st) => st.open);
  const menu = useMenu();
  const trackItems = useTrackMenuItems();
  const [open, setOpen] = useState(embedded ? true : wasOpen);
  // one kind only (the Rank page's modes) or a mix (home): the question to ask next
  const ask = (pool: Q[], prev?: Question['kind']) => (fixedKind ? makeQuestion(pool, fixedKind) ?? nextQuestion(pool, prev) : nextQuestion(pool, prev));
  // only tracks that were played at least once get asked about (the rest are on the home page's "Try something new")
  const pool = useMemo(() => onlyHeard(lib.tracks.filter((t) => t.file && !t.versionOf), heardTrackIds(buildListens(lib))).pool.map((t) => ({ id: t.id, elo: t.elo, comparisons: t.comparisons, rating: t.rating })), [lib]);
  const [q, setQ] = useState<Question | null>(() => (!fixedKind && kept) || ask(pool));
  useEffect(() => { if (!fixedKind) kept = q; }, [q, fixedKind]);
  const [answered, setAnswered] = useState(0);
  const [settle, setSettle] = useState<string | null>(null);
  // the library may still be loading when this mounts: ask again once there is something to ask about
  useEffect(() => { if (!q && pool.length >= 2) setQ(ask(pool)); }, [q, pool]); // eslint-disable-line react-hooks/exhaustive-deps
  const T = (id: string) => lib.trackById.get(id);
  const tracks = (!q ? [] : q.kind === 'duel' ? [T(q.a), T(q.b)] : q.kind === 'triple' || q.kind === 'quad' || q.kind === 'odd' ? q.ids.map(T) : q.kind === 'benchmark' ? [T(q.ref), T(q.id)] : [T(q.id)]).filter((t): t is Track => !!t);
  const preview = usePreviews(tracks, open && !!q);
  const toggle = () => { setOpen((o) => { try { localStorage.setItem(OPEN_KEY, o ? '0' : '1'); } catch { /* ignore */ } return !o; }); preview.stop(); };
  if (!q || tracks.length === 0) return null;

  const next = (prev?: Question['kind']) => { preview.stop(); setSettle(null); setQ(ask(pool, prev)); };
  // the answer is saved at once; the cards play their "picked" motion (as on the Rank page) before the next question replaces them
  const answer = (a: string) => {
    if (settle) return;
    for (const v of votesFor(q, a)) put('votes', v);
    if (a !== 'skip') { setAnswered((n) => n + 1); haptic('confirm'); }
    const wait = a === 'skip' ? 0 : cssMs('--vote-ms', 440);
    if (!wait) { next(q.kind); return; }
    preview.stop();
    setSettle(a);
    setTimeout(() => next(q.kind), wait);
  };
  /** the motion a card plays while the answer settles */
  const fxOf = (id: string, role?: 'ref' | 'challenger'): 'win' | 'lose' | 'equal' | 'down' | null => {
    if (!settle) return null;
    if (settle === 'equal') return 'equal';
    if (q.kind === 'benchmark') return (settle === 'yes') === (role === 'challenger') ? 'win' : 'lose';
    if (q.kind === 'love') return settle === 'yes' ? 'win' : 'down';
    if (q.kind === 'odd') return id === settle ? 'down' : null;
    return id === settle ? 'win' : 'lose';
  };
  /** one card, the same for every kind of question: big cover, small text, one small button, swipe to answer where that makes sense (not on a grid of four) */
  const card = (t: Track, o: { wide?: boolean; label?: string; swipe?: SwipeSpec | null; on?: () => void; fx?: ReturnType<typeof fxOf>; badge?: React.ReactNode; accent?: boolean; action?: React.ReactNode; tone?: 'bad' } = {}) => (
    <RankCard key={t.id} t={t} playing={preview.playing === t.id} onPreview={() => preview.toggle(t)} fx={o.fx ?? fxOf(t.id)} swipe={o.swipe} accent={o.accent} className={o.wide ? 'h-[30dvh] min-h-[11rem] sm:aspect-[4/5] sm:h-auto' : 'aspect-[4/5]'}
      badge={o.badge ?? <Rating track={t} size="sm" />} onStats={() => edit({ kind: 'track-details', id: t.id })}
      onMenu={menu.onContextMenu(trackItems(t, () => usePlayer.getState().play(t.id, [t.id], { type: 'search', id: 'Sharpen' })), t.title)}
      action={o.action ?? (o.label === 'Like least'
        ? <button className="btn shrink-0 !px-2.5 !py-1 text-xs" onClick={(e) => { e.stopPropagation(); (o.on ?? (() => answer(t.id)))(); }}><ThumbsDown size={13} /><span className="rk-lbl">Least</span></button>
        : <button className="btn btn-accent shrink-0 !px-2.5 !py-1 text-xs" onClick={(e) => { e.stopPropagation(); (o.on ?? (() => answer(t.id)))(); }}><Check size={13} /><span className="rk-lbl">{o.label ?? 'This one'}</span></button>)} />
  );
  const pickSwipe = (on: () => void, tone?: 'bad'): SwipeSpec => ({ dirs: 'both', right: tone ? 'Least' : 'Pick', tone: tone ?? 'pick', onSwipe: on });

  return (
    <section className={cn(!embedded && 'card')} aria-label="Ranking question">
      {!embedded && <button type="button" className="flex w-full items-center gap-2 px-4 py-3 text-left" aria-expanded={open} onClick={toggle}>
        <h2 className="font-semibold">Sharpen your ranking</h2>
        <span className="chip">{LABEL[q.kind]}</span>
        <span className="ml-auto text-xs text-muted">{answered ? `${answered} answered` : open ? '' : 'one quick question'}</span>
        <ChevronDown size={16} className={cn('shrink-0 text-muted transition-transform', open && 'rotate-180')} />
      </button>}
      {open && <div className={cn('space-y-3', !embedded && 'px-4 pb-4')}>
        <p className="text-sm text-muted">{q.why}</p>
        {q.kind === 'duel' && <div className="mx-auto grid max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2">{tracks.map((t) => card(t, { wide: true, swipe: pickSwipe(() => answer(t.id)) }))}</div>}
        {q.kind === 'triple' && <div className="mx-auto grid max-w-3xl grid-cols-2 gap-3 sm:grid-cols-3">{tracks.map((t) => card(t, { label: 'Best', swipe: pickSwipe(() => answer(t.id)) }))}</div>}
        {/* a grid of four is a grid, not a stack of cards: no swiping here, tap a card to hear it and press its button to pick it */}
        {q.kind === 'quad' && <div className="mx-auto grid max-w-3xl grid-cols-2 gap-3 lg:grid-cols-4">{tracks.map((t) => card(t, { label: 'Best' }))}</div>}
        {q.kind === 'odd' && <div className="mx-auto grid max-w-3xl grid-cols-2 gap-3 sm:grid-cols-3">{tracks.map((t) => card(t, { label: 'Like least', swipe: pickSwipe(() => answer(t.id), 'bad') }))}</div>}
        {q.kind === 'benchmark' && (() => { const [ref, t] = tracks; return (
          // a plain head-to-head: the track on your top-10% line against a challenger. Picking the challenger says it clears the line.
          <div className="mx-auto grid max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2">
            {card(ref, { wide: true, fx: fxOf(ref.id, 'ref'), badge: `The line · ${ref.rating.toFixed(1)}`, label: 'Better', on: () => answer('no'), swipe: pickSwipe(() => answer('no')) })}
            {card(t, { wide: true, fx: fxOf(t.id, 'challenger'), accent: true, badge: 'Challenger', label: 'Better', on: () => answer('yes'), swipe: pickSwipe(() => answer('yes')) })}
          </div>); })()}
        {q.kind === 'love' && (() => { const [t] = tracks; return (
          <div className="mx-auto max-w-[14rem] space-y-2">
            {card(t, { swipe: { dirs: 'both', right: 'LOVE', left: 'MEH', onSwipe: (d) => answer(d > 0 ? 'yes' : 'no') }, action: <span className="text-[11px] text-muted">swipe, or:</span> })}
            <div className="grid grid-cols-2 gap-2"><button className="btn min-w-0 justify-center !py-1 text-xs" onClick={() => answer('no')}><ThumbsDown size={13} />Meh</button><button className="btn btn-accent min-w-0 justify-center !py-1 text-xs" onClick={() => answer('yes')}><ThumbsUp size={13} />Love it</button></div>
          </div>); })()}
        <div className="flex flex-wrap gap-2">
          {q.kind === 'duel' && <button className="btn btn-ghost" onClick={() => answer('equal')}><Equal size={14} />Equal</button>}
          <button className="btn btn-ghost" onClick={() => answer('skip')}><SkipForward size={14} />Skip</button>
          {!fixedKind && <button className="btn btn-ghost" onClick={() => next(q.kind)}><RefreshCw size={14} />Another kind</button>}
          {fixedKind && <button className="btn btn-ghost" onClick={() => next(q.kind)}><RefreshCw size={14} />Another one</button>}
        </div>
      </div>}
      {menu.element}
    </section>
  );
}
