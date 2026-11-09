import { X } from 'lucide-react';
import type { Library } from '../lib/derive.ts';
import type { HealthCheck, HealthItem } from '../lib/health.ts';
import { cn } from '../lib/cn.ts';
import { Cover } from './Cover.tsx';

/**
 * The look of a Library health list. Picture problems are shown as picture tiles (what is missing is the picture, so a grid of the
 * things without one reads faster than text), unused things as chips that can be taken away one by one, and audio quality as a meter
 * per song. Anything else keeps the plain list in Health.tsx.
 */
export function HealthTiles({ items, lib, onOpen }: { items: HealthItem[]; lib: Library; onOpen: (i: HealthItem) => void }) {
  return (
    <div className="grid max-h-96 grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-3 overflow-y-auto p-4 pt-2">
      {items.slice(0, 120).map((i) => {
        const artist = i.kind === 'artist';
        const sub = i.kind === 'album' ? lib.albumById.get(i.id)?.artistName : i.detail;
        return (
          <button key={`${i.kind}${i.id}`} className="group min-w-0 text-left" onClick={() => onOpen(i)} title={i.label}>
            <Cover hash={null} seed={i.label} kind={artist ? 'artist' : 'album'} className="transition-transform group-hover:scale-[1.03]" />
            <div className="mt-1.5 truncate text-xs font-medium">{artist ? i.label : i.label.split(' · ')[0]}</div>
            {sub && <div className="truncate text-[11px] text-muted">{sub}</div>}
          </button>);
      })}
      {items.length > 120 && <div className="col-span-full text-xs text-muted">…and {items.length - 120} more</div>}
    </div>
  );
}

export function HealthChips({ check, onRemove, onOpen }: { check: HealthCheck; onRemove: (i: HealthItem) => void; onOpen: (i: HealthItem) => void }) {
  return (
    <div className="flex max-h-72 flex-wrap gap-2 overflow-y-auto p-4 pt-2">
      {check.items.slice(0, 300).map((i) => (
        <span key={`${i.kind}${i.id}`} className="chip inline-flex items-center gap-1.5 !text-fg">
          <button className="max-w-[16rem] truncate hover:underline" onClick={() => onOpen(i)}>{i.label}</button>
          {check.fix && <button aria-label={`Remove ${i.label}`} title="Delete" className="text-muted hover:text-bad" onClick={() => onRemove(i)}><X size={12} /></button>}
        </span>))}
    </div>
  );
}

const toneOf = (kbps: number) => (kbps >= 256 ? 'bg-good' : kbps >= 160 ? 'bg-warn' : 'bg-bad');

/** one row per song: its stored bit rate as a bar against 320 kbps, and what the measurement says if it was measured */
export function HealthMeters({ items, lib, onOpen }: { items: HealthItem[]; lib: Library; onOpen: (i: HealthItem) => void }) {
  return (
    <div className="max-h-96 divide-y divide-line/60 overflow-y-auto">
      {items.slice(0, 200).map((i) => {
        const t = lib.trackById.get(i.id);
        const stored = parseInt(t?.bitrate ?? '') || 0, measured = t?.audioCheck?.looksLike ?? 0;
        const kbps = measured || stored;
        return (
          <button key={i.id} className="block w-full px-4 py-2 text-left hover:bg-raised/60" onClick={() => onOpen(i)}>
            <div className="flex items-baseline justify-between gap-3 text-sm"><span className="truncate">{i.label}</span><span className="shrink-0 text-xs tabular-nums text-muted">{stored ? `${stored} kbps` : 'unknown'}{measured && measured !== stored ? ` → sounds like ${measured}` : ''}</span></div>
            <div className="relative mt-1.5 h-1.5 overflow-hidden rounded-full bg-raised">
              <div className={cn('h-full rounded-full', toneOf(kbps))} style={{ width: `${Math.min(100, (kbps / 320) * 100)}%` }} />
              {stored > 0 && measured > 0 && measured < stored && <div className="absolute inset-y-0 w-px bg-fg/70" style={{ left: `${Math.min(100, (stored / 320) * 100)}%` }} title="what the file claims" />}
            </div>
            {i.detail && !/^\d+$/.test(i.detail) && <div className="mt-1 text-[11px] text-muted">{i.detail}</div>}
          </button>);
      })}
    </div>
  );
}
