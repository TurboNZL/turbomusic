import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Flame, Gift, Heart, Moon, Sun, Sunrise, Sunset, ThumbsDown, ThumbsUp, Swords, TrendingDown, TrendingUp } from 'lucide-react';
import { useLibraryLive } from '../lib/derive.ts';
import { buildListens } from '../lib/listens.ts';
import { defaultWeek, nextWeek, weekStart, weeklyRecap, weeksWithPlays, type WeeklyRecap } from '../lib/recap.ts';
import type { TopRow } from '../lib/listenStats.ts';
import { statsPath } from '../lib/entityStats.ts';
import type { ShareCardSpec } from '../lib/shareCard.ts';
import { Cover } from '../components/Cover.tsx';
import { fmtHours } from '../components/charts.tsx';
import { ShareButton } from '../components/ShareButton.tsx';

const iso = (ts: number) => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const fromIso = (s: string | null) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? ''); return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() : null; };
const short = (ts: number) => new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
export const weekLabel = (start: number) => `${short(start)} – ${short(nextWeek(start) - 1)}`;
const DAYPART = { night: { Icon: Moon, text: 'A night-owl week' }, morning: { Icon: Sunrise, text: 'A morning-music week' }, afternoon: { Icon: Sun, text: 'An afternoon week' }, evening: { Icon: Sunset, text: 'An evening week' } } as const;

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
    footer: 'TurboMusic',
  };
}

function Row({ i, r, kind, image }: { i: number; r: TopRow; kind: 'track' | 'artist' | 'album'; image: string | null | undefined }) {
  const to = r.id ? statsPath(kind, r.id) : null;
  const body = <>
    <span className="w-5 shrink-0 text-center text-sm font-bold tabular-nums text-white/70">{i + 1}</span>
    <Cover kind={kind === 'artist' ? 'artist' : 'album'} hash={image} seed={r.label} className="!h-11 !w-11 shrink-0" />
    <span className="min-w-0 flex-1"><span className="block truncate font-medium">{r.label}</span>{r.sub && <span className="block truncate text-xs text-white/70">{r.sub}</span>}</span>
    <span className="shrink-0 text-xs tabular-nums text-white/70">{r.plays}×</span>
  </>;
  return to ? <Link to={to} className="flex items-center gap-3 rounded-lg px-1 py-1 hover:bg-white/10">{body}</Link> : <div className="flex items-center gap-3 px-1 py-1">{body}</div>;
}

export function RecapsPage() {
  const lib = useLibraryLive();
  const [params, setParams] = useSearchParams();
  const listens = useMemo(() => buildListens(lib), [lib]);
  const weeks = useMemo(() => weeksWithPlays(listens), [listens]);
  const picked = fromIso(params.get('week'));
  const start = picked !== null ? weekStart(picked) : defaultWeek(weeks);
  const r = useMemo(() => (start === null ? null : weeklyRecap(lib, listens, start)), [lib, listens, start]);
  const go = (ts: number) => setParams({ week: iso(ts) }, { replace: true });
  const older = start === null ? null : weeks.find((w) => w < start) ?? null, newer = start === null ? null : [...weeks].reverse().find((w) => w > start) ?? null;

  if (!r || start === null) return (
    <div className="mx-auto max-w-xl space-y-3 p-6 text-center">
      <Gift className="mx-auto text-muted" size={32} /><h1 className="text-2xl font-bold">Weekly recap</h1>
      <p className="text-muted">Nothing to recap yet. Once you have listened to a few songs (30 seconds or more counts), a recap of each week appears here, ready on Sunday. You can also import your Spotify history on the Stats page to get recaps for past weeks.</p>
    </div>);

  const DP = r.daypart ? DAYPART[r.daypart] : null;
  const reactionsTotal = r.reactions.thumbsUp + r.reactions.thumbsDown + r.reactions.votes + r.reactions.memories;
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

      <article className="space-y-5 rounded-theme p-5 text-white shadow-lg" style={{ background: 'linear-gradient(160deg, #7c3aed 0%, #4c1d95 55%, #1e1b4b 100%)' }}>
        <header>
          <div className="text-xs font-semibold uppercase tracking-widest text-white/70">{r.partial ? 'So far this week' : 'Your week in music'}</div>
          <div className="mt-1 text-5xl font-black tabular-nums">{fmtHours(r.ms)}</div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white/80">
            <span>{r.plays.toLocaleString()} plays on {r.activeDays} day{r.activeDays === 1 ? '' : 's'}</span>
            {r.change !== null && <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-xs font-semibold">{r.change >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}{Math.abs(Math.round(r.change * 100))}% {r.change >= 0 ? 'more' : 'less'} than last week</span>}
          </div>
        </header>

        <section><h2 className="mb-1 text-sm font-semibold uppercase tracking-wider text-white/70">Top songs</h2>
          {r.topTracks.map((t, i) => <Row key={t.key} i={i} r={t} kind="track" image={t.id ? lib.trackById.get(t.id)?.cover : null} />)}</section>

        <section><h2 className="mb-1 text-sm font-semibold uppercase tracking-wider text-white/70">Top artists</h2>
          {r.topArtists.map((t, i) => <Row key={t.key} i={i} r={t} kind="artist" image={t.id ? lib.artistById.get(t.id)?.image : null} />)}</section>

        {r.album && <section><h2 className="mb-1 text-sm font-semibold uppercase tracking-wider text-white/70">Album of the week</h2>
          <Row i={0} r={r.album} kind="album" image={r.album.id ? lib.albumById.get(r.album.id)?.cover : null} /></section>}

        <section><h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-white/70">Your reactions</h2>
          {reactionsTotal === 0 ? <p className="text-sm text-white/70">No thumbs, votes or memories this week.</p> : (
            <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              {([['Thumbs up', r.reactions.thumbsUp, ThumbsUp], ['Thumbs down', r.reactions.thumbsDown, ThumbsDown], ['Votes', r.reactions.votes, Swords], ['Memories', r.reactions.memories, Heart]] as const).map(([label, n, Icon]) =>
                <div key={label} className="rounded-lg bg-white/10 p-2.5"><Icon size={15} className="text-white/70" /><div className="mt-1 text-2xl font-bold tabular-nums">{n}</div><div className="text-xs text-white/70">{label}</div></div>)}
            </div>)}
        </section>

        <footer className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-white/75">
          {DP && <span className="inline-flex items-center gap-1"><DP.Icon size={13} />{DP.text}</span>}
          {r.busiestDay && <span className="inline-flex items-center gap-1"><Flame size={13} />Biggest day: {new Date(`${r.busiestDay.key}T12:00`).toLocaleDateString(undefined, { weekday: 'long' })}, {fmtHours(r.busiestDay.ms)}</span>}
          {r.newArtists > 0 && <span>{r.newArtists} new artist{r.newArtists === 1 ? '' : 's'}</span>}
        </footer>
      </article>
      <div className="flex flex-wrap items-center gap-2">
        <ShareButton spec={weekCard(r)} name={`turbomusic-week-${iso(r.from)}`} />
        <span className="text-xs text-muted">Counts plays of 30 seconds or more, Monday to Sunday. {r.partial ? 'This week is not over, so the numbers can still change.' : ''}</span>
      </div>
    </div>
  );
}
