import { useEffect, useMemo, useState } from 'react';
import { Check, Equal, RotateCcw, SkipForward, ThumbsUp } from 'lucide-react';
import type { VoteData } from '@turbomusic/core';
import { useLibraryLive, type Track } from '../lib/derive.ts';
import { buildListens } from '../lib/listens.ts';
import { heardTrackIds } from '../lib/heard.ts';
import { useStore } from '../lib/store.ts';
import { usePreviews } from '../lib/usePreviews.ts';
import { answerPlacement, isPlaced, placedEqual, placedRank, placementCandidates, probeAt, questionsLeft, startPlacement, type Placement } from '../lib/placement.ts';
import { cssMs } from '../lib/presence.ts';
import { haptic } from '../lib/haptics.ts';
import { PreviewCard } from './PreviewCard.tsx';
import { Select } from './Select.tsx';

/** a placement answer is a deliberate "this one is better", a little more than an ordinary vote */
const PLACE_WEIGHT = 1.5;

/**
 * Rank > Place a song. Pick one song (the ones you thumbed up but have few votes are suggested), then answer a handful of "which is
 * better?" questions against songs from the middle of your ranking, then the middle of the half it belongs in, and so on, until its
 * position is clear. Every answer is saved as a normal vote.
 */
/** A song's score as a label: its place in the 10/10 list when it is a 10, else its rating out of 10 (a place like #673 means little on a 7.2). */
export const ratingBadge = (t: { effectiveRating: number; tenStarRank: number | null }) => (t.tenStarRank ? `#${t.tenStarRank}` : t.effectiveRating > 0.001 ? `${t.effectiveRating.toFixed(1)}/10` : 'Unrated');

