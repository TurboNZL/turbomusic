import type { ComponentType, ReactNode } from 'react';
import { ChevronDown, Crown, Disc3, Heart, LayoutGrid, Medal, Swords, Target, ThumbsDown } from 'lucide-react';
import { cn } from '../lib/cn.ts';

export type Mode = 'duel' | 'place' | 'albums' | 'triple' | 'quad' | 'odd' | 'benchmark' | 'love';

export interface ModeDef { id: Mode; label: string; hint: string; blurb: string; tag?: string; Icon: ComponentType<{ size?: number; className?: string }>; hue: number }

/** Every way to rank, in the order the screen shows them. `hint` is the one line beside the page title, `blurb` is what the tile says. */
export const MODES: ModeDef[] = [
  { id: 'duel', label: 'Head to head', hint: 'Two songs: which is better?', blurb: 'Two songs, one winner. The classic, and the fastest way to teach TurboMusic your taste.', tag: 'Classic', Icon: Swords, hue: 0 },
  { id: 'place', label: 'Place a song', hint: 'Find where one song belongs.', blurb: 'Take one song you love and find exactly where it belongs by climbing past a few others.', tag: 'Precise', Icon: Target, hue: 38 },
  { id: 'albums', label: 'Albums', hint: 'Two albums: which is better?', blurb: 'Albums go head to head. A high album gives its tracks a slightly higher start.', Icon: Disc3, hue: -42 },
  { id: 'triple', label: 'Best of three', hint: 'Three songs: pick your favourite.', blurb: 'Pick your favourite of three. That settles two matches at once.', Icon: Medal, hue: 76 },
  { id: 'quad', label: 'Best of four', hint: 'Four songs: pick your favourite.', blurb: 'A grid of four and one winner: three matches settled with a single tap.', Icon: LayoutGrid, hue: 118 },
  { id: 'odd', label: 'Odd one out', hint: 'Three songs: which do you like least?', blurb: 'Three songs, and you cut the weakest. The other two each beat it.', Icon: ThumbsDown, hue: -86 },
  { id: 'benchmark', label: 'Against your top 10%', hint: 'A song against your top-10% line.', blurb: 'A challenger against the song on your top-10% line. Does it clear it?', Icon: Crown, hue: 150 },
  { id: 'love', label: 'Gut check', hint: 'Love it, or meh?', blurb: 'One song with hardly any votes. No thinking: love it or meh.', tag: 'Quick', Icon: Heart, hue: 196 },
];

