import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Heart, Moon, Sun, Sunrise, Sunset, Swords, ThumbsDown, ThumbsUp, TrendingDown, TrendingUp } from 'lucide-react';
import type { Library } from '../lib/derive.ts';
import type { MonthlyRecap, Reactions, WeeklyRecap } from '../lib/recap.ts';
import type { TopRow } from '../lib/listenStats.ts';
import { statsPath } from '../lib/entityStats.ts';
import { useStaticRender } from '../lib/staticRender.ts';
import { Cover } from './Cover.tsx';
import { CountUp } from './CountUp.tsx';
import { fmtHours } from './charts.tsx';
import { MOTIFS } from './AbstractArt.tsx';
import { StageFrame } from './Stage.tsx';

const iso = (ts: number) => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const short = (ts: number) => new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
export const weekLabelOf = (from: number, to: number) => `${short(from)} – ${short(to)}`;
export const monthLabelOf = (from: number) => new Date(from).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
export const weekArt = (from: number) => ({ seed: iso(from), motif: MOTIFS[Math.floor(from / 604_800_000) % MOTIFS.length] });
export const monthArt = (from: number) => ({ seed: `month-${iso(from)}`, motif: MOTIFS[(new Date(from).getMonth() + 2) % MOTIFS.length] });
export const WEEK_BG = 'linear-gradient(165deg, #7c3aed 0%, #4c1d95 52%, #1e1b4b 100%)';
export const MONTH_BG = 'linear-gradient(165deg, #db2777 0%, #7c2d4a 50%, #1e1b4b 100%)';
const DAYPART = { night: { Icon: Moon, text: 'A night-owl' }, morning: { Icon: Sunrise, text: 'A morning-music' }, afternoon: { Icon: Sun, text: 'An afternoon' }, evening: { Icon: Sunset, text: 'An evening' } } as const;

const H = ({ children }: { children: string }) => <h2 className="mb-2 text-[14px] font-bold uppercase tracking-[0.18em] text-white/70">{children}</h2>;
const rise = (i: number) => ({ '--i': i } as CSSProperties);

/** A thing with a picture that opens its stats page (not in the picture that is saved). */
function Open({ to, className, style, children }: { to: string | null; className: string; style?: CSSProperties; children: ReactNode }) {
  const still = useStaticRender();
  return to && !still ? <Link to={to} className={`${className} hover:bg-white/15`} style={style}>{children}</Link> : <div className={className} style={style}>{children}</div>;
}

/** The best song as a big tile, then the next ones two to a row. */
function SongTiles({ rows, lib, base = 2 }: { rows: TopRow[]; lib: Library; base?: number }) {
  const [first, ...rest] = rows;
  if (!first) return null;
  const cover = (t: TopRow) => (t.id ? lib.trackById.get(t.id)?.cover : null);
  const to = (t: TopRow) => (t.id ? statsPath('track', t.id) : null);
  return (
    <div className="space-y-2">
      <Open to={to(first)} className="rc-rise flex items-center gap-4 rounded-2xl bg-white/12 p-2.5" style={rise(base)}>
        <Cover hash={cover(first)} seed={first.label} className="!h-[100px] !w-[100px] shrink-0" />
        <span className="min-w-0 flex-1"><span className="text-[13px] font-bold uppercase tracking-wider text-yellow-200">Number one</span><span className="block truncate text-[30px] font-black leading-tight">{first.label}</span><span className="block truncate text-[18px] text-white/75">{first.sub}</span></span>
        <span className="shrink-0 pr-2 text-center"><span className="block text-[34px] font-black leading-none tabular-nums">{first.plays}</span><span className="text-[12px] uppercase tracking-wider text-white/70">plays</span></span>
      </Open>
      {rest.length > 0 && <div className="grid grid-cols-2 gap-2">
        {rest.map((t, i) => (
          <Open key={t.key} to={to(t)} className="rc-rise flex items-center gap-2.5 rounded-xl bg-white/10 p-2" style={rise(base + 1 + i)}>
            <Cover hash={cover(t)} seed={t.label} className="!h-[52px] !w-[52px] shrink-0" />
            <span className="min-w-0 flex-1"><span className="block truncate text-[17px] font-semibold leading-tight">{t.label}</span><span className="block truncate text-[13px] text-white/70">{t.sub}</span></span>
            <span className="shrink-0 text-[14px] font-semibold tabular-nums text-white/80">{t.plays}×</span>
          </Open>))}
      </div>}
    </div>
  );
}

