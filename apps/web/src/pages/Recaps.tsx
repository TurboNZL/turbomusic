import { useEffect, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Gift } from 'lucide-react';
import { useLibraryLive } from '../lib/derive.ts';
import { buildListens } from '../lib/listens.ts';
import { defaultWeek, nextWeek, weekStart, weeklyRecap, weeksWithPlays, type WeeklyRecap } from '../lib/recap.ts';
import type { ShareCardSpec } from '../lib/shareCard.ts';
import { fmtHours } from '../components/charts.tsx';
import { ShareButton } from '../components/ShareButton.tsx';
import { markRecapSeen } from '../lib/recapSeen.ts';
import { Stage } from '../components/Stage.tsx';
import { WeekStage, weekArt } from '../components/RecapStage.tsx';

const iso = (ts: number) => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const fromIso = (s: string | null) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? ''); return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() : null; };
const short = (ts: number) => new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
export const weekLabel = (start: number) => `${short(start)} – ${short(nextWeek(start) - 1)}`;

/** Share-picture content for one week. */
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
  const listens = useMemo(() => buildListens(lib), [lib]);
  const weeks = useMemo(() => weeksWithPlays(listens), [listens]);
  const picked = fromIso(params.get('week'));
  const start = picked !== null ? weekStart(picked) : defaultWeek(weeks);
  const r = useMemo(() => (start === null ? null : weeklyRecap(lib, listens, start)), [lib, listens, start]);
  // opening the week Home announces counts as having seen it
  useEffect(() => { if (start !== null && start === defaultWeek(weeks)) markRecapSeen(start); }, [start, weeks]);
  const go = (ts: number) => setParams({ week: iso(ts) }, { replace: true });
  const older = start === null ? null : weeks.find((w) => w < start) ?? null, newer = start === null ? null : [...weeks].reverse().find((w) => w > start) ?? null;

  if (!r || start === null) return (
    <div className="mx-auto max-w-xl space-y-3 p-6 text-center">
      <Gift className="mx-auto text-muted" size={32} /><h1 className="text-2xl font-bold">Weekly recap</h1>
      <p className="text-muted">Nothing to recap yet. Once you have listened to a few songs (30 seconds or more counts), a recap of each week appears here, ready on Sunday. You can also import your Spotify history on the Stats page to get recaps for past weeks.</p>
    </div>);

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div className="flex items-center gap-2">
        <h1 className="mr-auto text-2xl font-bold">Weekly recap</h1>
        <Link to="/wrapped" className="btn"><Gift size={15} />Wrapped</Link>
      </div>
      <div className="flex items-center justify-between gap-2">
        <button className="btn" disabled={older === null} onClick={() => older !== null && go(older)} aria-label="Older week"><ChevronLeft size={16} /></button>
        <select className="input max-w-[14rem] flex-1 text-center" value={start} onChange={(e) => go(Number(e.target.value))} aria-label="Pick a week">
          {[...new Set([start, ...weeks])].sort((a, b) => b - a).map((w) => <option key={w} value={w}>{weekLabel(w)}{w === weekStart(Date.now()) ? ' (this week)' : ''}</option>)}
        </select>
        <button className="btn" disabled={newer === null} onClick={() => newer !== null && go(newer)} aria-label="Newer week"><ChevronRight size={16} /></button>
      </div>
      <Stage key={start}><WeekStage r={r} lib={lib} /></Stage>
      <div className="flex flex-wrap items-center gap-2">
        <ShareButton render={() => <WeekStage r={r} lib={lib} />} fallback={weekCard(r)} name={`turbomusic-week-${iso(r.from)}`} />
        <span className="text-xs text-muted">A 1080 × 1920 picture of the card above. Counts plays of 30 seconds or more, Monday to Sunday. {r.partial ? 'This week is not over, so the numbers can still change.' : ''}</span>
      </div>
    </div>
  );
}
