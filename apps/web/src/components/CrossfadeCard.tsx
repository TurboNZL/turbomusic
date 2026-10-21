import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { MAX_CROSSFADE_SEC, MAX_CROSSFADE_SHIFT_SEC } from '@turbomusic/core';
import { useStore } from '../lib/store.ts';
import { isAndroidApp } from '../lib/native.ts';
import { ALIGN_WINDOWS, fadeLabel, fadeStops, nearestStop, nudgeShift, shiftFromDrag, windowFor } from '../lib/crossfadeMath.ts';

const STOPS = fadeStops(MAX_CROSSFADE_SEC);
export const fadeText = fadeLabel;

/** A slider over the crossfade lengths: 0.05 s apart up to half a second, a tenth up to 2 s, a quarter up to 5 s, then half seconds. */
export function FadeSlider({ value, onChange, label, disabled, className }: { value: number; onChange: (sec: number) => void; label: string; disabled?: boolean; className?: string }) {
  const i = nearestStop(STOPS, value);
  return (
    <input type="range" min={0} max={STOPS.length - 1} step={1} value={i} disabled={disabled} aria-label={label} aria-valuetext={fadeLabel(STOPS[i])}
      className={`bt-range bt-hit ${className ?? 'w-full'}`} style={{ '--p': `${(i / (STOPS.length - 1)) * 100}%` } as CSSProperties}
      onChange={(e) => onChange(STOPS[Number(e.target.value)] ?? 0)} />
  );
}

const ZOOM_NAMES = ['Fine', 'Medium', 'Wide'] as const;
const trim = (n: number) => String(Math.round(n * 100) / 100);

/**
 * The end of one song and the start of the next, centred on the moment the first song ends, with the crossfade as a box you drag. Left makes
 * the next song come in earlier (the last seconds of the first are not played), which is what a song that ends in silence, or one that starts
 * with silence, needs. Three zoom levels (the fine one spans 3 s, so a hundredth of a second is a few pixels), nudge buttons, and arrow keys
 * (a hundredth of a second in Fine, a tenth otherwise; Shift is ten times that).
 */
export function CrossfadeAligner({ fadeSec, shiftSec, onShift }: { fadeSec: number; shiftSec: number; onShift: (sec: number) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; shift: number } | null>(null);
  const [zoom, setZoom] = useState(() => ALIGN_WINDOWS.indexOf(windowFor(fadeSec, shiftSec)));
  const win = ALIGN_WINDOWS[zoom];
  const half = win / 2;
  const pct = (sec: number) => `${(sec / win) * 100}%`;
  const from = half - (shiftSec + fadeSec); // seconds from the left edge to where the next song starts (may be negative: it begins off the left edge)
  const clipped = Math.max(0, from);
  const widthSec = Math.min(fadeSec, win - clipped, fadeSec + Math.min(0, from));
  const fits = shiftSec + fadeSec <= half;
  const start = (e: PointerEvent<HTMLDivElement>) => { drag.current = { x: e.clientX, shift: shiftSec }; e.currentTarget.setPointerCapture(e.pointerId); };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current, w = box.current?.getBoundingClientRect().width;
    if (d && w) onShift(shiftFromDrag(d.shift, e.clientX - d.x, w, MAX_CROSSFADE_SHIFT_SEC, win));
  };
  const end = () => { drag.current = null; if (!fits && zoom < ALIGN_WINDOWS.length - 1) setZoom(ALIGN_WINDOWS.indexOf(windowFor(fadeSec, shiftSec))); };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const dir = e.key === 'ArrowLeft' ? 1 : e.key === 'ArrowRight' ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    onShift(nudgeShift(shiftSec, dir * (zoom === 0 ? 0.01 : 0.1) * (e.shiftKey ? 10 : 1), MAX_CROSSFADE_SHIFT_SEC));
  };
  const tickStep = zoom === 0 ? 0.25 : zoom === 1 ? 1 : 2;
  const ticks: number[] = [];
  for (let t = -Math.floor(half / tickStep) * tickStep; t <= half + 1e-9; t += tickStep) ticks.push(Math.round(t * 100) / 100);
  const nudge = (d: number) => onShift(nudgeShift(shiftSec, d, MAX_CROSSFADE_SHIFT_SEC));
  return (
    <div className="mx-auto w-full max-w-2xl space-y-2">
      <div className="flex items-center justify-center gap-1 text-xs" role="group" aria-label="Zoom">
        <span className="mr-1 text-muted">Zoom</span>
        {ZOOM_NAMES.map((n, i) => <button key={n} type="button" aria-pressed={zoom === i} onClick={() => setZoom(i)} className={`btn !px-2.5 !py-0.5 text-xs ${zoom === i ? '' : 'btn-ghost'}`}>{n}<span className="ml-1 text-muted">{ALIGN_WINDOWS[i]} s</span></button>)}
      </div>
      <div ref={box} className="relative h-28 select-none overflow-hidden rounded-theme border border-line bg-raised/40">
        <div className="absolute left-0 top-2 flex h-6 items-center rounded-sm bg-accent/25 pl-1.5 text-[10px] text-muted" style={{ width: pct(half) }}>first song</div>
        <div className="absolute inset-y-0 w-px bg-fg/60" style={{ left: '50%' }} aria-hidden />
        <div className="absolute top-2 -translate-x-1/2 whitespace-nowrap rounded-sm bg-bg/70 px-1 text-[10px] text-fg" style={{ left: '50%', marginLeft: '3.2rem' }}>▸ it ends here</div>
        <div className="absolute bottom-7 flex h-6 items-center rounded-sm bg-good/25 pl-1.5 text-[10px] text-muted" style={{ left: pct(clipped), right: 0 }}>next song</div>
        <div className="absolute inset-x-0 bottom-0 h-5">
          {ticks.map((t) => <span key={t} className="absolute bottom-0 -translate-x-1/2 text-[9px] tabular-nums text-muted" style={{ left: pct(t + half) }}>{t === 0 ? '0' : `${t > 0 ? '+' : '−'}${trim(Math.abs(t))}`}</span>)}
        </div>
        <div role="slider" tabIndex={0} aria-label="Move the crossfade earlier or later" aria-valuemin={0} aria-valuemax={MAX_CROSSFADE_SHIFT_SEC} aria-valuenow={shiftSec}
          aria-valuetext={shiftSec > 0 ? `${shiftSec} seconds earlier than the end` : 'at the end of the song'}
          title="Drag left to bring the next song in earlier"
          onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onKeyDown={key}
          className="absolute top-9 flex h-12 cursor-ew-resize touch-none items-center justify-center rounded-sm border border-accent bg-accent/40 outline-none focus-visible:ring-2 focus-visible:ring-accent"
          style={{ left: pct(clipped), width: `max(${pct(Math.max(0, widthSec))}, 1.5rem)` }}>
          <span className="pointer-events-none text-[10px] font-medium text-fg">⇆</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-1.5 text-xs">
        <button type="button" className="btn btn-ghost !px-2 !py-0.5 text-xs" onClick={() => nudge(0.1)} title="Earlier by a tenth of a second">◂ 0.1</button>
        <button type="button" className="btn btn-ghost !px-2 !py-0.5 text-xs" onClick={() => nudge(0.01)} title="Earlier by a hundredth of a second">◂ 0.01</button>
        <span className="min-w-[5.5rem] text-center tabular-nums text-muted">{trim(shiftSec)} s early</span>
        <button type="button" className="btn btn-ghost !px-2 !py-0.5 text-xs" onClick={() => nudge(-0.01)} title="Later by a hundredth of a second">0.01 ▸</button>
        <button type="button" className="btn btn-ghost !px-2 !py-0.5 text-xs" onClick={() => nudge(-0.1)} title="Later by a tenth of a second">0.1 ▸</button>
        <button type="button" className="btn btn-ghost !px-2 !py-0.5 text-xs" disabled={shiftSec === 0} onClick={() => onShift(0)}>Reset</button>
      </div>
      <p className="text-center text-xs text-muted">{shiftSec > 0 ? `The next song comes in ${trim(shiftSec + fadeSec)} s before the end; the last ${trim(shiftSec)} s of this one are skipped.` : 'The fade finishes exactly where the first song ends. Drag the box left to bring the next song in earlier, e.g. to close a gap.'}</p>
    </div>
  );
}

