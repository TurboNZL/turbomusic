import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { Heart, Moon, Sun, Sunrise, Sunset, Swords, ThumbsDown, ThumbsUp, TrendingDown, TrendingUp } from 'lucide-react';
import type { Library } from '../lib/derive.ts';
import type { WeeklyRecap } from '../lib/recap.ts';
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
export const weekArt = (from: number) => ({ seed: iso(from), motif: MOTIFS[Math.floor(from / 604_800_000) % MOTIFS.length] });
export const WEEK_BG = 'linear-gradient(165deg, #7c3aed 0%, #4c1d95 52%, #1e1b4b 100%)';
const DAYPART = { night: { Icon: Moon, text: 'A night-owl week' }, morning: { Icon: Sunrise, text: 'A morning-music week' }, afternoon: { Icon: Sun, text: 'An afternoon week' }, evening: { Icon: Sunset, text: 'An evening week' } } as const;
const H = ({ children }: { children: string }) => <h2 className="mb-1.5 text-[14px] font-bold uppercase tracking-[0.18em] text-white/70">{children}</h2>;

function Line({ i, base, r, kind, image, round }: { i: number; base: number; r: TopRow; kind: 'track' | 'artist' | 'album'; image: string | null | undefined; round?: boolean }) {
  const still = useStaticRender();
  const body = <>
    <span className="w-7 shrink-0 text-center text-[22px] font-black tabular-nums text-white/60">{i + 1}</span>
    <Cover kind={round ? 'artist' : 'album'} hash={image} seed={r.label} className="!h-[56px] !w-[56px] shrink-0" />
    <span className="min-w-0 flex-1"><span className="block truncate text-[22px] font-semibold leading-tight">{r.label}</span>{r.sub && <span className="block truncate text-[15px] text-white/70">{r.sub}</span>}</span>
    <span className="shrink-0 text-[17px] font-semibold tabular-nums text-white/80">{r.plays}×</span>
  </>;
  const cls = 'rc-rise flex items-center gap-3 rounded-xl py-[3px]';
  const style = { '--i': i + base } as CSSProperties;
  return r.id && !still ? <Link to={statsPath(kind, r.id)} className={`${cls} hover:bg-white/10`} style={style}>{body}</Link> : <div className={cls} style={style}>{body}</div>;
}

