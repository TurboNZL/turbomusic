import { useRef } from 'react';
import { TIERS, type Tier, type TierChoice } from '../lib/pairing.ts';
import { haptic } from '../lib/haptics.ts';
import { cn } from '../lib/cn.ts';

/** From widest to sharpest, then the odd ones: the notches of the slider */
const ORDER: Tier[] = ['any', 'upper', 'top25', 'top10', 'lower', 'few', 'range'];
const LABEL = Object.fromEntries(TIERS.map((t) => [t.id, t])) as Record<Tier, (typeof TIERS)[number]>;

const fraction = (e: React.PointerEvent, el: HTMLElement) => { const r = el.getBoundingClientRect(); return Math.min(1, Math.max(0, (e.clientX - r.left) / (r.width || 1))); };

/**
 * "Compare" as a dial: drag the knob (or tap a notch, or use the arrow keys) from "anything" towards the sharpest class of songs.
 * The rating band of the last notch has a two-knob slider of its own that opens beneath.
 */
export function TierSlider({ choice, onChange, info, className }: { choice: TierChoice; onChange: (c: TierChoice) => void; info?: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const last = ORDER.length - 1, i = Math.max(0, ORDER.indexOf(choice.tier));
  const set = (n: number) => { const t = ORDER[Math.max(0, Math.min(last, n))]; if (t !== choice.tier) { haptic('tick'); onChange({ ...choice, tier: t }); } };
  const at = (e: React.PointerEvent) => set(Math.round(fraction(e, ref.current!) * last));
  return (
    <div className={cn('relative flex min-w-0 items-center gap-x-3 gap-y-1 max-sm:flex-wrap', className)}>
      <span className="text-xs font-semibold uppercase tracking-wider text-muted">Compare</span>
      <div className="flex shrink-0 items-center gap-2">
      <div ref={ref} role="slider" tabIndex={0} aria-label="Which songs to compare" aria-valuemin={0} aria-valuemax={last} aria-valuenow={i} aria-valuetext={LABEL[choice.tier].label} title={LABEL[choice.tier].hint}
        className="relative h-8 w-44 shrink-0 cursor-pointer touch-none select-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent sm:w-48"
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); at(e); }} onPointerMove={(e) => { if (e.buttons) at(e); }}
        onKeyDown={(e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); set(i + 1); } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); set(i - 1); } else if (e.key === 'Home') set(0); else if (e.key === 'End') set(last); }}>
        <div className="absolute inset-x-3 top-1/2 h-2 -translate-y-1/2 rounded-full bg-raised" />
        <div className="absolute inset-x-3 top-1/2 h-2 -translate-y-1/2">
          <div className="h-full rounded-full bg-accent/70 transition-[width] duration-200 ease-out" style={{ width: `${(i / last) * 100}%` }} />
          {ORDER.map((_, k) => <span key={k} className={cn('absolute top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full', k <= i ? 'bg-accent-fg/80' : 'bg-fg/30')} style={{ left: `${(k / last) * 100}%` }} />)}
          <span className="absolute top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-accent-fg bg-accent transition-[left] duration-200 ease-[cubic-bezier(.3,1.5,.5,1)]" style={{ left: `${(i / last) * 100}%` }} />
        </div>
      </div>
      {/* at the last notch the dial grows a rating track on its right, with a dot for the floor and one for the ceiling */}
      {choice.tier === 'range' && <BandSlider min={choice.min} max={choice.max} onChange={(min, max) => onChange({ ...choice, min, max })} />}
      </div>
      <span className="min-w-0 truncate whitespace-nowrap text-sm"><b className="font-semibold">{LABEL[choice.tier].label}</b>{choice.tier === 'range' ? <span className="tabular-nums text-muted"> · {choice.min.toFixed(1)} to {choice.max.toFixed(1)}</span> : info && <span className="text-muted"> · {info}</span>}</span>
    </div>
  );
}

/** Two knobs on a 0 to 10 rating scale (half-point steps): the lower and the upper end of the band to compare */
function BandSlider({ min, max, onChange }: { min: number; max: number; onChange: (min: number, max: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<'min' | 'max' | null>(null);
  const val = (e: React.PointerEvent) => Math.round(fraction(e, ref.current!) * 20) / 2;
  const move = (e: React.PointerEvent) => { const v = val(e); if (drag.current === 'min') onChange(Math.min(v, max), max); else if (drag.current === 'max') onChange(min, Math.max(v, min)); };
  return (
    <div ref={ref} className="relative h-8 w-28 shrink-0 cursor-pointer touch-none select-none sm:w-40" title="Floor and ceiling of the rating band"
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); const v = val(e); drag.current = Math.abs(v - min) <= Math.abs(v - max) && !(v >= max && min === max) ? 'min' : 'max'; move(e); }}
      onPointerMove={(e) => { if (e.buttons) move(e); }} onPointerUp={() => { drag.current = null; }}>
      <div className="absolute inset-x-3 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-raised" />
      <div className="absolute inset-x-3 top-1/2 h-1.5 -translate-y-1/2">
        <div className="absolute h-full rounded-full bg-accent/70" style={{ left: `${min * 10}%`, width: `${(max - min) * 10}%` }} />
        {([['min', min], ['max', max]] as const).map(([k, v]) => <span key={k} role="slider" aria-label={k === 'min' ? 'Lowest rating' : 'Highest rating'} aria-valuenow={v} aria-valuemin={0} aria-valuemax={10} className="absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-accent-fg bg-accent" style={{ left: `${v * 10}%` }} />)}
      </div>
    </div>
  );
}