const sk = 'currentColor';
/** The little picture on each tile: the layout of the cards you will get, drawn with the theme's accent. */
function Art({ mode, big }: { mode: Mode; big?: boolean }) {
  const card = (x: number, y: number, w: number, h: number, o: number, rot = 0, extra?: ReactNode) => (
    <g transform={`rotate(${rot} ${x + w / 2} ${y + h / 2})`} className="rk-art-card">
      <rect x={x} y={y} width={w} height={h} rx={7} fill={sk} fillOpacity={o} />
      <rect x={x + 5} y={y + 5} width={w - 10} height={w - 10} rx={4} fill="var(--bg)" fillOpacity={0.35} />
      <rect x={x + 5} y={y + w - 1} width={(w - 10) * 0.6} height={3} rx={1.5} fill="var(--bg)" fillOpacity={0.5} />
      {extra}
    </g>
  );
  const tick = (cx: number, cy: number, r = 7) => <g><circle cx={cx} cy={cy} r={r} fill="var(--accent-fg)" /><path d={`M${cx - r * 0.45} ${cy} l${r * 0.3} ${r * 0.35} l${r * 0.6} -${r * 0.7}`} fill="none" stroke={sk} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" /></g>;
  const ph = cn('h-full w-full text-accent', big ? 'max-h-[11rem]' : 'max-h-[7.25rem]');
  switch (mode) {
    case 'duel': return <svg viewBox="0 0 160 100" className={ph} aria-hidden>{card(24, 12, 54, 70, 0.95, -7, tick(66, 24))}{card(86, 16, 54, 70, 0.4, 6)}</svg>;
    case 'triple': return <svg viewBox="0 0 160 100" className={ph} aria-hidden>{card(10, 22, 46, 60, 0.4, -10)}{card(98, 22, 46, 60, 0.4, 10)}{card(57, 10, 46, 62, 0.95, 0, tick(94, 21))}</svg>;
    case 'quad': return <svg viewBox="0 0 160 100" className={ph} aria-hidden>{[[34, 8, 0.95], [88, 8, 0.4], [34, 54, 0.4], [88, 54, 0.4]].map(([x, y, o], i) => (
      <g key={i}><rect x={x} y={y} width={38} height={38} rx={7} fill={sk} fillOpacity={o} /><rect x={x + 4} y={y + 4} width={30} height={22} rx={4} fill="var(--bg)" fillOpacity={0.35} />{i === 0 && tick(x + 30, y + 8, 6)}</g>))}</svg>;
    case 'odd': return <svg viewBox="0 0 160 100" className={ph} aria-hidden>{card(10, 14, 46, 62, 0.45, -6)}{card(57, 14, 46, 62, 0.45, 0)}<g className="text-bad">{card(104, 20, 46, 62, 0.95, 8, <g><circle cx={140} cy={32} r={7} fill="var(--bg)" /><path d="M137 29 l6 6 M143 29 l-6 6" stroke={sk} strokeWidth={2} strokeLinecap="round" /></g>)}</g></svg>;
    case 'benchmark': return <svg viewBox="0 0 160 100" className={ph} aria-hidden>{[0, 1, 2, 3, 4, 5].map((i) => <rect key={i} x={14 + i * 14} y={50 + i * 5} width={10} height={36 - i * 5} rx={3} fill={sk} fillOpacity={0.3 + (5 - i) * 0.04} />)}<line x1={8} y1={42} x2={152} y2={42} stroke={sk} strokeWidth={2} strokeDasharray="5 4" opacity={0.9} />{card(108, 8, 40, 52, 0.95, 5, tick(142, 18, 6))}</svg>;
    case 'love': return <svg viewBox="0 0 160 100" className={ph} aria-hidden>{card(52, 8, 56, 80, 0.95, 0)}<path d="M80 62 c-10 -7 -16 -12 -16 -19 a8 8 0 0 1 16 -3 a8 8 0 0 1 16 3 c0 7 -6 12 -16 19z" fill="var(--accent-fg)" /></svg>;
    case 'place': return <svg viewBox="0 0 160 100" className={ph} aria-hidden>{[0, 1, 2, 3, 4].map((i) => <rect key={i} x={20} y={12 + i * 17} width={120 - i * 18} height={11} rx={5.5} fill={sk} fillOpacity={i === 2 ? 0 : 0.35 + (4 - i) * 0.05} />)}<rect x={14} y={46} width={104} height={13} rx={6.5} fill={sk} fillOpacity={0.95} /><circle cx={124} cy={52.5} r={8} fill="var(--accent-fg)" /><path d="M121 55 l3 -5 l3 5" fill="none" stroke={sk} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" /></svg>;
    case 'albums': return <svg viewBox="0 0 160 100" className={ph} aria-hidden><circle cx={100} cy={50} r={38} fill={sk} fillOpacity={0.35} /><circle cx={100} cy={50} r={11} fill="var(--bg)" fillOpacity={0.55} /><circle cx={100} cy={50} r={3} fill={sk} /><g className="rk-art-card"><rect x={22} y={14} width={72} height={72} rx={8} fill={sk} fillOpacity={0.95} /><rect x={29} y={21} width={58} height={44} rx={5} fill="var(--bg)" fillOpacity={0.35} /><rect x={29} y={72} width={34} height={4} rx={2} fill="var(--bg)" fillOpacity={0.5} /></g></svg>;
  }
}

