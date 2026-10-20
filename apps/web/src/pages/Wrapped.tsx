import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Gift, Pause, Play } from 'lucide-react';
import { useLibraryLive } from '../lib/derive.ts';
import { buildListens } from '../lib/listens.ts';
import { computeWrapped, PERSONALITIES, wrappedYears, type Wrapped } from '../lib/recap.ts';
import type { TopRow } from '../lib/listenStats.ts';
import { statsPath } from '../lib/entityStats.ts';
import type { ShareCardSpec } from '../lib/shareCard.ts';
import { Cover } from '../components/Cover.tsx';
import { fmtHours } from '../components/charts.tsx';
import { ShareButton } from '../components/ShareButton.tsx';
import { CountUp } from '../components/CountUp.tsx';
import { hourLabel } from '../lib/listenStats.ts';

const SLIDE_MS = 8000;
const i2 = (l: string) => ['thumbs up', 'thumbs down', 'head-to-head votes', 'memories made'].indexOf(l);
const MONTH = (m: string) => new Date(`${m}-15T12:00`).toLocaleDateString(undefined, { month: 'short' });
const MONTH_LONG = (m: string) => new Date(`${m}-15T12:00`).toLocaleDateString(undefined, { month: 'long' });

const BG = [
  'linear-gradient(160deg,#7c3aed,#312e81)', 'linear-gradient(160deg,#db2777,#7c2d12)', 'linear-gradient(160deg,#0891b2,#1e3a8a)', 'linear-gradient(160deg,#16a34a,#064e3b)',
  'linear-gradient(160deg,#ea580c,#7f1d1d)', 'linear-gradient(160deg,#9333ea,#be185d)', 'linear-gradient(160deg,#2563eb,#4c1d95)',
];

/** Share-picture content for a year. */
export function wrappedCard(w: Wrapped): ShareCardSpec {
  return {
    kicker: `${w.year} Wrapped${w.partial ? ' · so far' : ''}`, title: 'My year in music',
    big: { value: w.minutes.toLocaleString(), label: 'minutes listened' },
    sections: [
      { heading: 'Top songs', rows: w.topTracks.map((t) => t.label) },
      { heading: 'Top artists', rows: w.topArtists.map((t) => t.label) },
      { heading: 'Top albums', rows: w.topAlbums.map((t) => t.label) },
      { heading: 'Top genres', rows: w.topGenres.map((g) => g.name) },
    ],
    footer: 'TurboMusic',
  };
}

function Title({ children, sub }: { children: ReactNode; sub?: string }) {
  return <div className="space-y-1"><h2 className="rc-rise text-3xl font-black leading-tight sm:text-4xl">{children}</h2>{sub && <p className="rc-rise text-sm text-white/75" style={{ '--i': 1 } as CSSProperties}>{sub}</p>}</div>;
}
const Big = ({ children }: { children: ReactNode }) => <div className="rc-pop text-6xl font-black leading-none tabular-nums sm:text-7xl">{children}</div>;

function TopList({ rows, kind, image, ranked = true }: { rows: TopRow[]; kind: 'track' | 'artist' | 'album'; image: (r: TopRow) => string | null | undefined; ranked?: boolean }) {
  return (
    <ol className="space-y-2">
      {rows.map((r, i) => {
        const to = r.id ? statsPath(kind, r.id) : null;
        const inner = <>
          {ranked && <span className="w-6 shrink-0 text-center text-xl font-black tabular-nums text-white/80">{i + 1}</span>}
          <Cover kind={kind === 'artist' ? 'artist' : 'album'} hash={image(r)} seed={r.label} className="!h-14 !w-14 shrink-0" />
          <span className="min-w-0 flex-1"><span className="block truncate text-lg font-semibold">{r.label}</span><span className="block truncate text-xs text-white/70">{r.sub || `${fmtHours(r.ms)}`}</span></span>
          <span className="shrink-0 text-sm tabular-nums text-white/80">{r.plays}×</span>
        </>;
        return <li key={r.key} className="rc-rise" style={{ '--i': i + 2 } as CSSProperties}>{to ? <Link to={to} className="flex items-center gap-3 rounded-xl p-1 hover:bg-white/10">{inner}</Link> : <div className="flex items-center gap-3 p-1">{inner}</div>}</li>;
      })}
    </ol>
  );
}

