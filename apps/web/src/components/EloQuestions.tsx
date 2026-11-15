import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, Equal, RefreshCw, SkipForward, ThumbsDown, ThumbsUp } from 'lucide-react';
import { useLibraryLive, type Track } from '../lib/derive.ts';
import { buildListens } from '../lib/listens.ts';
import { heardTrackIds, onlyHeard } from '../lib/heard.ts';
import { useStore } from '../lib/store.ts';
import { nextQuestion, votesFor, type Question } from '../lib/questions.ts';
import { usePreviews } from '../lib/usePreviews.ts';
import { PreviewCard } from './PreviewCard.tsx';
import { cn } from '../lib/cn.ts';

const LABEL: Record<Question['kind'], string> = { duel: 'Head to head', triple: 'Best of three', benchmark: 'Against your top 10%', love: 'Gut check' };
const OPEN_KEY = 'turbomusic.eloQuestionOpen';
/** the question on screen survives leaving the home page and coming back */
let kept: Question | null = null;
const wasOpen = () => { try { return localStorage.getItem(OPEN_KEY) === '1'; } catch { return false; } };

/**
 * Home: a question about the ranking that is worth answering (lib/questions.ts), kept closed until asked for so it never takes over
 * the page. Open, it shows the tracks the way the Rank page does: tap a cover to hear 15 s, then answer.
 */
export function EloQuestions() {
  const lib = useLibraryLive();
  const put = useStore((s) => s.put);
  const [open, setOpen] = useState(wasOpen);
  // only tracks that were played at least once get asked about (the rest are on the home page's "Try something new")
  const pool = useMemo(() => onlyHeard(lib.tracks.filter((t) => t.file), heardTrackIds(buildListens(lib))).pool.map((t) => ({ id: t.id, elo: t.elo, comparisons: t.comparisons, rating: t.rating })), [lib]);
  const [q, setQ] = useState<Question | null>(() => kept ?? nextQuestion(pool));
  useEffect(() => { kept = q; }, [q]);
  const [answered, setAnswered] = useState(0);
  // the library may still be loading when this mounts: ask again once there is something to ask about
  useEffect(() => { if (!q && pool.length >= 2) setQ(nextQuestion(pool)); }, [q, pool]);
  const T = (id: string) => lib.trackById.get(id);
  const tracks = (!q ? [] : q.kind === 'duel' ? [T(q.a), T(q.b)] : q.kind === 'triple' ? q.ids.map(T) : q.kind === 'benchmark' ? [T(q.ref), T(q.id)] : [T(q.id)]).filter((t): t is Track => !!t);
  const preview = usePreviews(tracks, open && !!q);
  const toggle = () => { setOpen((o) => { try { localStorage.setItem(OPEN_KEY, o ? '0' : '1'); } catch { /* ignore */ } return !o; }); preview.stop(); };
  if (!q || tracks.length === 0) return null;

  const next = (prev?: Question['kind']) => { preview.stop(); setQ(nextQuestion(pool, prev)); };
  const answer = (a: string) => {
    for (const v of votesFor(q, a)) put('votes', v);
    if (a !== 'skip') setAnswered((n) => n + 1);
    next(q.kind);
  };
  const pick = (t: Track, label = 'This one', on?: () => void) => <button className="btn btn-accent w-full !py-1.5 text-sm" onClick={on ?? (() => answer(t.id))}><Check size={14} />{label}</button>;

  return (
    <section className="card" aria-label="Ranking question">
      <button type="button" className="flex w-full items-center gap-2 px-4 py-3 text-left" aria-expanded={open} onClick={toggle}>
        <h2 className="font-semibold">Sharpen your ranking</h2>
        <span className="chip">{LABEL[q.kind]}</span>
        <span className="ml-auto text-xs text-muted">{answered ? `${answered} answered` : open ? '' : 'one quick question'}</span>
        <ChevronDown size={16} className={cn('shrink-0 text-muted transition-transform', open && 'rotate-180')} />
      </button>
      {open && <div className="space-y-3 px-4 pb-4">
        <p className="text-sm text-muted">{q.why}</p>
        {q.kind === 'duel' && <div className="mx-auto grid max-w-3xl grid-cols-2 gap-3">{tracks.map((t) => <PreviewCard key={t.id} t={t} preview={preview}>{pick(t)}</PreviewCard>)}</div>}
        {q.kind === 'triple' && <div className="mx-auto grid max-w-4xl grid-cols-2 gap-3 sm:grid-cols-3">{tracks.map((t) => <PreviewCard key={t.id} t={t} preview={preview}>{pick(t, 'Best')}</PreviewCard>)}</div>}
        {q.kind === 'benchmark' && (() => { const [ref, t] = tracks; return (
          // a plain head-to-head: the track on your top-10% line against a challenger. Picking the challenger says it clears the line.
          <div className="grid grid-cols-2 gap-3">
            <PreviewCard t={ref} preview={preview} badge={`The line · ${ref.rating.toFixed(1)}`}>{pick(ref, 'This one is better', () => answer('no'))}</PreviewCard>
            <PreviewCard t={t} preview={preview} accent badge="Challenger">{pick(t, 'This one is better', () => answer('yes'))}</PreviewCard>
          </div>); })()}
        {q.kind === 'love' && (() => { const [t] = tracks; return (
          <div className="mx-auto max-w-[12rem]"><PreviewCard t={t} preview={preview}>
            <div className="flex flex-col gap-2"><button className="btn btn-accent w-full min-w-0 justify-center" onClick={() => answer('yes')}><ThumbsUp size={15} />Love it</button><button className="btn w-full min-w-0 justify-center" onClick={() => answer('no')}><ThumbsDown size={15} />Meh</button></div>
          </PreviewCard></div>); })()}
        <div className="flex flex-wrap gap-2">
          {q.kind === 'duel' && <button className="btn btn-ghost" onClick={() => answer('equal')}><Equal size={14} />Equal</button>}
          <button className="btn btn-ghost" onClick={() => answer('skip')}><SkipForward size={14} />Skip</button>
          <button className="btn btn-ghost" onClick={() => next(q.kind)}><RefreshCw size={14} />Another kind</button>
        </div>
      </div>}
    </section>
  );
}
