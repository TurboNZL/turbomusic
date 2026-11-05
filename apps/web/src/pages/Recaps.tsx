import { useEffect, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Gift } from 'lucide-react';
import { useLibraryLive } from '../lib/derive.ts';
import { buildListens } from '../lib/listens.ts';
import { defaultMonth, defaultWeek, monthlyRecap, monthsWithPlays, nextMonth, nextWeek, weekStart, weeklyRecap, weeksWithPlays, monthStart, type WeeklyRecap } from '../lib/recap.ts';
import { dismissed, dismiss } from '../lib/recapSeen.ts';
import type { ShareCardSpec } from '../lib/shareCard.ts';
import { fmtHours } from '../components/charts.tsx';
import { ShareButton } from '../components/ShareButton.tsx';
import { Stage } from '../components/Stage.tsx';
import { MonthStage, WeekStage, monthArt, monthLabelOf, weekArt } from '../components/RecapStage.tsx';
import { cn } from '../lib/cn.ts';

const iso = (ts: number) => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const fromIso = (s: string | null) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? ''); return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() : null; };
const short = (ts: number) => new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
export const weekLabel = (start: number) => `${short(start)} – ${short(nextWeek(start) - 1)}`;

/** Share-picture content for one week (only used if the browser cannot photograph the card). */
export function weekCard(r: WeeklyRecap): ShareCardSpec {
  return {
    kicker: r.partial ? 'Weekly recap · so far' : 'Weekly recap', title: weekLabel(r.from),
    big: { value: fmtHours(r.ms), label: `${r.plays.toLocaleString()} plays${r.change === null ? '' : ` · ${r.change >= 0 ? '+' : '−'}${Math.round(Math.abs(r.change) * 100)}% on last week`}` },
    sections: [
      { heading: 'Top songs', rows: r.topTracks.map((t) => t.label) },
      { heading: 'Top artists', rows: r.topArtists.map((t) => t.label) },
      ...(r.album ? [{ heading: 'Album of the week', rows: [r.album.label] }] : []),
    ],
    footer: 'TurboMusic', art: weekArt(r.from),
  };
}

export function RecapsPage() {
  const lib = useLibraryLive();
  const [params, setParams] = useSearchParams();
  const monthly = params.get('kind') === 'month';
  const listens = useMemo(() => buildListens(lib), [lib]);
  const weeks = useMemo(() => weeksWithPlays(listens), [listens]);
  const months = useMemo(() => monthsWithPlays(listens), [listens]);
  const picked = fromIso(params.get(monthly ? 'month' : 'week'));
  const start = monthly ? (picked !== null ? monthStart(picked) : defaultMonth(months)) : (picked !== null ? weekStart(picked) : defaultWeek(weeks));
  const list = monthly ? months : weeks;
  const week = useMemo(() => (!monthly && start !== null ? weeklyRecap(lib, listens, start) : null), [lib, listens, start, monthly]);
  const month = useMemo(() => (monthly && start !== null ? monthlyRecap(lib, listens, start) : null), [lib, listens, start, monthly]);
  // opening the one Home announces counts as having seen it (on every device: the dismissal is synced)
  useEffect(() => {
    if (start === null) return;
    if (!monthly && start === defaultWeek(weeks) && start > dismissed(lib).week) dismiss(lib, 'week', start);
    if (monthly && start === defaultMonth(months) && start > dismissed(lib).month) dismiss(lib, 'month', start);
  }, [start, monthly]); // eslint-disable-line react-hooks/exhaustive-deps
  const go = (ts: number) => setParams({ kind: monthly ? 'month' : 'week', [monthly ? 'month' : 'week']: iso(ts) }, { replace: true });
  const older = start === null ? null : list.find((w) => w < start) ?? null, newer = start === null ? null : [...list].reverse().find((w) => w > start) ?? null;
  const label = (w: number) => (monthly ? monthLabelOf(w) : weekLabel(w));
  const thisOne = monthly ? monthStart(Date.now()) : weekStart(Date.now());

  const tabs = (
    <div role="tablist" className="flex gap-1 rounded-theme bg-raised p-1" aria-label="Recap length">
      {([['week', 'Weekly'], ['month', 'Monthly']] as const).map(([k, t]) => <button key={k} role="tab" aria-selected={(k === 'month') === monthly} onClick={() => setParams({ kind: k }, { replace: true })} className={cn('rounded-theme px-3 py-1 text-sm font-medium', (k === 'month') === monthly ? 'bg-accent text-accent-fg' : 'text-muted hover:text-fg')}>{t}</button>)}
    </div>);

  if (start === null) return (
    <div className="mx-auto max-w-xl space-y-3 p-6 text-center">
      <Gift className="mx-auto text-muted" size={32} /><h1 className="text-2xl font-bold">Recaps</h1><div className="flex justify-center">{tabs}</div>
      <p className="text-muted">Nothing to recap yet. Once you have listened to a few songs (30 seconds or more counts), a recap of each week and month appears here. You can also import your Spotify history on the Stats page to get recaps for the past.</p>
    </div>);

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-2xl font-bold">{monthly ? 'Monthly recap' : 'Weekly recap'}</h1>
        {tabs}
        <Link to="/wrapped" className="btn"><Gift size={15} />Wrapped</Link>
      </div>
      <div className="flex items-center justify-between gap-2">
        <button className="btn" disabled={older === null} onClick={() => older !== null && go(older)} aria-label={monthly ? 'Older month' : 'Older week'}><ChevronLeft size={16} /></button>
        <select className="input max-w-[14rem] flex-1 text-center" value={start} onChange={(e) => go(Number(e.target.value))} aria-label={monthly ? 'Pick a month' : 'Pick a week'}>
          {[...new Set([start, ...list])].sort((a, b) => b - a).map((w) => <option key={w} value={w}>{label(w)}{w === thisOne ? (monthly ? ' (this month)' : ' (this week)') : ''}</option>)}
        </select>
        <button className="btn" disabled={newer === null} onClick={() => newer !== null && go(newer)} aria-label={monthly ? 'Newer month' : 'Newer week'}><ChevronRight size={16} /></button>
      </div>
      <Stage key={`${monthly}-${start}`}>{monthly ? month && <MonthStage r={month} lib={lib} /> : week && <WeekStage r={week} lib={lib} />}</Stage>
      <div className="flex flex-wrap items-center gap-2">
        {monthly
          ? month && <ShareButton render={() => <MonthStage r={month} lib={lib} />} name={`turbomusic-month-${iso(month.from).slice(0, 7)}`} fallback={{ kicker: 'Monthly recap', title: monthLabelOf(month.from), big: { value: fmtHours(month.ms), label: `${month.plays.toLocaleString()} plays` }, sections: [{ heading: 'Top songs', rows: month.topTracks.map((t) => t.label) }, { heading: 'Top artists', rows: month.topArtists.map((t) => t.label) }], footer: 'TurboMusic', art: monthArt(month.from) }} />
          : week && <ShareButton render={() => <WeekStage r={week} lib={lib} />} fallback={weekCard(week)} name={`turbomusic-week-${iso(week.from)}`} />}
        <span className="text-xs text-muted">A 1080 × 1920 picture of the card above, with the zero things left off. Counts plays of 30 seconds or more. {(week?.partial || month?.partial) ? 'It is not over yet, so the numbers can still change.' : ''}</span>
      </div>
    </div>
  );
}