/** The monthly top-artist race as a bump chart: one line per artist, rank 1 at the top. */
function RaceChart({ race }: { race: NonNullable<Wrapped['race']> }) {
  const w = 320, h = 200, px = 14, py = 16, n = race.artists.length;
  const x = (m: number) => px + (m * (w - 2 * px)) / 11, y = (r: number) => py + ((r - 1) * (h - 2 * py)) / Math.max(1, n - 1);
  const colors = ['#fde047', '#f472b6', '#67e8f9', '#86efac', '#fdba74'];
  return (
    <div className="space-y-2">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label="How your top artists ranked month by month">
        {race.ranks.map((rs, a) => {
          let d = '';
          rs.forEach((r, m) => { if (r !== null) d += `${d && rs[m - 1] !== null ? 'L' : 'M'}${x(m).toFixed(1)} ${y(r).toFixed(1)}`; });
          return <g key={a}><path d={d} pathLength={1} className="rc-draw" style={{ '--i': a } as CSSProperties} fill="none" stroke={colors[a % colors.length]} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
            {rs.map((r, m) => r !== null ? <circle key={m} className="rc-pop" style={{ '--d': `${400 + a * 160 + m * 110}ms` } as CSSProperties} cx={x(m)} cy={y(r)} r={m === 11 ? 4.5 : 2.5} fill={colors[a % colors.length]} /> : null)}</g>;
        })}
        {race.months.map((m, i) => i % 3 === 0 ? <text key={m} x={x(i)} y={h - 1} textAnchor="middle" fontSize="9" fill="rgba(255,255,255,.7)">{MONTH(m)}</text> : null)}
      </svg>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">{race.artists.map((a, i) => <li key={a} className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: colors[i % colors.length] }} />{a}</li>)}</ul>
    </div>
  );
}

function Quiz({ w, onAnswered }: { w: Wrapped; onAnswered: (done: boolean) => void }) {
  const [pick, setPick] = useState<number | null>(null);
  const q = w.quiz!;
  useEffect(() => onAnswered(pick !== null), [pick]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="space-y-5">
      <Title sub={pick === null ? 'Tap the one you think you played most.' : undefined}>{pick === null ? 'Guess your number one song' : pick === q.answer ? 'You know yourself.' : 'Not quite…'}</Title>
      <div className="space-y-2">
        {q.options.map((o, i) => {
          const state = pick === null ? 'rc-rise' : i === q.answer ? 'rc-pop ring-2 ring-yellow-300 bg-white/25' : i === pick ? 'rc-shake opacity-60 line-through' : 'rc-rise opacity-50';
          return <button key={o.key} disabled={pick !== null} onClick={() => setPick(i)} style={{ '--i': i + 2, '--d': '0ms' } as CSSProperties} className={`block w-full rounded-xl bg-white/12 px-4 py-3 text-left transition-colors hover:bg-white/20 ${state}`}>
            <span className="block truncate text-lg font-semibold">{o.label}</span><span className="block truncate text-xs text-white/70">{o.sub}</span></button>;
        })}
      </div>
      {pick !== null && <p className="text-sm text-white/80">It was <b>{q.options[q.answer].label}</b>, played {q.options[q.answer].plays} times.</p>}
    </div>
  );
}

