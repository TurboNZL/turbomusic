import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Gift, X } from 'lucide-react';
import type { Library } from '../lib/derive.ts';
import { buildListens } from '../lib/listens.ts';
import { computeWrapped, defaultWeek, weeklyRecap, weeksWithPlays } from '../lib/recap.ts';
import { markRecapSeen, markWrappedSeen, recapSeen, wrappedSeason, wrappedSeen } from '../lib/recapSeen.ts';
import { fmtHours } from './charts.tsx';
import { Cover } from './Cover.tsx';
import { weekLabelOf } from './RecapStage.tsx';

const iso = (ts: number) => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/**
 * On Home: "Your weekly recap is ready" once for each new week (the one that just ended; on Sunday, the week in progress), and
 * "Your Wrapped is ready" from November. Opening or dismissing one remembers it, on this device.
 */
export function RecapPrompt({ lib }: { lib: Library }) {
  const [, bump] = useState(0);
  const listens = useMemo(() => buildListens(lib), [lib]);
  const week = useMemo(() => defaultWeek(weeksWithPlays(listens)), [listens]);
  const recap = useMemo(() => (week === null ? null : weeklyRecap(lib, listens, week)), [lib, listens, week]);
  const now = new Date(), year = now.getFullYear();
  const wrapped = useMemo(() => (wrappedSeason(now) ? computeWrapped(lib, listens, year) : null), [lib, listens, year]); // eslint-disable-line react-hooks/exhaustive-deps

  const showWeek = recap && week !== null && recap.plays >= 3 && week > recapSeen();
  const showWrapped = !!wrapped && wrapped.plays >= 5 && year > wrappedSeen();
  if (!showWeek && !showWrapped) return null;
  const dismiss = (f: () => void) => () => { f(); bump((n) => n + 1); };
  return (
    <div className="space-y-3">
      {showWeek && recap && week !== null && (() => {
        const top = recap.topTracks[0], art = recap.topArtists[0];
        return (
          <section className="card relative flex flex-wrap items-center gap-4 overflow-hidden p-4" style={{ background: 'linear-gradient(135deg, #7c3aed 0%, #4c1d95 55%, #1e1b4b 100%)', color: '#fff' }} aria-label="Weekly recap">
            <Cover hash={top?.id ? lib.trackById.get(top.id)?.cover : null} seed={top?.label ?? 'week'} className="!h-20 !w-20 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-bold uppercase tracking-widest text-white/70">{recap.partial ? 'Your week so far' : 'Your weekly recap is ready'} · {weekLabelOf(recap.from, recap.to - 1)}</div>
              <div className="text-2xl font-black tabular-nums">{fmtHours(recap.ms)} <span className="text-base font-semibold text-white/75">· {recap.plays.toLocaleString()} plays</span></div>
              <div className="truncate text-sm text-white/80">{top ? `${top.label}` : ''}{top && art ? ' · ' : ''}{art ? art.label : ''}</div>
            </div>
            <Link to={`/recaps?week=${iso(week)}`} onClick={() => markRecapSeen(week)} className="btn btn-accent"><Gift size={15} />See your recap</Link>
            <button className="absolute right-2 top-2 rounded-full p-1 text-white/70 hover:bg-white/15 hover:text-white" aria-label="Dismiss" onClick={dismiss(() => markRecapSeen(week))}><X size={15} /></button>
          </section>);
      })()}
      {showWrapped && wrapped && (
        <section className="card relative flex flex-wrap items-center gap-4 overflow-hidden p-4" style={{ background: 'linear-gradient(135deg, #db2777 0%, #7c2d12 100%)', color: '#fff' }} aria-label="Wrapped">
          <div className="min-w-0 flex-1">
            <div className="text-xs font-bold uppercase tracking-widest text-white/70">Your {year} Wrapped is ready</div>
            <div className="text-2xl font-black tabular-nums">{wrapped.minutes.toLocaleString()} minutes <span className="text-base font-semibold text-white/75">· {wrapped.topArtists[0]?.label ?? ''}</span></div>
          </div>
          <Link to={`/wrapped?year=${year}`} onClick={() => markWrappedSeen(year)} className="btn btn-accent"><Gift size={15} />Open Wrapped</Link>
          <button className="absolute right-2 top-2 rounded-full p-1 text-white/70 hover:bg-white/15 hover:text-white" aria-label="Dismiss" onClick={dismiss(() => markWrappedSeen(year))}><X size={15} /></button>
        </section>)}
    </div>
  );
}