/** One week as a single 16:9 card: the numbers on the left, songs in the middle, artists and days on the right, small facts along the bottom. */
export function WeekStage({ r, lib }: { r: WeeklyRecap; lib: Library }) {
  const DP = r.daypart ? DAYPART[r.daypart] : null;
  const rx = r.reactions;
  const best = Math.max(0, ...r.byDay);
  const facts = ([
    ['Longest session', r.longestSessionMs > 0 ? fmtHours(r.longestSessionMs) : null], ['New songs', r.newSongs > 0 ? String(r.newSongs) : null],
    ['Not skipped', r.plays ? `${Math.round(r.completion * 100)}%` : null], ['Top genre', r.topGenre], ['After midnight', r.lateNight > 0 ? `${r.lateNight} plays` : null],
    [r.onRepeat ? `On repeat ×${r.onRepeat.plays}` : 'On repeat', r.onRepeat ? r.onRepeat.label : null], ['New artists', r.newArtists > 0 ? String(r.newArtists) : null],
    [r.busiestDay ? `Biggest day · ${fmtHours(r.busiestDay.ms)}` : 'Biggest day', r.busiestDay ? new Date(`${r.busiestDay.key}T12:00`).toLocaleDateString(undefined, { weekday: 'long' }) : null],
  ] as const).filter(([, v]) => v).slice(0, 6);
  return (
    <StageFrame bg={WEEK_BG} art={weekArt(r.from)}>
      <div className="absolute inset-x-[52px] top-[52px] flex flex-col" style={{ bottom: 48 }}>
        <header>
          <div className="flex items-center justify-between text-[14px] font-bold uppercase tracking-[0.2em] text-white/70"><span>{r.partial ? 'So far this week' : 'Your week in music'}</span>{DP && <span className="inline-flex items-center gap-1.5 normal-case tracking-normal"><DP.Icon size={15} />{DP.text}</span>}</div>
          <div className="mt-1 text-[26px] font-bold leading-tight">{weekLabelOf(r.from, r.to - 1)}</div>
          <div className="mt-2 flex items-end justify-between gap-4">
            <div className="whitespace-nowrap font-black leading-none tabular-nums" style={{ fontSize: Math.min(110, Math.floor(400 / (fmtHours(r.ms).length * 0.56))) }}><CountUp value={r.ms} format={fmtHours} ms={1300} /></div>
            <div className="pb-1 text-right text-[17px] leading-snug text-white/80">{r.plays.toLocaleString()} plays<br />on {r.activeDays} day{r.activeDays === 1 ? '' : 's'}</div>
          </div>
          {r.change !== null && Math.round(r.change * 100) !== 0 && <div className="rc-pop mt-2 inline-flex w-fit items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-[15px] font-semibold">{r.change >= 0 ? <TrendingUp size={16} /> : <TrendingDown size={16} />}{Math.abs(Math.round(r.change * 100))}% {r.change >= 0 ? 'more' : 'less'} than last week</div>}
        </header>

        <section className="mt-5"><H>Top songs</H>
          {r.topTracks.map((t, i) => <Line key={t.key} i={i} base={2} r={t} kind="track" image={t.id ? lib.trackById.get(t.id)?.cover : null} />)}</section>

        <section className="mt-4"><H>Top artists</H>
          {r.topArtists.slice(0, 3).map((t, i) => <Line key={t.key} i={i} base={5} r={t} kind="artist" round image={t.id ? lib.artistById.get(t.id)?.image : null} />)}</section>

        {r.album && <section className="mt-4"><H>Album of the week</H><Line i={0} base={8} r={r.album} kind="album" image={r.album.id ? lib.albumById.get(r.album.id)?.cover : null} /></section>}

        <div className="mt-auto grid grid-cols-[1fr_1.15fr] items-end gap-5">
          <section><H>Your reactions</H>
            <div className="grid grid-cols-2 gap-1.5">
              {([['Thumbs up', rx.thumbsUp, ThumbsUp], ['Thumbs down', rx.thumbsDown, ThumbsDown], ['Votes', rx.votes, Swords], ['Memories', rx.memories, Heart]] as const).map(([label, n, Icon], k) =>
                <div key={label} className="rc-pop flex items-center gap-2 rounded-xl bg-white/10 px-2.5 py-1.5" style={{ '--i': 14 + k } as CSSProperties}><Icon size={16} className="shrink-0 text-white/70" /><div><div className="text-[22px] font-bold leading-none tabular-nums"><CountUp value={n} ms={800} delay={900} /></div><div className="text-[11px] text-white/70">{label}</div></div></div>)}
            </div></section>
          <section><H>Your days</H>
            <div className="flex h-[96px] items-end gap-1.5" role="img" aria-label="Listening time per day">
              {r.byDay.map((ms, k) => <div key={k} className="flex flex-1 flex-col items-center gap-1"><div className={`rc-bar w-full rounded-t ${ms > 0 && ms === best ? 'bg-yellow-300' : 'bg-white/60'}`} style={{ height: `${Math.max(4, (ms / Math.max(1, best)) * 70)}px`, '--i': k } as CSSProperties} /><span className="text-[12px] text-white/70">{['M', 'T', 'W', 'T', 'F', 'S', 'S'][k]}</span></div>)}
            </div></section>
        </div>

        {facts.length > 0 && <div className="mt-4 grid grid-cols-3 gap-2">
          {facts.map(([l, v], k) => <div key={l} className="rc-pop min-w-0 rounded-xl bg-white/10 px-3 py-2" style={{ '--i': 16 + k } as CSSProperties}><div className="truncate text-[11px] uppercase tracking-wider text-white/70">{l}</div><div className={`truncate text-[18px] font-bold ${l === 'Top genre' ? 'capitalize' : ''}`}>{v}</div></div>)}
        </div>}
        <div className="mt-3 text-center text-[11px] font-semibold uppercase tracking-[0.3em] text-white/45">TurboMusic</div>
      </div>
    </StageFrame>
  );
}