function Story({ w }: { w: Wrapped }) {
  const lib = useLibraryLive();
  const [i, setI] = useState(0);
  const [auto, setAuto] = useState(true);
  const [held, setHeld] = useState(false);
  const [quizDone, setQuizDone] = useState(false);
  const [t, setT] = useState(0);
  const [dir, setDir] = useState<'fwd' | 'back'>('fwd');
  const trackImg = (r: TopRow) => (r.id ? lib.trackById.get(r.id)?.cover : null);
  const artistImg = (r: TopRow) => (r.id ? lib.artistById.get(r.id)?.image : null);
  const albumImg = (r: TopRow) => (r.id ? lib.albumById.get(r.id)?.cover : null);
  const daysOfMusic = w.ms / 86_400_000;

  const slides = useMemo(() => {
    const s: { id: string; hold?: boolean; node: ReactNode }[] = [];
    s.push({ id: 'intro', node: <div className="space-y-4"><div className="text-sm font-semibold uppercase tracking-widest text-white/70">TurboMusic</div><Big>{w.year}</Big><Title sub={w.partial ? `January 1 to today. Spotify's version lands in December; this one is ready now.` : undefined}>Your Wrapped</Title></div> });
    s.push({ id: 'minutes', node: <div className="space-y-5"><Title>This year you listened for</Title><Big><CountUp value={w.minutes} ms={1600} /></Big><div className="rc-rise text-2xl font-bold" style={{ '--i': 3 } as CSSProperties}>minutes</div>
      <p className="rc-rise text-white/80" style={{ '--i': 5 } as CSSProperties}>That is {daysOfMusic >= 1 ? `${daysOfMusic.toFixed(1)} days` : fmtHours(w.ms)} of music: {w.plays.toLocaleString()} plays of {w.distinctTracks.toLocaleString()} different songs by {w.distinctArtists.toLocaleString()} artists.</p></div> });
    if (w.quiz) s.push({ id: 'quiz', hold: true, node: <Quiz w={w} onAnswered={setQuizDone} /> });
    if (w.topTracks.length) s.push({ id: 'songs', node: <div className="space-y-4"><Title sub={w.topTracks[0] ? `${w.topTracks[0].label} was on repeat ${w.topTracks[0].plays} times.` : undefined}>Your top songs</Title><TopList rows={w.topTracks} kind="track" image={trackImg} /></div> });
    if (w.topArtists.length) s.push({ id: 'artists', node: <div className="space-y-4"><Title sub={`${w.topArtists[0].label} alone took ${Math.round(w.topArtistShare * 100)}% of your listening time.`}>Your top artists</Title><TopList rows={w.topArtists} kind="artist" image={artistImg} /></div> });
    if (w.topAlbums.length) s.push({ id: 'albums', node: <div className="space-y-4"><Title>Your top albums</Title><TopList rows={w.topAlbums} kind="album" image={albumImg} /></div> });
    if (w.topGenres.length) s.push({ id: 'genres', node: <div className="space-y-4"><Title>Your top genres</Title>
      <ul className="space-y-2">{w.topGenres.map((g, k) => <li key={g.name} className="rc-rise" style={{ '--i': k + 2 } as CSSProperties}><div className="flex justify-between text-lg font-semibold"><span className="capitalize">{k + 1}. {g.name}</span><span className="text-sm tabular-nums text-white/75">{g.plays}×</span></div>
        <div className="mt-1 h-2 rounded-full bg-white/15"><div className="rc-grow h-2 rounded-full bg-white/80" style={{ width: `${(g.plays / w.topGenres[0].plays) * 100}%`, '--i': k + 2 } as CSSProperties} /></div></li>)}</ul></div> });
    if (w.listening) s.push({ id: 'age', node: <div className="space-y-4"><Title sub={`Your most played songs are mostly from ${w.listening.medianYear}. People tend to love the music from their teens most, so by that measure your taste lives in the body of a…`}>Your listening age</Title><Big><CountUp value={w.listening.age} ms={1400} /></Big>
      <p className="text-sm text-white/75">A playful estimate, not science: this year minus the median release year of your top songs, plus 16.</p></div> });
    if (w.phases.length >= 2) s.push({ id: 'phases', node: <div className="space-y-4"><Title sub="Your year came in phases.">Your music evolution</Title>
      <ol className="space-y-3">{w.phases.map((p, k) => <li key={k} className="rc-rise rounded-xl bg-white/12 p-3" style={{ '--i': k + 2 } as CSSProperties}><div className="text-xs uppercase tracking-wider text-white/70">{p.fromMonth === p.toMonth ? MONTH_LONG(p.fromMonth) : `${MONTH_LONG(p.fromMonth)} – ${MONTH_LONG(p.toMonth)}`}</div><div className="text-xl font-bold">{p.name}</div><div className="text-sm text-white/80">{p.artists.join(', ')}</div></li>)}</ol></div> });
    if (w.race) s.push({ id: 'race', node: <div className="space-y-4"><Title sub="Where your top five stood after each month.">Top artist race</Title><RaceChart race={w.race} /></div> });
    s.push({ id: 'days', node: <div className="space-y-4"><Title>When it happened</Title>
      <dl className="space-y-3">
        {w.streak.days > 1 && <div className="rc-rise" style={{ '--i': 2 } as CSSProperties}><dt className="text-xs uppercase tracking-wider text-white/70">Longest streak</dt><dd className="text-3xl font-black"><CountUp value={w.streak.days} ms={1000} /> days in a row</dd></div>}
        {w.busiestMonth && <div className="rc-rise" style={{ '--i': 3 } as CSSProperties}><dt className="text-xs uppercase tracking-wider text-white/70">Busiest month</dt><dd className="text-3xl font-black">{MONTH_LONG(w.busiestMonth.month)}</dd><dd className="text-sm text-white/75">{fmtHours(w.busiestMonth.ms)}</dd></div>}
        {w.peakHour !== null && <div className="rc-rise" style={{ '--i': 4 } as CSSProperties}><dt className="text-xs uppercase tracking-wider text-white/70">Favourite hour</dt><dd className="text-3xl font-black">{hourLabel(w.peakHour).replace(/([ap])$/, ' $1m')}</dd></div>}
        {w.biggestDays[0] && <div className="rc-rise" style={{ '--i': 5 } as CSSProperties}><dt className="text-xs uppercase tracking-wider text-white/70">Biggest day</dt><dd className="text-3xl font-black">{new Date(`${w.biggestDays[0].key}T12:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}</dd><dd className="text-sm text-white/75">{fmtHours(w.biggestDays[0].ms)} of music</dd></div>}
        {w.firstPlay && <div className="rc-rise" style={{ '--i': 6 } as CSSProperties}><dt className="text-xs uppercase tracking-wider text-white/70">First song of the year</dt><dd className="text-xl font-bold">{w.firstPlay.title}</dd><dd className="text-sm text-white/75">{w.firstPlay.artist}</dd></div>}
      </dl></div> });
    const rx = w.reactions;
    if (rx.thumbsUp + rx.thumbsDown + rx.votes + rx.memories > 0) s.push({ id: 'reactions', node: <div className="space-y-4"><Title>How you reacted</Title>
      <div className="grid grid-cols-2 gap-3">{([['thumbs up', rx.thumbsUp], ['thumbs down', rx.thumbsDown], ['head-to-head votes', rx.votes], ['memories made', rx.memories]] as const).map(([l, n]) => <div key={l} className="rc-pop rounded-xl bg-white/12 p-3" style={{ '--i': i2(l) + 2 } as CSSProperties}><div className="text-3xl font-black tabular-nums"><CountUp value={n} ms={900} /></div><div className="text-sm text-white/75">{l}</div></div>)}</div>
      {w.newArtists > 0 && <p className="text-white/80">And you met {w.newArtists} artist{w.newArtists === 1 ? '' : 's'} for the first time.</p>}</div> });
    if (w.personality) { const p = PERSONALITIES[w.personality.kind]; s.push({ id: 'personality', node: <div className="space-y-4"><Title>Your listening personality</Title><Big>{p.name}</Big><p className="rc-rise text-lg text-white/85" style={{ '--i': 4 } as CSSProperties}>{p.blurb}</p><p className="rc-rise text-xs text-white/60" style={{ '--i': 6 } as CSSProperties}>TurboMusic's own set of types, worked out from how often you repeat, explore, stay loyal, and when you listen.</p></div> }); }
    s.push({ id: 'summary', node: <div className="space-y-5"><Title>That was your {w.year}</Title>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <div className="rc-rise" style={{ '--i': 2 } as CSSProperties}><div className="text-xs uppercase tracking-wider text-white/70">Top songs</div>{w.topTracks.slice(0, 3).map((t) => <div key={t.key} className="truncate font-medium">{t.label}</div>)}</div>
        <div className="rc-rise" style={{ '--i': 3 } as CSSProperties}><div className="text-xs uppercase tracking-wider text-white/70">Top artists</div>{w.topArtists.slice(0, 3).map((t) => <div key={t.key} className="truncate font-medium">{t.label}</div>)}</div>
        <div className="rc-rise" style={{ '--i': 4 } as CSSProperties}><div className="text-xs uppercase tracking-wider text-white/70">Top albums</div>{w.topAlbums.slice(0, 3).map((t) => <div key={t.key} className="truncate font-medium">{t.label}</div>)}</div>
        <div className="rc-rise" style={{ '--i': 5 } as CSSProperties}><div className="text-xs uppercase tracking-wider text-white/70">Minutes</div><div className="text-2xl font-black tabular-nums">{w.minutes.toLocaleString()}</div></div>
      </div><ShareButton spec={wrappedCard(w)} name={`turbomusic-wrapped-${w.year}`} label="Save summary picture" /></div> });
    return s;
  }, [w, daysOfMusic]); // eslint-disable-line react-hooks/exhaustive-deps

  const last = slides.length - 1, cur = slides[Math.min(i, last)];
  const paused = !auto || held || (cur.hold && !quizDone);
  const go = (n: number) => { setDir(n < ref.current.i ? 'back' : 'fwd'); setI(Math.max(0, Math.min(last, n))); setT(0); setQuizDone(false); };
  const ref = useRef({ i, last, paused });
  ref.current = { i, last, paused };
  useEffect(() => {
    const id = setInterval(() => {
      const { i: cI, last: cL, paused: p } = ref.current;
      if (p) return;
      setT((x) => { const nx = x + 100 / SLIDE_MS; if (nx < 1) return nx; if (cI < cL) { setDir('fwd'); setI(cI + 1); setQuizDone(false); return 0; } return 1; });
    }, 100);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.key === 'ArrowRight') go(ref.current.i + 1); else if (e.key === 'ArrowLeft') go(ref.current.i - 1);
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="mx-auto w-full max-w-md space-y-3">
      <div className="relative overflow-hidden rounded-theme text-white shadow-xl" style={{ background: BG[i % BG.length], minHeight: 'min(34rem, calc(100dvh - 15rem))' } as CSSProperties}
        onPointerDown={() => setHeld(true)} onPointerUp={() => setHeld(false)} onPointerLeave={() => setHeld(false)} onPointerCancel={() => setHeld(false)}>
        <div className="absolute inset-x-3 top-3 z-10 flex gap-1" aria-hidden>
          {slides.map((s, k) => <div key={s.id} className="h-1 flex-1 overflow-hidden rounded-full bg-white/25"><div className="h-full bg-white" style={{ width: k < i ? '100%' : k === i ? `${Math.min(1, t) * 100}%` : '0%' }} /></div>)}
        </div>
        <button className="absolute inset-y-0 left-0 z-10 w-1/5" aria-label="Previous" onClick={(e) => { e.stopPropagation(); go(i - 1); }} />
        <button className="absolute inset-y-0 right-0 z-10 w-1/5" aria-label="Next" onClick={(e) => { e.stopPropagation(); go(i + 1); }} />
        <div key={cur.id} className={`rc-slide-${dir} flex min-h-[inherit] flex-col justify-center p-7 pt-10`}>{cur.node}</div>
      </div>
      <div className="flex items-center justify-between gap-2">
        <button className="btn" onClick={() => go(i - 1)} disabled={i === 0} aria-label="Previous slide"><ChevronLeft size={16} /></button>
        <button className="btn" onClick={() => setAuto(!auto)}>{auto ? <><Pause size={15} />Pause</> : <><Play size={15} />Play</>}</button>
        <span className="text-xs tabular-nums text-muted">{Math.min(i, last) + 1} / {slides.length}</span>
        <button className="btn" onClick={() => go(i + 1)} disabled={i >= last} aria-label="Next slide"><ChevronRight size={16} /></button>
      </div>
    </div>
  );
}

export function WrappedPage() {
  const lib = useLibraryLive();
  const [params, setParams] = useSearchParams();
  const listens = useMemo(() => buildListens(lib), [lib]);
  const years = useMemo(() => wrappedYears(listens), [listens]);
  const year = Number(params.get('year')) || years[0] || new Date().getFullYear();
  const w = useMemo(() => computeWrapped(lib, listens, year), [lib, listens, year]);
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-2xl font-bold">Wrapped</h1>
        {years.length > 1 && <select className="input w-auto" value={year} onChange={(e) => setParams({ year: e.target.value }, { replace: true })} aria-label="Year">{years.map((y) => <option key={y} value={y}>{y}</option>)}</select>}
        <Link to="/recaps" className="btn"><Gift size={15} />Weekly recap</Link>
      </div>
      {w.plays < 5
        ? <p className="card p-5 text-muted">Not enough listening in {year} yet for a Wrapped (it needs a few plays of 30 seconds or more). Import your Spotify history on the Stats page and every past year gets one too.</p>
        : <Story key={year} w={w} />}
    </div>
  );
}
