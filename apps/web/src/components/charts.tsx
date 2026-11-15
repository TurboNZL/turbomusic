import { useMemo, useState } from 'react';
import { Cover } from './Cover.tsx';
import { Link } from 'react-router-dom';
import { cn } from '../lib/cn.ts';

/**
 * Small SVG/CSS charts that follow the theme (accent / muted / line variables). No chart library: every chart is a few lines and
 * stays crisp at any size. Values are always shown as text too (title tooltips and visible labels), never by colour alone.
 */
export const fmtHours = (ms: number) => { const m = Math.round(ms / 60000); return m >= 600 ? `${Math.round(m / 60).toLocaleString()} h` : m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`; };

/** Vertical bars with a label under each. `value` can be any unit; `format` makes the tooltip. */
export function Bars({ data, format = String, height = 120, highlight }: { data: { label: string; full?: string; value: number }[]; format?: (n: number) => string; height?: number; highlight?: number }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="flex items-end gap-[3px]" style={{ height }} role="img" aria-label="Bar chart">
      {data.map((d, i) => (
        <div key={i} className="group flex h-full min-w-0 flex-1 flex-col justify-end" title={`${d.full ?? d.label}: ${format(d.value)}`}>
          <div className={cn('w-full rounded-t-[3px] transition-[height] duration-500', i === highlight ? 'bg-accent' : 'bg-accent/55 group-hover:bg-accent')} style={{ height: `${Math.max(d.value ? 3 : 0, (d.value / max) * (height - 18))}px` }} />
          <div className="relative mt-1 h-3 text-[9px] leading-3 text-muted"><span className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap">{d.label}</span></div>
        </div>))}
    </div>
  );
}

/** A filled line over time (monthly listening). */
export function Area({ data, format = String, height = 150 }: { data: { label: string; full?: string; value: number }[]; format?: (n: number) => string; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 600, H = height, pad = 6;
  const max = Math.max(1, ...data.map((d) => d.value));
  const pts = useMemo(() => data.map((d, i) => [pad + (data.length > 1 ? (i / (data.length - 1)) * (W - 2 * pad) : (W - 2 * pad) / 2), H - 18 - (d.value / max) * (H - 30)] as const), [data, max, H]);
  if (!data.length) return <div className="grid place-items-center text-sm text-muted" style={{ height }}>No data</div>;
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)},${H - 18} L${pts[0][0].toFixed(1)},${H - 18} Z`;
  const step = Math.max(1, Math.ceil(data.length / 7));
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Line chart" onMouseLeave={() => setHover(null)}>
        <defs><linearGradient id="area-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="hsl(var(--accent))" stopOpacity="0.45" /><stop offset="1" stopColor="hsl(var(--accent))" stopOpacity="0.02" /></linearGradient></defs>
        <line x1={pad} x2={W - pad} y1={H - 18} y2={H - 18} stroke="hsl(var(--line))" />
        <path d={area} fill="url(#area-fill)" />
        <path d={line} fill="none" stroke="hsl(var(--accent))" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {pts.map(([x, y], i) => <g key={i}>
          <rect x={x - (W / data.length) / 2} y={0} width={W / data.length} height={H} fill="transparent" onMouseEnter={() => setHover(i)} />
          {(hover === i || data.length < 40) && <circle cx={x} cy={y} r={hover === i ? 4 : 2} fill="hsl(var(--accent))" />}
          {i % step === 0 && <text x={i === 0 ? Math.max(x, 22) : i > data.length - 1 - step / 2 ? Math.min(x, W - 22) : x} y={H - 5} textAnchor="middle" fontSize="9" fill="hsl(var(--muted))">{data[i].label}</text>}
        </g>)}
      </svg>
      {hover !== null && <div className="pointer-events-none absolute right-1 top-0 rounded-theme bg-raised px-2 py-1 text-xs shadow">{data[hover].full ?? data[hover].label} · <b>{format(data[hover].value)}</b></div>}
    </div>
  );
}

