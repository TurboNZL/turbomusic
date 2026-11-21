import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, Equal, RefreshCw, SkipForward, ThumbsDown, ThumbsUp } from 'lucide-react';
import { useLibraryLive, type Track } from '../lib/derive.ts';
import { buildListens } from '../lib/listens.ts';
import { heardTrackIds, onlyHeard } from '../lib/heard.ts';
import { useStore } from '../lib/store.ts';
import { makeQuestion, nextQuestion, votesFor, type Q, type Question } from '../lib/questions.ts';
import { usePreviews } from '../lib/usePreviews.ts';
import { PreviewCard } from './PreviewCard.tsx';
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
  const [open, setOpen] = useState(embedded ? true : wasOpen);
  // one kind only (the Rank page's modes) or a mix (home): the question to ask next
  const ask = (pool: Q[], prev?: Question['kind']) => (fixedKind ? makeQuestion(pool, fixedKind) ?? nextQuestion(pool, prev) : nextQuestion(pool, prev));
  // only tracks that were played at least once get asked about (the rest are on the home page's "Try something new")
  const pool = useMemo(() => onlyHeard(lib.tracks.filter((t) => t.file), heardTrackIds(buildListens(lib))).pool.map((t) => ({ id: t.id, elo: t.elo, comparisons: t.comparisons, rating: t.rating })), [lib]);
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
  const pick = (t: Track, label = 'This one', on?: () => void) => label === 'Like least'
    ? <button className="btn w-full !py-1.5 text-sm" onClick={on ?? (() => answer(t.id))}><ThumbsDown size={14} />{label}</button> // the opposite of picking a favourite: not the accent colour, not a tick
    : <button className="btn btn-accent w-full !py-1.5 text-sm" onClick={on ?? (() => answer(t.id))}><Check size={14} />{label}</button>;

  return (
    <section className="card" aria-label="Ranking question">
      <button type="button" className={cn('flex w-full items-center gap-2 px-4 py-3 text-left', embedded && 'pointer-events-none')} aria-expanded={open} onClick={embedded ? undefined : toggle}>
        <h2 className="font-semibold">Sharpen your ranking</h2>
        <span className="chip">{LABEL[q.kind]}</span>
        <span className="ml-auto text-xs text-muted">{answered ? `${answered} answered` : open ? '' : 'one quick question'}</span>
        {!embedded && <ChevronDown size={16} className={cn('shrink-0 text-muted transition-transform', open && 'rotate-180')} />}
      </button>
      {open && <div className="space-y-3 px-4 pb-4">
        <p className="text-sm text-muted">{q.why}</p>
        {q.kind === 'duel' && <div className="mx-auto grid max-w-3xl grid-cols-2 gap-3">{tracks.map((t) => <PreviewCard key={t.id} t={t} preview={preview} fx={fxOf(t.id)}>{pick(t)}</PreviewCard>)}</div>}
        {q.kind === 'triple' && <div className="mx-auto grid max-w-4xl grid-cols-2 gap-3 sm:grid-cols-3">{tracks.map((t) => <PreviewCard key={t.id} t={t} preview={preview} fx={fxOf(t.id)}>{pick(t, 'Best')}</PreviewCard>)}</div>}
        {q.kind === 'quad' && <div className="mx-auto grid max-w-4xl grid-cols-2 gap-3 lg:grid-cols-4">{tracks.map((t) => <PreviewCard key={t.id} t={t} preview={preview} fx={fxOf(t.id)}>{pick(t, 'Best')}</PreviewCard>)}</div>}
        {q.kind === 'odd' && <div className="mx-auto grid max-w-4xl grid-cols-2 gap-3 sm:grid-cols-3">{tracks.map((t) => <PreviewCard key={t.id} t={t} preview={preview} fx={fxOf(t.id)}>{pick(t, 'Like least')}</PreviewCard>)}</div>}
        {q.kind === 'benchmark' && (() => { const [ref, t] = tracks; return (
          // a plain head-to-head: the track on your top-10% line against a challenger. Picking the challenger says it clears the line.
          <div className="grid grid-cols-2 gap-3">
            <PreviewCard t={ref} preview={preview} fx={fxOf(ref.id, 'ref')} badge={`The line · ${ref.rating.toFixed(1)}`}>{pick(ref, 'This one is better', () => answer('no'))}</PreviewCard>
            <PreviewCard t={t} preview={preview} fx={fxOf(t.id, 'challenger')} accent badge="Challenger">{pick(t, 'This one is better', () => answer('yes'))}</PreviewCard>
          </div>); })()}
        {q.kind === 'love' && (() => { const [t] = tracks; return (
          <div className="mx-auto max-w-[12rem]"><PreviewCard t={t} preview={preview} fx={fxOf(t.id)}>
            <div className="flex flex-col gap-2"><button className="btn btn-accent w-full min-w-0 justify-center" onClick={() => answer('yes')}><ThumbsUp size={15} />Love it</button><button className="btn w-full min-w-0 justify-center" onClick={() => answer('no')}><ThumbsDown size={15} />Meh</button></div>
          </PreviewCard></div>); })()}
        <div className="flex flex-wrap gap-2">
          {q.kind === 'duel' && <button className="btn btn-ghost" onClick={() => answer('equal')}><Equal size={14} />Equal</button>}
          <button className="btn btn-ghost" onClick={() => answer('skip')}><SkipForward size={14} />Skip</button>
          {!fixedKind && <button className="btn btn-ghost" onClick={() => next(q.kind)}><RefreshCw size={14} />Another kind</button>}
          {fixedKind && <button className="btn btn-ghost" onClick={() => next(q.kind)}><RefreshCw size={14} />Another one</button>}
        </div>
      </div>}
    </section>
  );
}
