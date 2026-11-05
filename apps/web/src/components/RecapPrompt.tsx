import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Gift, X } from 'lucide-react';
import type { Library } from '../lib/derive.ts';
import { buildListens } from '../lib/listens.ts';
import { computeWrapped, defaultMonth, defaultWeek, monthlyRecap, monthsWithPlays, weeklyRecap, weeksWithPlays } from '../lib/recap.ts';
import { dismiss, dismissed, wrappedSeason } from '../lib/recapSeen.ts';
import { fmtHours } from './charts.tsx';
import { Cover } from './Cover.tsx';
import { monthLabelOf, weekLabelOf } from './RecapStage.tsx';

const iso = (ts: number) => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/**
 * On Home: the newest weekly recap, the newest monthly recap (in the first ten days of the month) and Wrapped (from the end of November),
 * each until it is opened or dismissed. Dismissals are part of the synced profile, so they hold on every device; Settings can bring them back.
 */
export function RecapPrompt({ lib }: { lib: Library }) {
  const listens = useMemo(() => buildListens(lib), [lib]);
  const now = new Date(), year = now.getFullYear();
  const gone = dismissed(lib);
  const week = useMemo(() => defaultWeek(weeksWithPlays(listens)), [listens]);
  const recap = useMemo(() => (week === null ? null : weeklyRecap(lib, listens, week)), [lib, listens, week]);
  const m = useMemo(() => defaultMonth(monthsWithPlays(listens)), [listens]);
  const monthRecap = useMemo(() => (m === null ? null : monthlyRecap(lib, listens, m)), [lib, listens, m]);
  const wrapped = useMemo(() => (wrappedSeason(now) ? computeWrapped(lib, listens, year) : null), [lib, listens, year]); // eslint-disable-line react-hooks/exhaustive-deps

  const showWeek = !!recap && week !== null && recap.plays >= 3 && week > gone.week;
  // a month is announced in the first ten days after it ends
  const showMonth = !!monthRecap && m !== null && !monthRecap.partial && monthRecap.plays >= 10 && m > gone.month && now.getDate() <= 10;
  const showWrapped = !!wrapped && wrapped.plays >= 5 && year > gone.wrapped;
  if (!showWeek && !showMonth && !showWrapped) return null;
  const X_ = ({ onClick }: { onClick: () => void }) => <button className="absolute right-2 top-2 rounded-full p-1 text-white/70 hover:bg-white/15 hover:text-white" aria-label="Dismiss" title="Dismiss on every device (Settings can bring it back)" onClick={onClick}><X size={15} /></button>;
  return (
    <div className="space-y-3">
      {showWrapped && wrapped && (
        <section className="card relative flex flex-wrap items-center gap-4 overflow-hidden p-4" style={{ background: 'linear-gradient(135deg, #db2777 0%, #7c2d12 100%)', color: '#fff' }} aria-label="Wrapped">
          <div className="min-w-0 flex-1">
            <div className="text-xs font-bold uppercase tracking-widest text-white/70">Your {year} Wrapped is ready</div>
            <div className="text-2xl font-black tabular-nums">{wrapped.minutes.toLocaleString()} minutes <span className="text-base font-semibold text-white/75">· {wrapped.topArtists[0]?.label ?? ''}</span></div>
          </div>
          <Link to={`/wrapped?year=${year}`} onClick={() => dismiss(lib, 'wrapped', year)} className="btn btn-accent"><Gift size={15} />Open Wrapped</Link>
          <X_ onClick={() => dismiss(lib, 'wrapped', year)} />
        </section>)}
      {showMonth && monthRecap && m !== null && (
        <section className="card relative flex flex-wrap items-center gap-4 overflow-hidden p-4" style={{ background: 'linear-gradient(135deg, #db2777 0%, #7c2d4a 55%, #1e1b4b 100%)', color: '#fff' }} aria-label="Monthly recap">
          <Cover hash={monthRecap.topTracks[0]?.id ? lib.trackById.get(monthRecap.topTracks[0].id!)?.cover : null} seed={monthRecap.topTracks[0]?.label ?? 'month'} className="!h-20 !w-20 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-bold uppercase tracking-widest text-white/70">Your {monthLabelOf(m)} recap is ready</div>
            <div className="text-2xl font-black tabular-nums">{fmtHours(monthRecap.ms)} <span className="text-base font-semibold text-white/75">· {monthRecap.plays.toLocaleString()} plays</span></div>
            <div className="truncate text-sm text-white/80">{monthRecap.topTracks[0]?.label}{monthRecap.topArtists[0] ? ` · ${monthRecap.topArtists[0].label}` : ''}</div>
          </div>
          <Link to={`/recaps?kind=month&month=${iso(m)}`} onClick={() => dismiss(lib, 'month', m)} className="btn btn-accent"><Gift size={15} />See your month</Link>
          <X_ onClick={() => dismiss(lib, 'month', m)} />
        </section>)}
      {showWeek && recap && week !== null && (() => {
        const top = recap.topTracks[0], art = recap.topArtists[0];
        return (
          <section className="card relative flex flex-wrap items-center gap-4 overflow-hidden p-4" style={{ background: 'linear-gradient(135deg, #7c3aed 0%, #4c1d95 55%, #1e1b4b 100%)', color: '#fff' }} aria-label="Weekly recap">
            <Cover hash={top?.id ? lib.trackById.get(top.id)?.cover : null} seed={top?.label ?? 'week'} className="!h-20 !w-20 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-bold uppercase tracking-widest text-white/70">{recap.partial ? 'Your week so far' : 'Your weekly recap is ready'} · {weekLabelOf(recap.from, recap.to - 1)}</div>
              <div className="text-2xl font-black tabular-nums">{fmtHours(recap.ms)} <span className="text-base font-semibold text-white/75">· {recap.plays.toLocaleString()} plays</span></div>
              <div className="truncate text-sm text-white/80">{top ? top.label : ''}{top && art ? ' · ' : ''}{art ? art.label : ''}</div>
            </div>
            <Link to={`/recaps?week=${iso(week)}`} onClick={() => dismiss(lib, 'week', week)} className="btn btn-accent"><Gift size={15} />See your recap</Link>
            <X_ onClick={() => dismiss(lib, 'week', week)} />
          </section>);
      })()}
    </div>
  );
}