/** Weekday x hour grid ("listening clock"). `cells[row][col]`; rows and cols are labelled. */
export function Heatgrid({ cells, rows, cols, colEvery = 3 }: { cells: number[][]; rows: string[]; cols: string[]; colEvery?: number }) {
  const max = Math.max(1, ...cells.flat());
  return (
    <div className="space-y-1" role="img" aria-label="Activity grid">
      {cells.map((r, y) => (
        <div key={y} className="flex items-center gap-1">
          <span className="w-8 shrink-0 text-[10px] text-muted">{rows[y]}</span>
          <div className="grid flex-1 gap-[2px]" style={{ gridTemplateColumns: `repeat(${r.length}, minmax(0, 1fr))` }}>
            {r.map((v, x) => <div key={x} className="aspect-square rounded-[3px] bg-accent" style={{ opacity: v ? 0.12 + 0.88 * (v / max) : 0.06 }} title={`${rows[y]} ${cols[x]}: ${v}`} />)}
          </div>
        </div>))}
      <div className="flex gap-1"><span className="w-8 shrink-0" /><div className="grid flex-1" style={{ gridTemplateColumns: `repeat(${cells[0]?.length ?? 1}, minmax(0, 1fr))` }}>{cols.map((c, i) => <span key={i} className="relative h-3 text-[9px] leading-3 text-muted"><span className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap">{i % colEvery === 0 ? c : ''}</span></span>)}</div></div>
    </div>
  );
}

/** A year-long calendar of days, one column per week (like a contribution graph). `byDay` is local 'YYYY-MM-DD' -> value. */
export function Calendar({ byDay, end = new Date(), weeks = 53, format = String }: { byDay: Map<string, number>; end?: Date; weeks?: number; format?: (n: number) => string }) {
  const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const { cols, max, months } = useMemo(() => {
    const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    const lastMon = new Date(last); lastMon.setDate(last.getDate() - ((last.getDay() + 6) % 7));
    const start = new Date(lastMon); start.setDate(lastMon.getDate() - (weeks - 1) * 7);
    const cols: { date: Date; v: number }[][] = [];
    let max = 1;
    const months: { i: number; label: string }[] = [];
    for (let w = 0; w < weeks; w++) {
      const col: { date: Date; v: number }[] = [];
      for (let d = 0; d < 7; d++) {
        const date = new Date(start); date.setDate(start.getDate() + w * 7 + d);
        const v = date > last ? -1 : byDay.get(key(date)) ?? 0;
        max = Math.max(max, v); col.push({ date, v });
      }
      if (w === 0 || col[0].date.getDate() <= 7) months.push({ i: w, label: col[0].date.toLocaleString(undefined, { month: 'short' }) });
      cols.push(col);
    }
    return { cols, max, months };
  }, [byDay, end, weeks]);
  return (
    <div className="overflow-x-auto pb-1" role="img" aria-label="Listening calendar">
      <div className="min-w-[640px]">
        <div className="relative mb-1 h-3 text-[9px] text-muted">{months.map((m) => <span key={m.i} className="absolute" style={{ left: `${(m.i / weeks) * 100}%` }}>{m.label}</span>)}</div>
        <div className="grid gap-[2px]" style={{ gridTemplateColumns: `repeat(${weeks}, minmax(0, 1fr))` }}>
          {cols.map((col, w) => <div key={w} className="grid gap-[2px]">{col.map((c, d) => c.v < 0 ? <div key={d} className="aspect-square" />
            : <div key={d} className="aspect-square rounded-[2px] bg-accent" style={{ opacity: c.v ? 0.18 + 0.82 * (c.v / max) : 0.06 }} title={`${c.date.toLocaleDateString()}: ${c.v ? format(c.v) : 'nothing'}`} />)}</div>)}
        </div>
      </div>
    </div>
  );
}

/** A ring split into slices, with the legend beside it. */
export function Donut({ slices, size = 120 }: { slices: { label: string; value: number }[]; size?: number }) {
  const total = slices.reduce((n, s) => n + s.value, 0) || 1;
  const R = 40, C = 2 * Math.PI * R;
  let acc = 0;
  const tones = [1, 0.7, 0.5, 0.35, 0.22];
  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 100 100" width={size} height={size} className="-rotate-90 shrink-0" role="img" aria-label="Share chart">
        <circle cx="50" cy="50" r={R} fill="none" stroke="hsl(var(--raised))" strokeWidth="14" />
        {slices.map((s, i) => { const len = (s.value / total) * C; const el = <circle key={i} cx="50" cy="50" r={R} fill="none" stroke="hsl(var(--accent))" strokeOpacity={tones[Math.min(i, tones.length - 1)]} strokeWidth="14" strokeDasharray={`${Math.max(0, len - 1)} ${C}`} strokeDashoffset={-acc}><title>{`${s.label}: ${s.value}`}</title></circle>; acc += len; return el; })}
      </svg>
      <ul className="min-w-0 space-y-1 text-xs">{slices.map((s, i) => <li key={i} className="flex items-center gap-2"><span className="h-2.5 w-2.5 shrink-0 rounded-sm bg-accent" style={{ opacity: tones[Math.min(i, tones.length - 1)] }} /><span className="truncate">{s.label}</span><span className="ml-auto tabular-nums text-muted">{Math.round((s.value / total) * 100)}%</span></li>)}</ul>
    </div>
  );
}

/** Ranked rows with a proportional bar behind each. */
export function RankList({ rows, unit, onPick }: { rows: { key: string; label: string; sub?: string; value: number; extra?: string; to?: string; /** a small picture before the name */ img?: { hash: string | null | undefined; seed: string; kind?: 'album' | 'artist' } }[]; unit?: (n: number) => string; onPick?: (key: string) => void }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ol className="space-y-1">
      {rows.map((r, i) => (
        <li key={r.key} className="relative overflow-hidden rounded-theme">
          <div className="absolute inset-y-0 left-0 bg-accent/12" style={{ width: `${(r.value / max) * 100}%` }} aria-hidden />
          <div className="relative flex items-center gap-3 px-2.5 py-1.5 text-sm">
            <span className="w-5 shrink-0 text-right text-xs tabular-nums text-muted">{i + 1}</span>
            {r.img && <Cover hash={r.img.hash} seed={r.img.seed} kind={r.img.kind} className="h-9 w-9 shrink-0" />}
            {r.to
              ? <Link to={r.to} className="min-w-0 flex-1 no-underline after:absolute after:inset-0 hover:[&_.rl]:underline"><span className="rl block truncate font-medium">{r.label}</span>{r.sub && <span className="block truncate text-xs text-muted">{r.sub}</span>}</Link>
              : <span className="min-w-0 flex-1"><span className="block truncate font-medium">{r.label}</span>{r.sub && <span className="block truncate text-xs text-muted">{r.sub}</span>}</span>}
            {r.extra && <span className="hidden shrink-0 text-xs text-muted sm:block">{r.extra}</span>}
            <span className="shrink-0 text-xs font-semibold tabular-nums">{unit ? unit(r.value) : r.value}</span>
          </div>
        </li>))}
    </ol>
  );
}

export function Kpi({ label, value, sub, icon }: { label: string; value: string; sub?: string; icon?: React.ReactNode }) {
  return <div className="card p-4"><div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted">{icon}{label}</div><div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>{sub && <div className="text-xs text-muted">{sub}</div>}</div>;
}

/** A titled card for a chart or list. */
export function Panel({ title, children, right, className }: { title: string; children: React.ReactNode; right?: React.ReactNode; className?: string }) {
  return <section className={cn('card min-w-0 space-y-3 p-5', className)}><div className="flex items-center justify-between gap-2"><h2 className="font-semibold">{title}</h2>{right}</div>{children}</section>;
}