/**
 * The screen that opens when you want to change how you rank: one big tile per way, each with a picture of the cards you will be given.
 * Plain buttons in a grid, so it works with touch, keyboard and any theme (the tint comes from the accent).
 */
export function ModePicker({ current, onPick, onClose }: { current: Mode | null; onPick: (m: Mode) => void; onClose?: () => void }) {
  return (
    <div className="mx-auto w-full max-w-5xl pb-6">
      <div className="rc-rise mb-4 flex flex-wrap items-end gap-x-4 gap-y-1">
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-accent">Rank</div>
          <h1 className="text-2xl font-extrabold leading-tight sm:text-4xl">How do you want to rank?</h1>
          <p className="mt-1 max-w-xl text-sm text-muted">Every answer is a vote. Pick the format that fits your mood. You can switch at any time, and the Rank page remembers your choice.</p>
        </div>
        {onClose && current && <button className="btn btn-ghost ml-auto !py-1 text-sm" onClick={onClose}>Back to {MODES.find((m) => m.id === current)?.label}</button>}
      </div>
      <div className="grid grid-cols-1 gap-3 min-[520px]:grid-cols-2 lg:grid-cols-3">
        {MODES.map((m, i) => (
          <button key={m.id} type="button" onClick={() => onPick(m.id)} data-selected={m.id === current || undefined} style={{ ['--i' as string]: i }}
            className={cn('rc-rise group card bt-sel relative flex min-w-0 flex-col overflow-hidden text-left transition-transform duration-200 hover:-translate-y-1 active:scale-[0.985]', i === 0 && 'lg:col-span-2')}>
            <div className={cn('relative grid place-items-center overflow-hidden px-4', i === 0 ? 'h-[clamp(5rem,19dvh,12rem)]' : 'h-[clamp(4.5rem,14dvh,8rem)]')}>
              {/* the wash is the accent turned a different way round the colour wheel for each tile, so the screen is lively in any theme */}
              <div className="absolute inset-0 opacity-90" style={{ background: 'radial-gradient(120% 100% at 50% 0%, color-mix(in srgb, var(--accent) 34%, transparent), transparent 72%)', filter: `hue-rotate(${m.hue}deg)` }} aria-hidden />
              <div className="relative flex h-full w-full items-center justify-center py-3 transition-transform duration-300 ease-out group-hover:scale-110 group-hover:-rotate-1"><Art mode={m.id} big={i === 0} /></div>
              {m.tag && <span className="chip absolute right-2.5 top-2.5 text-[10px] font-bold uppercase tracking-wider">{m.tag}</span>}
              {m.id === current && <span className="chip absolute left-2.5 top-2.5 bg-accent text-[10px] font-bold uppercase tracking-wider text-accent-fg">Current</span>}
            </div>
            <div className="flex items-center gap-2 px-4 py-3 [@media(min-height:761px)]:pb-0"><m.Icon size={17} className="shrink-0 text-accent" /><span className="truncate text-base font-bold">{m.label}</span></div>
            <p className="px-4 pb-3 pt-1 text-sm leading-snug text-muted [@media(max-height:760px)]:hidden">{m.blurb}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

/** The slim button at the top of the Rank page: the mode you are in, and the way to the picker. */
export function ModeButton({ mode, onClick }: { mode: Mode; onClick: () => void }) {
  const m = MODES.find((x) => x.id === mode) ?? MODES[0];
  return (
    <button type="button" className="btn order-1 !gap-2 !py-1 text-sm font-semibold" onClick={onClick} title="Choose how to rank" aria-label={`Ranking: ${m.label}. Change how to rank`}>
      <m.Icon size={15} className="text-accent" />{m.label}<ChevronDown size={14} className="text-muted" />
    </button>
  );
}
