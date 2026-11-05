import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Gift, Pause, Play } from 'lucide-react';
import { useLibraryLive, type Library } from '../lib/derive.ts';
import { buildListens } from '../lib/listens.ts';
import { computeWrapped, PERSONALITIES, wrappedYears, type Wrapped } from '../lib/recap.ts';
import { hourLabel, type TopRow } from '../lib/listenStats.ts';
import { statsPath } from '../lib/entityStats.ts';
import { editionFor, type Edition, type SlideId } from '../lib/wrappedEditions.ts';
import { useStaticRender } from '../lib/staticRender.ts';
import type { ShareCardSpec } from '../lib/shareCard.ts';
import { Cover } from '../components/Cover.tsx';
import { fmtHours } from '../components/charts.tsx';
import { ShareButton } from '../components/ShareButton.tsx';
import { CountUp } from '../components/CountUp.tsx';
import { Stage, StageFrame } from '../components/Stage.tsx';
import type { Motif } from '../components/AbstractArt.tsx';

const SLIDE_MS = 8000;
const MOTIF: Record<SlideId, Motif> = { intro: 'rings', minutes: 'blobs', quiz: 'dots', songs: 'waves', topartist: 'arcs', artists: 'arcs', albums: 'stripes', genres: 'blobs', age: 'rings', phases: 'waves', race: 'dots', day: 'stripes', marathon: 'rings', decades: 'blobs', numbers: 'dots', days: 'arcs', reactions: 'waves', personality: 'arcs', summary: 'blobs' };
const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const dayLong = (key: string) => new Date(`${key}T12:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'long' });
const MONTH = (m: string) => new Date(`${m}-15T12:00`).toLocaleDateString(undefined, { month: 'short' });
const MONTH_LONG = (m: string) => new Date(`${m}-15T12:00`).toLocaleDateString(undefined, { month: 'long' });
const rise = (i: number) => ({ '--i': i } as CSSProperties);

/** Plain-drawing fallback (used only if the browser cannot photograph the card). */
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
    footer: 'TurboMusic', art: { seed: `${w.year}-summary`, motif: 'blobs' },
  };
}

// ------------------------------------------------------------------ building blocks (all sizes are in 720 x 1280 card pixels, 9:16)

/** The words on top, the picture or list below (the card is portrait). `ratio` is kept so the slides read the same; it no longer matters. */
function Split({ left, right }: { left: ReactNode; right: ReactNode; ratio?: string }) {
  return <div className="absolute inset-0 flex flex-col justify-center gap-8 px-[56px] pb-[64px] pt-[76px]"><div className="space-y-4">{left}</div><div className="min-w-0">{right}</div></div>;
}
function Title({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return <div className="space-y-2"><h2 className="rc-rise text-[54px] font-black leading-[1.05]">{children}</h2>{sub && <p className="rc-rise text-[23px] leading-snug text-white/80" style={rise(1)}>{sub}</p>}</div>;
}
/** A huge figure; `chars` (how long it will read) shrinks it so it never runs off the card. */
const Big = ({ children, size = 170, chars = 4 }: { children: ReactNode; size?: number; chars?: number }) => <div className="rc-pop whitespace-nowrap font-black leading-none tabular-nums" style={{ fontSize: Math.min(size, Math.floor(608 / (Math.max(1, chars) * 0.6))) }}>{children}</div>;
const Kicker = ({ children }: { children: ReactNode }) => <div className="text-[18px] font-bold uppercase tracking-[0.22em] text-white/70">{children}</div>;
const Card = ({ i, children, className = '' }: { i: number; children: ReactNode; className?: string }) => <div className={`rc-pop rounded-2xl bg-white/12 px-5 py-4 ${className}`} style={rise(i + 2)}>{children}</div>;

function TopList({ rows, kind, image, ranked = true }: { rows: TopRow[]; kind: 'track' | 'artist' | 'album'; image: (r: TopRow) => string | null | undefined; ranked?: boolean }) {
  const still = useStaticRender();
  return (
    <ol className="space-y-1.5">
      {rows.map((r, i) => {
        const body = <>
          {ranked && <span className="w-10 shrink-0 text-center text-[34px] font-black tabular-nums text-white/70">{i + 1}</span>}
          <Cover kind={kind === 'artist' ? 'artist' : 'album'} hash={image(r)} seed={r.label} className="!h-[80px] !w-[80px] shrink-0" />
          <span className="min-w-0 flex-1"><span className="block truncate text-[28px] font-semibold leading-tight">{r.label}</span><span className="block truncate text-[19px] text-white/70">{r.sub || fmtHours(r.ms)}</span></span>
          <span className="shrink-0 text-[22px] font-semibold tabular-nums text-white/80">{r.plays}×</span>
        </>;
        const cls = 'flex items-center gap-4 rounded-2xl p-1.5';
        return <li key={r.key} className="rc-rise" style={rise(i + 2)}>{r.id && !still ? <Link to={statsPath(kind, r.id)} className={`${cls} hover:bg-white/10`}>{body}</Link> : <div className={cls}>{body}</div>}</li>;
      })}
    </ol>
  );
}

function Bars({ items, unit = '×' }: { items: { label: string; value: number }[]; unit?: string }) {
  const top = Math.max(1, ...items.map((x) => x.value));
  return (
    <ul className="space-y-4">
      {items.map((g, k) => <li key={g.label} className="rc-rise" style={rise(k + 2)}>
        <div className="flex justify-between text-[28px] font-semibold"><span className="capitalize">{k + 1}. {g.label}</span><span className="text-[20px] tabular-nums text-white/75">{g.value}{unit}</span></div>
        <div className="mt-1.5 h-3 rounded-full bg-white/15"><div className="rc-grow h-3 rounded-full bg-white/85" style={{ width: `${(g.value / top) * 100}%`, ...rise(k + 2) }} /></div></li>)}
    </ul>
  );
}

/** The monthly top-artist race as a bump chart: one line per artist, rank 1 at the top. */
function RaceChart({ race }: { race: NonNullable<Wrapped['race']> }) {
  const w = 608, h = 460, px = 26, py = 26, n = race.artists.length;
  const x = (m: number) => px + (m * (w - 2 * px)) / 11, y = (r: number) => py + ((r - 1) * (h - 2 * py - 18)) / Math.max(1, n - 1);
  const colors = ['#fde047', '#f472b6', '#67e8f9', '#86efac', '#fdba74'];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label="How your top artists ranked month by month">
      {race.ranks.map((rs, a) => {
        let d = '';
        rs.forEach((r, m) => { if (r !== null) d += `${d && rs[m - 1] !== null ? 'L' : 'M'}${x(m).toFixed(1)} ${y(r).toFixed(1)}`; });
        return <g key={a}><path d={d} pathLength={1} className="rc-draw" style={rise(a)} fill="none" stroke={colors[a % colors.length]} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" />
          {rs.map((r, m) => r !== null ? <circle key={m} className="rc-pop" style={{ '--d': `${400 + a * 160 + m * 110}ms` } as CSSProperties} cx={x(m)} cy={y(r)} r={m === 11 ? 8 : 4.5} fill={colors[a % colors.length]} /> : null)}</g>;
      })}
      {race.months.map((m, i) => i % 2 === 0 ? <text key={m} x={x(i)} y={h - 2} textAnchor="middle" fontSize="15" fill="rgba(255,255,255,.75)">{MONTH(m)}</text> : null)}
    </svg>
  );
}

function Quiz({ w, onAnswered }: { w: Wrapped; onAnswered: (done: boolean) => void }) {
  const [pick, setPick] = useState<number | null>(null);
  const q = w.quiz!;
  useEffect(() => onAnswered(pick !== null), [pick]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Split
      left={<><Title sub={pick === null ? 'Tap the one you think you played most.' : <>It was <b>{q.options[q.answer].label}</b>, played {q.options[q.answer].plays} times.</>}>{pick === null ? 'Guess your number one song' : pick === q.answer ? 'You know yourself.' : 'Not quite…'}</Title></>}
      right={<div className="space-y-3">
        {q.options.map((o, i) => {
          const state = pick === null ? 'rc-rise' : i === q.answer ? 'rc-pop ring-4 ring-yellow-300 bg-white/25' : i === pick ? 'rc-shake opacity-60 line-through' : 'rc-rise opacity-50';
          return <button key={o.key} disabled={pick !== null} onClick={() => setPick(i)} style={{ '--i': i + 2, '--d': '0ms' } as CSSProperties} className={`block w-full rounded-2xl bg-white/12 px-6 py-4 text-left transition-colors hover:bg-white/20 ${state}`}>
            <span className="block truncate text-[30px] font-semibold">{o.label}</span><span className="block truncate text-[19px] text-white/70">{o.sub}</span></button>;
        })}
      </div>} />
  );
}

/** What a slide needs besides the year's numbers. */
interface Ctx { w: Wrapped; lib: Library; edition: Edition; onAnswered: (done: boolean) => void }

function buildSlide(id: SlideId, { w, lib, edition, onAnswered }: Ctx): ReactNode | null {
  const trackImg = (r: TopRow) => (r.id ? lib.trackById.get(r.id)?.cover : null);
  const artistImg = (r: TopRow) => (r.id ? lib.artistById.get(r.id)?.image : null);
  const albumImg = (r: TopRow) => (r.id ? lib.albumById.get(r.id)?.cover : null);
  const days = w.ms / 86_400_000;
  switch (id) {
    case 'intro': {
      const covers = [...new Set([...w.topAlbums.map(albumImg), ...w.topTracks.map(trackImg)].filter((x): x is string => !!x))].slice(0, 9);
      const seeds = [...w.topTracks, ...w.topAlbums].map((r) => r.label);
      return <Split ratio="1.1fr 1fr"
        left={<><Kicker>TurboMusic</Kicker><Big size={230}>{w.year}</Big><Title sub={w.partial ? 'January 1 to today. Spotify’s version lands in December; this one is ready now.' : undefined}>{edition.year < 2016 ? 'Your year in music' : `Your ${edition.name}`}</Title></>}
        right={<div className="grid grid-cols-3 gap-3">{Array.from({ length: 9 }, (_, i) => <div key={i} className="rc-pop" style={rise(i)}><Cover hash={covers[i]} seed={seeds[i] ?? String(i)} className="!w-full" /></div>)}</div>} />;
    }
    case 'minutes':
      return <Split
        left={<><Title>This year you listened for</Title><Big size={190} chars={w.minutes.toLocaleString().length}><CountUp value={w.minutes} ms={1600} /></Big><div className="rc-rise text-[40px] font-bold" style={rise(3)}>minutes</div></>}
        right={<div className="grid grid-cols-2 gap-4">
          <Card i={1}><div className="text-[18px] uppercase tracking-wider text-white/70">That is</div><div className="text-[52px] font-black leading-tight">{days >= 1 ? `${days.toFixed(1)} days` : fmtHours(w.ms)}</div><div className="text-[18px] text-white/75">of music</div></Card>
          <Card i={2}><div className="text-[18px] uppercase tracking-wider text-white/70">Plays</div><div className="text-[52px] font-black leading-tight tabular-nums"><CountUp value={w.plays} ms={1200} /></div></Card>
          <Card i={3}><div className="text-[18px] uppercase tracking-wider text-white/70">Different songs</div><div className="text-[52px] font-black leading-tight tabular-nums"><CountUp value={w.distinctTracks} ms={1200} /></div></Card>
          <Card i={4}><div className="text-[18px] uppercase tracking-wider text-white/70">Artists</div><div className="text-[52px] font-black leading-tight tabular-nums"><CountUp value={w.distinctArtists} ms={1200} /></div></Card></div>} />;
    case 'quiz':
      return w.quiz ? <Quiz w={w} onAnswered={onAnswered} /> : null;
    case 'topartist': {
      const a = w.topArtists[0];
      if (!a) return null;
      return <Split
        left={<><Kicker>Your top artist</Kicker><h2 className="rc-pop text-[76px] font-black leading-[1.02]">{a.label}</h2><Title sub={`${Math.round(w.topArtistShare * 100)}% of your listening time went to them: ${fmtHours(a.ms)} over ${a.plays} plays.`}>{' '}</Title></>}
        right={<div className="rc-pop mx-auto w-[420px]" style={rise(2)}><Cover kind="artist" hash={artistImg(a)} seed={a.label} className="!w-full" /></div>} />;
    }
    case 'songs': {
      if (!w.topTracks.length) return null;
      return <Split ratio="0.8fr 1.2fr"
        left={<><Title sub={`${w.topTracks[0].label} was on repeat ${w.topTracks[0].plays} times.`}>Your top songs</Title><div className="rc-pop w-[230px]" style={rise(2)}><Cover hash={trackImg(w.topTracks[0])} seed={w.topTracks[0].label} className="!w-full" /></div></>}
        right={<TopList rows={w.topTracks} kind="track" image={trackImg} />} />;
    }
    case 'artists': {
      if (!w.topArtists.length) return null;
      return <Split ratio="0.8fr 1.2fr"
        left={<><Title sub={`${w.topArtists[0].label} alone took ${Math.round(w.topArtistShare * 100)}% of your listening time.`}>Your top artists</Title><div className="rc-pop w-[230px]" style={rise(2)}><Cover kind="artist" hash={artistImg(w.topArtists[0])} seed={w.topArtists[0].label} className="!w-full" /></div></>}
        right={<TopList rows={w.topArtists} kind="artist" image={artistImg} />} />;
    }
    case 'albums': {
      if (!w.topAlbums.length) return null;
      return <Split ratio="0.8fr 1.2fr"
        left={<><Title sub={`${w.topAlbums[0].label} was your album of the year.`}>Your top albums</Title><div className="rc-pop w-[230px]" style={rise(2)}><Cover hash={albumImg(w.topAlbums[0])} seed={w.topAlbums[0].label} className="!w-full" /></div></>}
        right={<TopList rows={w.topAlbums} kind="album" image={albumImg} />} />;
    }
    case 'genres':
      return w.topGenres.length ? <Split left={<Title sub={`${w.topGenres[0].name} led the way.`}>Your top genres</Title>} right={<Bars items={w.topGenres.map((g) => ({ label: g.name, value: g.plays }))} />} /> : null;
    case 'age':
      return w.listening ? <Split
        left={<><Title sub={`Your most played songs are mostly from ${w.listening.medianYear}.`}>Your listening age</Title><Big size={230}><CountUp value={w.listening.age} ms={1400} /></Big></>}
        right={<div className="space-y-4"><Card i={1}><div className="text-[18px] uppercase tracking-wider text-white/70">Your songs come from</div><div className="text-[88px] font-black leading-none">{w.listening.medianYear}</div></Card>
          <p className="rc-rise text-[22px] leading-snug text-white/80" style={rise(3)}>People tend to love the music from their teens most, so by that measure your taste lives in the body of a {w.listening.age}-year-old.</p>
          <p className="rc-rise text-[17px] text-white/65" style={rise(4)}>A playful estimate, not science: this year minus the median release year of your top songs, plus 16.</p></div>} /> : null;
    case 'phases':
      return w.phases.length >= 2 ? <Split left={<Title sub="Your year came in phases.">Your music evolution</Title>}
        right={<ol className="space-y-3">{w.phases.map((p, k) => <li key={k} className="rc-rise rounded-2xl bg-white/12 px-6 py-4" style={rise(k + 2)}>
          <div className="text-[17px] uppercase tracking-wider text-white/70">{p.fromMonth === p.toMonth ? MONTH_LONG(p.fromMonth) : `${MONTH_LONG(p.fromMonth)} – ${MONTH_LONG(p.toMonth)}`}</div>
          <div className="text-[38px] font-bold leading-tight">{p.name}</div><div className="text-[20px] text-white/80">{p.artists.join(', ')}</div></li>)}</ol>} /> : null;
    case 'race':
      return w.race ? <Split ratio="0.7fr 1.3fr" left={<><Title sub="Where your top five stood after each month.">Top artist race</Title>
        <ul className="space-y-1.5 text-[22px]">{w.race.artists.map((a, i) => <li key={a} className="inline-flex w-full items-center gap-2.5"><span className="inline-block h-3.5 w-3.5 rounded-full" style={{ background: ['#fde047', '#f472b6', '#67e8f9', '#86efac', '#fdba74'][i % 5] }} />{a}</li>)}</ul></>}
        right={<RaceChart race={w.race} />} /> : null;
    case 'day': {
      if (w.peakHour === null) return null;
      const maxH = Math.max(1, ...w.hours), maxD = Math.max(1, ...w.weekdays);
      return <Split ratio="0.8fr 1.2fr"
        left={<><Title sub={w.lateNight > 0 ? `${w.lateNight.toLocaleString()} plays came after midnight.` : undefined}>{`Your day runs on ${hourLabel(w.peakHour).replace(/([ap])$/, ' $1m')}`}</Title><p className="rc-rise text-[24px] text-white/85" style={rise(3)}>{Math.round(w.weekendShare * 100)}% of your plays were on weekends.</p></>}
        right={<div className="space-y-6">
          <div><div className="flex h-[230px] items-end gap-[4px]" role="img" aria-label="Listening by hour of the day">{w.hours.map((h, k) => <div key={k} className={`rc-bar flex-1 rounded-t ${k === w.peakHour ? 'bg-yellow-300' : 'bg-white/70'}`} style={{ height: `${Math.max(3, (h / maxH) * 100)}%`, ...rise(k) }} />)}</div>
            <div className="mt-1.5 flex justify-between text-[15px] text-white/70"><span>12a</span><span>6a</span><span>12p</span><span>6p</span><span>11p</span></div></div>
          <div><div className="flex h-[96px] items-end gap-3">{w.weekdays.map((d, k) => <div key={k} className="rc-bar flex-1 rounded-t bg-white/55" style={{ height: `${Math.max(6, (d / maxD) * 100)}%`, ...rise(k + 24) }} />)}</div>
            <div className="mt-1.5 flex gap-3 text-[15px] text-white/70">{DAYS.map((d, k) => <span key={k} className="flex-1 text-center">{d}</span>)}</div></div></div>} />;
    }
    case 'marathon':
      return w.longestSession || w.obsession ? <Split left={<Title>Your marathons</Title>}
        right={<div className="space-y-5">
          {w.longestSession && <Card i={1}><div className="text-[18px] uppercase tracking-wider text-white/70">Longest listening session</div><div className="text-[80px] font-black leading-tight"><CountUp value={w.longestSession.ms} format={fmtHours} ms={1400} /></div><div className="text-[19px] text-white/75">{new Date(w.longestSession.start).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}, without a break of half an hour.</div></Card>}
          {w.obsession && <Card i={3}><div className="text-[18px] uppercase tracking-wider text-white/70">Your obsession</div><div className="text-[40px] font-black leading-tight">{w.obsession.label}</div><div className="text-[19px] text-white/80">{w.obsession.artist} · played {w.obsession.plays} times on {dayLong(w.obsession.day)}.</div></Card>}</div>} /> : null;
    case 'decades':
      return w.decades.length >= 2 ? <Split left={<Title sub="When your songs were released.">Your music by decade</Title>} right={<Bars items={w.decades.map((d) => ({ label: d.label, value: d.plays }))} />} /> : null;
    case 'numbers': {
      const tiles: [string, ReactNode, string][] = [];
      if (w.newSongs > 0) tiles.push(['New to you', <CountUp key="n" value={w.newSongs} ms={1000} />, 'songs you had never played before']);
      if (w.topFiveShare > 0) tiles.push(['Your inner circle', <><CountUp key="t" value={Math.round(w.topFiveShare * 100)} ms={1000} />%</>, 'of plays were your top 5 artists']);
      tiles.push(['Skipped', <><CountUp key="s" value={Math.round(w.skipRate * 100)} ms={1000} />%</>, 'of plays you cut short']);
      if (w.albums > 0) tiles.push(['That is about', <CountUp key="a" value={w.albums} ms={1100} />, 'full albums of 40 minutes']);
      if (w.busiestSeason) tiles.push(['Your season', <span key="se" className="capitalize">{w.busiestSeason}</span>, 'was the loudest']);
      if (w.lateNight > 0) tiles.push(['After midnight', <CountUp key="l" value={w.lateNight} ms={1000} />, 'plays between 12 and 5 a.m.']);
      if (w.lastPlay) tiles.push(['Latest', <span key="lp" className="text-[30px] leading-tight">{w.lastPlay.title}</span>, w.lastPlay.artist]);
      return <Split ratio="0.7fr 1.3fr" left={<Title>Your year in numbers</Title>}
        right={<div className="grid grid-cols-2 gap-4">{tiles.slice(0, 6).map(([l, v, sub], k) => <Card key={l} i={k}><div className="text-[17px] uppercase tracking-wider text-white/70">{l}</div><div className="text-[58px] font-black leading-tight tabular-nums">{v}</div><div className="truncate text-[18px] text-white/75">{sub}</div></Card>)}</div>} />;
    }
    case 'days': {
      const rows: [string, ReactNode, string][] = [];
      if (w.streak.days > 1) rows.push(['Longest streak', <><CountUp value={w.streak.days} ms={1000} /> days</>, 'in a row with music']);
      if (w.busiestMonth) rows.push(['Busiest month', MONTH_LONG(w.busiestMonth.month), fmtHours(w.busiestMonth.ms)]);
      if (w.peakHour !== null) rows.push(['Favourite hour', hourLabel(w.peakHour).replace(/([ap])$/, ' $1m'), 'when you listened most']);
      if (w.biggestDays[0]) rows.push(['Biggest day', dayLong(w.biggestDays[0].key), `${fmtHours(w.biggestDays[0].ms)} of music`]);
      if (w.firstPlay) rows.push(['First song of the year', <span key="f" className="text-[34px]">{w.firstPlay.title}</span>, w.firstPlay.artist]);
      return <Split left={<Title>When it happened</Title>} right={<div className="grid grid-cols-2 gap-4">{rows.slice(0, 6).map(([l, v, sub], k) => <Card key={l} i={k}><div className="text-[17px] uppercase tracking-wider text-white/70">{l}</div><div className="text-[44px] font-black leading-tight">{v}</div><div className="truncate text-[18px] text-white/75">{sub}</div></Card>)}</div>} />;
    }
    case 'reactions': {
      const rx = w.reactions;
      if (rx.thumbsUp + rx.thumbsDown + rx.votes + rx.memories === 0) return null;
      return <Split left={<><Title>How you reacted</Title>{w.newArtists > 0 && <p className="rc-rise text-[24px] text-white/85" style={rise(3)}>And you met {w.newArtists} artist{w.newArtists === 1 ? '' : 's'} for the first time.</p>}</>}
        right={<div className="grid grid-cols-2 gap-4">{([['thumbs up', rx.thumbsUp], ['thumbs down', rx.thumbsDown], ['head-to-head votes', rx.votes], ['memories made', rx.memories]] as const).map(([l, n], k) => <Card key={l} i={k}><div className="text-[72px] font-black leading-tight tabular-nums"><CountUp value={n} ms={900} /></div><div className="text-[21px] text-white/75">{l}</div></Card>)}</div>} />;
    }
    case 'personality': {
      if (!w.personality) return null;
      const p = PERSONALITIES[w.personality.kind];
      return <Split left={<><Title>Your listening personality</Title><Big size={84} chars={p.name.length}>{p.name}</Big></>}
        right={<div className="space-y-5"><p className="rc-rise text-[32px] leading-snug text-white/90" style={rise(3)}>{p.blurb}</p><p className="rc-rise text-[17px] text-white/60" style={rise(5)}>TurboMusic’s own set of types, worked out from how often you repeat, explore, stay loyal, and when you listen.</p></div>} />;
    }
    case 'summary': {
      const col = (h: string, rows: TopRow[], i: number) => <div className="rc-rise min-w-0" style={rise(i)}><Kicker>{h}</Kicker><ol className="mt-1.5 space-y-0.5">{rows.slice(0, 5).map((t, k) => <li key={t.key} className="truncate text-[27px] font-semibold"><span className="mr-2 text-white/55">{k + 1}</span>{t.label}</li>)}</ol></div>;
      return <div className="absolute inset-0 flex flex-col gap-7 px-[56px] pb-[48px] pt-[76px]">
        <Title>That was your {w.year}</Title>
        <div className="rc-pop" style={rise(2)}><div className="text-[96px] font-black leading-none tabular-nums">{w.minutes.toLocaleString()}</div><div className="text-[22px] uppercase tracking-wider text-white/75">minutes</div></div>
        <div className="flex flex-1 flex-col justify-around">{col('Top songs', w.topTracks, 2)}{col('Top artists', w.topArtists, 3)}{col('Top albums', w.topAlbums, 4)}</div>
        <div className="flex items-end justify-between text-[17px] text-white/70"><span className="truncate">{w.topGenres.slice(0, 3).map((g) => g.name).join(' · ')}</span><span className="font-semibold uppercase tracking-[0.25em] text-white/50">TurboMusic</span></div></div>;
    }
    default: return null;
  }
}

function Story({ w, edition }: { w: Wrapped; edition: Edition }) {
  const lib = useLibraryLive();
  const [i, setI] = useState(0);
  const [auto, setAuto] = useState(true);
  const [held, setHeld] = useState(false);
  const [quizDone, setQuizDone] = useState(false);
  const [t, setT] = useState(0);
  const [dir, setDir] = useState<'fwd' | 'back'>('fwd');

  // the screens this year's Wrapped had, minus those with nothing to show for this person
  const slides = useMemo(() => {
    const ctx: Ctx = { w, lib, edition, onAnswered: setQuizDone };
    const out: { id: SlideId; hold?: boolean; node: ReactNode }[] = [];
    for (const id of edition.slides) { const node = buildSlide(id, ctx); if (node) out.push({ id, hold: id === 'quiz', node }); }
    return out;
  }, [w, lib, edition]);

  const last = slides.length - 1, idx = Math.min(i, last), cur = slides[idx];
  const paused = !auto || held || (cur.hold && !quizDone);
  const ref = useRef({ i, last, paused });
  ref.current = { i, last, paused };
  const go = (n: number) => { setDir(n < ref.current.i ? 'back' : 'fwd'); setI(Math.max(0, Math.min(last, n))); setT(0); setQuizDone(false); };
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

  const bg = edition.palette[idx % edition.palette.length];
  const art = { seed: `${w.year}-${cur.id}`, motif: edition.motifs?.[cur.id] ?? MOTIF[cur.id] ?? 'blobs' };
  const overlay = (
    <div onPointerDown={() => setHeld(true)} onPointerUp={() => setHeld(false)} onPointerLeave={() => setHeld(false)} onPointerCancel={() => setHeld(false)} className="absolute inset-0 z-10">
      <div className="absolute inset-x-3 top-2.5 flex gap-1" aria-hidden>
        {slides.map((s, k) => <div key={s.id} className="h-1 flex-1 overflow-hidden rounded-full bg-white/25"><div className="h-full bg-white" style={{ width: k < idx ? '100%' : k === idx ? `${Math.min(1, t) * 100}%` : '0%' }} /></div>)}
      </div>
      <button className="absolute inset-y-8 left-0 w-[7%]" aria-label="Previous" onClick={(e) => { e.stopPropagation(); go(idx - 1); }} />
      <button className="absolute inset-y-8 right-0 w-[7%]" aria-label="Next" onClick={(e) => { e.stopPropagation(); go(idx + 1); }} />
    </div>);
  return (
    <div className="space-y-3">
      <Stage overlay={overlay}>
        <StageFrame bg={bg} art={art}><div key={cur.id} className={`rc-slide-${dir} absolute inset-0`}>{cur.node}</div></StageFrame>
      </Stage>
      <div className="flex items-center justify-between gap-2">
        <button className="btn" onClick={() => go(idx - 1)} disabled={idx === 0} aria-label="Previous slide"><ChevronLeft size={16} /></button>
        <button className="btn" onClick={() => setAuto(!auto)}>{auto ? <><Pause size={15} />Pause</> : <><Play size={15} />Play</>}</button>
        <span className="text-xs tabular-nums text-muted">{idx + 1} / {slides.length}</span>
        {cur.id !== 'quiz' && <ShareButton name={`turbomusic-wrapped-${w.year}-${cur.id}`} label={cur.id === 'summary' ? 'Save summary picture' : 'Save this slide'} fallback={wrappedCard(w)}
          render={() => <StageFrame bg={bg} art={art}><div className="absolute inset-0">{cur.node}</div></StageFrame>} />}
        <button className="btn" onClick={() => go(idx + 1)} disabled={idx >= last} aria-label="Next slide"><ChevronRight size={16} /></button>
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
  const edition = useMemo(() => editionFor(year), [year]);
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-2xl font-bold">Wrapped</h1>
        {years.length > 1 && <select className="input w-auto" value={year} onChange={(e) => setParams({ year: e.target.value }, { replace: true })} aria-label="Year">{years.map((y) => <option key={y} value={y}>{y}</option>)}</select>}
        <Link to="/recaps" className="btn"><Gift size={15} />Weekly recap</Link>
      </div>
      {w.plays < 5
        ? <p className="card p-5 text-muted">Not enough listening in {year} yet for a Wrapped (it needs a few plays of 30 seconds or more). Import your Spotify history on the Stats page and every past year gets one too.</p>
        : <>
          <Story key={year} w={w} edition={edition} />
          <p className="text-xs text-muted">{year} · {edition.name}. {edition.blurb} Styled after Spotify’s {year} Wrapped from public descriptions of it; the screens that need data TurboMusic does not have are left out.</p>
        </>}
    </div>
  );
}