/**
 * A playback rule's own crossfade for its pair of tracks, on the same slider as the device setting. Untouched it follows the device
 * setting; "Use device setting" goes back to that. The far left is a cut (no fade), which also beats a device crossfade.
 */
export function CrossfadePick({ value, onChange, shift, onShift, className }: { value: number | null | undefined; onChange: (v: number | null) => void; shift?: number | null; onShift?: (v: number) => void; className?: string }) {
  const device = useStore((s) => s.settings.crossfade);
  const own = typeof value === 'number';
  const shown = own ? value : device;
  return (
    <div className={`space-y-2 ${className ?? ''}`}>
      <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <FadeSlider className="min-w-[8rem] flex-1" label="Crossfade for this pair" value={shown} onChange={onChange} />
        <span className="w-24 shrink-0 text-right text-xs tabular-nums text-muted">{own ? (value > 0 ? fadeLabel(value) : 'cut') : `device: ${fadeLabel(device)}`}</span>
        <button type="button" className="btn btn-ghost !px-2 !py-0.5 text-xs" disabled={!own} onClick={() => onChange(null)} title="Follow the crossfade set for this device">Use device setting</button>
      </span>
      {onShift && shown > 0 && <CrossfadeAligner fadeSec={shown} shiftSec={shift ?? 0} onShift={onShift} />}
    </div>
  );
}

/** Settings > Playback: how long one track fades into the next on this device. */
export function CrossfadeCard() {
  const sec = useStore((s) => s.settings.crossfade);
  const update = useStore((s) => s.updateSettings);
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">The end of a song fades out while the next one fades in. It happens when a song runs out by itself; pressing Next or choosing a song still changes at once. A playback rule can give one pair of songs its own length (or none), and that wins over this slider. It works where the page plays the sound (browsers and the desktop app); the Android app's own player and Spotify devices do not crossfade.{isAndroidApp() ? ' This is the Android app, so it has no effect here.' : ''}</p>
      <label className="block text-sm"><span className="mb-1 flex justify-between"><span className="font-medium">Crossfade</span><span className="tabular-nums text-muted">{fadeLabel(sec)}</span></span>
        <FadeSlider label="Crossfade in seconds" value={sec} onChange={(v) => update({ crossfade: v })} /></label>
    </div>
  );
}