export function PlaceRank({ initialId }: { initialId?: string }) {
  const lib = useLibraryLive();
  const put = useStore((s) => s.put);
  const [subjectId, setSubjectId] = useState<string | undefined>(initialId);
  const [p, setP] = useState<Placement | null>(null);
  const [settle, setSettle] = useState<'win' | 'lose' | 'equal' | null>(null);
  const heard = useMemo(() => heardTrackIds(buildListens(lib)), [lib]);
  // the songs it is measured against: ones with enough votes to have a trustworthy place, best first (frozen when the placement starts)
  const [ranked, setRanked] = useState<Track[]>([]);
  const subject = subjectId ? lib.trackById.get(subjectId) : undefined;
  const suggestions = useMemo(() => placementCandidates(lib.tracks.filter((t) => t.file || heard.has(t.id))), [lib, heard]);

  function begin(id: string) {
    const list = lib.tracks.filter((t) => t.id !== id && !t.versionOf && t.comparisons >= 3).sort((a, b) => b.elo - a.elo);
    setSubjectId(id); setRanked(list); setP(list.length ? startPlacement(list.length) : null); setSettle(null);
  }
  // opened from a track's menu: start straight away (once the library is there)
  useEffect(() => { if (initialId && !p && lib.trackById.has(initialId)) begin(initialId); }, [initialId, lib.trackById.size]); // eslint-disable-line react-hooks/exhaustive-deps
  const opponent = p && !isPlaced(p) ? ranked[probeAt(p)] : undefined;
  const tracks = [subject, opponent].filter((t): t is Track => !!t);
  const preview = usePreviews(tracks, !!subject && !!opponent && !settle);

  function answer(kind: 'better' | 'worse' | 'equal') {
    if (!subject || !opponent || !p || settle) return;
    const data: VoteData = { trackAId: subject.id, trackBId: opponent.id, winnerId: kind === 'equal' ? null : kind === 'better' ? subject.id : opponent.id, isEqual: kind === 'equal', timestamp: Date.now(), ...(kind === 'equal' ? {} : { weight: PLACE_WEIGHT }) };
    put('votes', data);
    haptic('confirm');
    preview.stop();
    const at = probeAt(p);
    const nextP = kind === 'equal' ? placedEqual(p, at) : answerPlacement(p, at, kind === 'better');
    const wait = cssMs('--vote-ms', 440);
    setSettle(kind === 'better' ? 'win' : kind === 'worse' ? 'lose' : 'equal');
    setTimeout(() => { setSettle(null); setP(nextP); }, wait);
  }
  /** "I can't decide": ask about a neighbour instead (the same song twice would learn nothing) */
  const skip = () => { if (p && !isPlaced(p) && !settle) { const at = probeAt(p); preview.stop(); setP(p.hi - p.lo <= 1 ? { ...p, lo: p.hi } : at + 1 < p.hi ? { ...p, lo: at + 1 } : { ...p, hi: at }); } };

  if (!subject || !p) return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      <div className="card space-y-3 p-4">
        <h2 className="font-semibold">Place a song</h2>
        <p className="text-sm text-muted">Pick a song you love and find out where it really belongs: you are asked about a handful of other songs, from the middle of your ranking up or down, and its position settles by itself. Everything you answer counts as a vote.</p>
        <Select value={subjectId ?? ''} placeholder="Search for a song…" searchable onChange={(id) => id && begin(id)}
          options={lib.tracks.filter((t) => t.file).map((t) => ({ value: t.id, label: t.title, hint: t.artistName }))} />
        {subjectId && !lib.trackById.get(subjectId) && <p className="text-sm text-warn">That song is not in the library any more.</p>}
        {subject && !p && <p className="text-sm text-warn">There are not enough ranked songs with audio to place it against yet. Use Head to head first.</p>}
      </div>
      {suggestions.length > 0 && <div className="card space-y-2 p-4">
        <h2 className="flex items-center gap-2 font-semibold"><ThumbsUp size={16} className="text-accent" />Songs you liked that have few votes</h2>
        <ul className="space-y-1">{suggestions.map((t) => (
          <li key={t.id}><button className="flex w-full items-center gap-2 rounded-theme px-2 py-1.5 text-left text-sm hover:bg-raised" onClick={() => begin(t.id)}>
            <span className="min-w-0 flex-1 truncate">{t.title}<span className="text-muted"> · {t.artistName}</span></span>
            <span className="shrink-0 text-xs text-muted">{t.comparisons} vote{t.comparisons === 1 ? '' : 's'}</span></button></li>))}</ul>
      </div>}
    </div>
  );

  const done = isPlaced(p);
  const total = ranked.length + 1;
  const place = placedRank(p);
  return (
    <div className="mx-auto w-full max-w-3xl space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">Placing “{subject.title}”</span>
        <span className="text-muted">{done ? 'Done' : `about ${questionsLeft(p)} more question${questionsLeft(p) === 1 ? '' : 's'} · somewhere between #${p.lo + 1} and #${Math.min(total, p.hi + 1)} of ${total}`}</span>
        <button className="btn btn-ghost ml-auto !py-1" onClick={() => { setP(null); setSubjectId(undefined); preview.stop(); }}><RotateCcw size={14} />Another song</button>
      </div>
      {!done && opponent && <>
        <p className="text-sm text-muted">Is “{subject.title}” better than “{opponent.title}”?</p>
        <div className="mx-auto grid max-w-3xl grid-cols-2 gap-3">
          <PreviewCard t={subject} preview={preview} accent fx={settle === 'win' ? 'win' : settle === 'lose' ? 'lose' : settle === 'equal' ? 'equal' : null}>
            <button className="btn btn-accent w-full !py-1.5 text-sm" onClick={() => answer('better')}><Check size={14} />Better</button></PreviewCard>
          <PreviewCard t={opponent} preview={preview} badge={ratingBadge(opponent)} fx={settle === 'lose' ? 'win' : settle === 'win' ? 'lose' : settle === 'equal' ? 'equal' : null}>
            <button className="btn w-full !py-1.5 text-sm" onClick={() => answer('worse')}>This one is better</button></PreviewCard>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <button className="btn btn-ghost" onClick={() => answer('equal')} title="About as good: it goes right here"><Equal size={14} />About equal</button>
          <button className="btn btn-ghost" onClick={skip} title="Cannot decide: ask about a different song"><SkipForward size={14} />Ask about another</button>
        </div>
      </>}
      {done && <div className="card space-y-1 p-4 text-center" role="status">
        <div className="text-sm text-muted">“{subject.title}” now sits at about</div>
        <div className="text-4xl font-bold tabular-nums">#{place}<span className="text-lg font-normal text-muted"> of {total}</span></div>
        <div className="text-sm text-muted">rated {(lib.trackById.get(subject.id)?.effectiveRating ?? 0).toFixed(1)} after {p.asked} answer{p.asked === 1 ? '' : 's'}</div>
        <div className="pt-2"><button className="btn btn-accent" onClick={() => { setP(null); setSubjectId(undefined); }}>Place another</button></div>
      </div>}
    </div>
  );
}