/** Artists side by side: a round picture over the name. */
function ArtistRow({ rows, lib, base = 6 }: { rows: TopRow[]; lib: Library; base?: number }) {
  if (!rows.length) return null;
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${rows.length}, minmax(0, 1fr))` }}>
      {rows.map((t, i) => (
        <Open key={t.key} to={t.id ? statsPath('artist', t.id) : null} className="rc-rise flex flex-col items-center gap-1.5 rounded-2xl bg-white/10 px-1.5 py-2.5 text-center" style={rise(base + i)}>
          <Cover kind="artist" hash={t.id ? lib.artistById.get(t.id)?.image : null} seed={t.label} className="!w-full max-w-[96px]" />
          <span className="w-full truncate text-[16px] font-semibold leading-tight">{t.label}</span>
          <span className="text-[13px] text-white/70">{t.plays}×</span>
        </Open>))}
    </div>
  );
}

function AlbumTile({ r, lib, label, base, max = 9999, flat = false }: { r: TopRow; lib: Library; label: string; base: number; max?: number; flat?: boolean }) {
  return (
    <div>
      <H>{label}</H>
      <Open to={r.id ? statsPath('album', r.id) : null} className={`rc-rise flex gap-2 rounded-2xl bg-white/10 p-2.5 ${flat ? 'flex-row items-center' : 'flex-col'}`} style={{ ...rise(base), maxWidth: max }}>
        <Cover hash={r.id ? lib.albumById.get(r.id)?.cover : null} seed={r.label} className={flat ? '!h-[84px] !w-[84px] shrink-0' : '!w-full'} />
        <span className="min-w-0"><span className="block truncate text-[18px] font-semibold leading-tight">{r.label}</span><span className="block truncate text-[13px] text-white/70">{r.sub} · {r.plays}×</span></span>
      </Open>
    </div>
  );
}

/** Only the reactions that are not zero, as chips; nothing at all when there are none. */
function Reacted({ r, base }: { r: Reactions; base: number }) {
  const items = ([['thumbs up', r.thumbsUp, ThumbsUp], ['thumbs down', r.thumbsDown, ThumbsDown], ['votes', r.votes, Swords], ['memories', r.memories, Heart]] as const).filter(([, n]) => n > 0);
  if (!items.length) return null;
  return (
    <div><H>Your reactions</H>
      <div className="flex flex-wrap gap-2">{items.map(([label, n, Icon], k) => <div key={label} className="rc-pop inline-flex items-center gap-2 rounded-full bg-white/12 px-3.5 py-1.5" style={rise(base + k)}><Icon size={17} className="text-white/75" /><span className="text-[22px] font-bold leading-none tabular-nums"><CountUp value={n} ms={800} delay={900} /></span><span className="text-[14px] text-white/75">{label}</span></div>)}</div>
    </div>
  );
}

function Facts({ facts, base }: { facts: readonly (readonly [string, string | null | undefined])[]; base: number }) {
  const shown = facts.filter(([, v]) => v).slice(0, 6) as [string, string][];
  if (!shown.length) return null;
  return (
    <div className="grid grid-cols-3 gap-2">
      {shown.map(([l, v], k) => <div key={l} className="rc-pop min-w-0 rounded-xl bg-white/10 px-3 py-2" style={rise(base + k)}><div className="truncate text-[11px] uppercase tracking-wider text-white/70">{l}</div><div className={`truncate text-[18px] font-bold ${l === 'Top genre' ? 'capitalize' : ''}`}>{v}</div></div>)}
    </div>
  );
}

function Days({ byDay, labels, best, base }: { byDay: number[]; labels: string[]; best: number; base: number }) {
  return (
    <div>
      <H>Your days</H>
      <div className="flex h-[132px] items-end gap-1.5" role="img" aria-label="Listening time per day">
        {byDay.map((ms, k) => <div key={k} className="flex flex-1 flex-col items-center gap-1"><div className={`rc-bar w-full rounded-t ${ms > 0 && ms === best ? 'bg-yellow-300' : 'bg-white/60'}`} style={{ height: `${Math.max(4, (ms / Math.max(1, best)) * 96)}px`, ...rise(base + k) }} /><span className="text-[12px] text-white/70">{labels[k]}</span></div>)}
      </div>
    </div>
  );
}

/**
 * The card's content column. If what a week or month has to show is taller than the card (many songs, long names, every fact present) the
 * whole column is scaled down to fit instead of spilling over the edge of the card and the saved picture.
 */
function Fit({ children }: { children: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null), inner = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(1);
  useLayoutEffect(() => {
    const o = outer.current, i = inner.current;
    if (!o || !i) return;
    const fit = () => {
      const room = o.clientHeight, natural = i.offsetHeight; // offsetHeight ignores the scale transform
      if (room > 0 && natural > 0) setK(Math.min(1, Math.floor((room / natural) * 1000) / 1000));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(i);
    void document.fonts?.ready.then(fit);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={outer} className="absolute inset-x-[52px] top-[48px] overflow-hidden" style={{ bottom: 64 }}>
      <div ref={inner} className="flex flex-col gap-4" style={{ width: `${100 / k}%`, transform: `scale(${k})`, transformOrigin: 'top left' }}>{children}</div>
    </div>
  );
}

const Mark = () => <div className="absolute inset-x-0 bottom-[26px] text-center text-[11px] font-semibold uppercase tracking-[0.3em] text-white/45">TurboMusic</div>;

/** One week as a single 9:16 card. Things at zero are left off. */
export function WeekStage({ r, lib }: { r: WeeklyRecap; lib: Library }) {
  const DP = r.daypart ? DAYPART[r.daypart] : null;
  const best = Math.max(0, ...r.byDay);
  const facts = [
    ['Longest session', r.longestSessionMs > 0 ? fmtHours(r.longestSessionMs) : null], ['New songs', r.newSongs > 0 ? String(r.newSongs) : null],
    ['Not skipped', r.plays && r.completion < 1 ? `${Math.round(r.completion * 100)}%` : null], ['Top genre', r.topGenre], ['After midnight', r.lateNight > 0 ? `${r.lateNight} plays` : null],
    [r.onRepeat ? `On repeat ×${r.onRepeat.plays}` : 'On repeat', r.onRepeat ? r.onRepeat.label : null], ['New artists', r.newArtists > 0 ? String(r.newArtists) : null],
    [r.busiestDay ? `Biggest day · ${fmtHours(r.busiestDay.ms)}` : 'Biggest day', r.busiestDay ? new Date(`${r.busiestDay.key}T12:00`).toLocaleDateString(undefined, { weekday: 'long' }) : null],
  ] as const;
  return (
    <StageFrame bg={WEEK_BG} art={weekArt(r.from)}>
      <Fit>
        <header>
          <div className="flex items-center justify-between text-[14px] font-bold uppercase tracking-[0.2em] text-white/70"><span>{r.partial ? 'So far this week' : 'Your week in music'}</span>{DP && <span className="inline-flex items-center gap-1.5 normal-case tracking-normal"><DP.Icon size={15} />{DP.text} week</span>}</div>
          <div className="mt-1 text-[26px] font-bold leading-tight">{weekLabelOf(r.from, r.to - 1)}</div>
          <div className="mt-2 flex items-end justify-between gap-4">
            <div className="whitespace-nowrap font-black leading-none tabular-nums" style={{ fontSize: Math.min(110, Math.floor(400 / (fmtHours(r.ms).length * 0.56))) }}><CountUp value={r.ms} format={fmtHours} ms={1300} /></div>
            <div className="pb-1 text-right text-[17px] leading-snug text-white/80">{r.plays.toLocaleString()} plays<br />on {r.activeDays} day{r.activeDays === 1 ? '' : 's'}</div>
          </div>
          {r.change !== null && Math.round(r.change * 100) !== 0 && <div className="rc-pop mt-2 inline-flex w-fit items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-[15px] font-semibold">{r.change >= 0 ? <TrendingUp size={16} /> : <TrendingDown size={16} />}{Math.abs(Math.round(r.change * 100))}% {r.change >= 0 ? 'more' : 'less'} than last week</div>}
        </header>
        {r.topTracks.length > 0 && <section><H>Top songs</H><SongTiles rows={r.topTracks} lib={lib} /></section>}
        {r.topArtists.length > 0 && <section><H>Top artists</H><ArtistRow rows={r.topArtists} lib={lib} /></section>}
        <div className="grid grid-cols-[0.9fr_1.1fr] items-end gap-4">
          {r.album ? <AlbumTile r={r.album} lib={lib} label="Album of the week" base={11} /> : <span />}
          {r.activeDays > 1 && <Days byDay={r.byDay} labels={['M', 'T', 'W', 'T', 'F', 'S', 'S']} best={best} base={12} />}
        </div>
        <Reacted r={r.reactions} base={19} />
        <Facts facts={facts} base={22} />
      </Fit>
      <Mark />
    </StageFrame>
  );
}

/** One month as a 9:16 card: totals, a calendar coloured by how much you listened, the top songs and artists, discoveries and streaks. */
export function MonthStage({ r, lib }: { r: MonthlyRecap; lib: Library }) {
  const DP = r.daypart ? DAYPART[r.daypart] : null;
  const first = new Date(r.from), offset = (first.getDay() + 6) % 7, best = Math.max(0, ...r.byDay);
  const cells = [...Array<null>(offset).fill(null), ...r.byDay];
  const heat = (ms: number) => (ms <= 0 ? 'rgba(255,255,255,0.08)' : `rgba(253, 224, 71, ${0.22 + 0.78 * (ms / best)})`);
  const facts = [
    ['Longest streak', r.streak.days > 1 ? `${r.streak.days} days` : null], ['Longest session', r.longestSessionMs > 0 ? fmtHours(r.longestSessionMs) : null],
    ['New songs', r.newSongs > 0 ? String(r.newSongs) : null], ['Top genre', r.topGenres[0]?.name],
    ['Not skipped', r.plays && r.completion < 1 ? `${Math.round(r.completion * 100)}%` : null], ['After midnight', r.lateNight > 0 ? `${r.lateNight} plays` : null],
    [r.onRepeat ? `On repeat ×${r.onRepeat.plays}` : 'On repeat', r.onRepeat?.label],
    ['Per active day', r.avgPerActiveDayMs > 0 ? fmtHours(r.avgPerActiveDayMs) : null],
  ] as const;
  return (
    <StageFrame bg={MONTH_BG} art={monthArt(r.from)}>
      <Fit>
        <header>
          <div className="flex items-center justify-between text-[14px] font-bold uppercase tracking-[0.2em] text-white/70"><span>{r.partial ? 'So far this month' : 'Your month in music'}</span>{DP && <span className="inline-flex items-center gap-1.5 normal-case tracking-normal"><DP.Icon size={15} />{DP.text} month</span>}</div>
          <div className="mt-1 text-[28px] font-bold leading-tight">{monthLabelOf(r.from)}</div>
          <div className="mt-2 flex items-end justify-between gap-4">
            <div className="whitespace-nowrap font-black leading-none tabular-nums" style={{ fontSize: Math.min(110, Math.floor(400 / (fmtHours(r.ms).length * 0.56))) }}><CountUp value={r.ms} format={fmtHours} ms={1300} /></div>
            <div className="pb-1 text-right text-[17px] leading-snug text-white/80">{r.plays.toLocaleString()} plays<br />on {r.activeDays} of {r.byDay.length} days</div>
          </div>
          {r.change !== null && Math.round(r.change * 100) !== 0 && <div className="rc-pop mt-2 inline-flex w-fit items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-[15px] font-semibold">{r.change >= 0 ? <TrendingUp size={16} /> : <TrendingDown size={16} />}{Math.abs(Math.round(r.change * 100))}% {r.change >= 0 ? 'more' : 'less'} than last month</div>}
        </header>
        <section>
          <H>Your month</H>
          <div className="grid grid-cols-7 gap-1.5" role="img" aria-label="Listening per day of the month">
            {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <div key={i} className="text-center text-[12px] text-white/60">{d}</div>)}
            {cells.map((ms, i) => ms === null ? <div key={i} /> : (
              <div key={i} className="rc-pop flex aspect-[2.3/1] items-center justify-center rounded-lg text-[14px] font-semibold" style={{ background: heat(ms), color: ms > 0 && ms / best > 0.55 ? '#2b1245' : '#fff', ...rise(Math.floor(i / 7)) }}>{i - offset + 1}</div>))}
          </div>
          {r.busiestDay && <div className="mt-1.5 text-[14px] text-white/80">Biggest day: {new Date(r.from + (r.busiestDay.day - 1) * 86_400_000 + 43_200_000).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}, {fmtHours(r.busiestDay.ms)}.</div>}
        </section>
        {r.topTracks.length > 0 && <section><H>Top songs</H><SongTiles rows={r.topTracks.slice(0, 3)} lib={lib} base={4} /></section>}
        {r.topArtists.length > 0 && <section><H>Top artists</H><ArtistRow rows={r.topArtists} lib={lib} base={8} /></section>}
        <div className="grid grid-cols-[1.1fr_0.9fr] items-start gap-4">
          {r.album ? <AlbumTile r={r.album} lib={lib} label="Album of the month" base={14} flat /> : <span />}
          <div className="space-y-3">
            {r.discoveries.count > 0 && <div><H>Discovered</H><div className="rc-rise rounded-2xl bg-white/10 px-3 py-2.5" style={rise(15)}><div className="text-[34px] font-black leading-none tabular-nums"><CountUp value={r.discoveries.count} ms={900} /></div><div className="text-[13px] text-white/70">new artist{r.discoveries.count === 1 ? '' : 's'}</div><div className="mt-1 truncate text-[15px] font-semibold">{r.discoveries.names.join(', ')}</div></div></div>}
            {r.topGenres.length > 0 && <div><H>Genres</H><div className="flex flex-wrap gap-1.5">{r.topGenres.map((g, i) => <span key={g.name} className="rc-pop rounded-full bg-white/12 px-3 py-1 text-[15px] font-semibold capitalize" style={rise(16 + i)}>{g.name}</span>)}</div></div>}
          </div>
        </div>
        <Reacted r={r.reactions} base={20} />
        <Facts facts={facts} base={24} />
      </Fit>
      <Mark />
    </StageFrame>
  );
}
