import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { GripVertical } from 'lucide-react';
import { cn } from '../lib/cn.ts';
import { haptic } from '../lib/haptics.ts';

/** `from` moved to `to` (the others close up). */
export const reorder = <T,>(list: T[], from: number, to: number): T[] => { if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list; const next = [...list]; const [x] = next.splice(from, 1); next.splice(to, 0, x); return next; };

/** What `render` gets: the grip to put in the row (`handle`), and whether this row is the one being dragged. */
export interface SortableRow { handle: ReactNode; dragging: boolean; index: number }

/**
 * A list whose rows are dragged by a grip (mouse, pen or finger) and also moved with the arrow keys while the grip has focus.
 * The rows slide aside while dragging; the new order is reported once, on release. Rows should be about the same height.
 */
export function Sortable<T>({ items, keyOf, onReorder, render, className, rowClass }: { items: T[]; keyOf: (t: T) => string; onReorder: (next: T[]) => void; render: (item: T, row: SortableRow) => ReactNode; className?: string; rowClass?: string }) {
  const rows = useRef<(HTMLElement | null)[]>([]);
  const start = useRef<{ y: number; rects: { top: number; h: number }[] } | null>(null);
  const [drag, setDrag] = useState<{ from: number; to: number; dy: number } | null>(null);

  const down = (from: number) => (e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault(); e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { y: e.clientY, rects: rows.current.map((el) => { const r = el?.getBoundingClientRect(); return { top: r?.top ?? 0, h: r?.height ?? 0 }; }) };
    setDrag({ from, to: from, dy: 0 }); haptic('tick');
  };
  const move = (e: PointerEvent<HTMLElement>) => {
    const s = start.current; if (!s || !drag) return;
    const dy = e.clientY - s.y, mid = s.rects[drag.from].top + s.rects[drag.from].h / 2 + dy;
    let to = drag.from;
    s.rects.forEach((r, i) => { if (i < drag.from && mid < r.top + r.h / 2 && i < to) to = i; if (i > drag.from && mid > r.top + r.h / 2 && i > to) to = i; });
    if (to !== drag.to) haptic('tick');
    setDrag({ from: drag.from, to, dy });
  };
  const up = () => { const d = drag; start.current = null; setDrag(null); if (d && d.to !== d.from) onReorder(reorder(items, d.from, d.to)); };
  const key = (i: number) => (e: KeyboardEvent<HTMLElement>) => {
    const by = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
    if (!by || i + by < 0 || i + by >= items.length) return;
    e.preventDefault(); onReorder(reorder(items, i, i + by));
    requestAnimationFrame(() => rows.current[i + by]?.querySelector<HTMLElement>('[data-grip]')?.focus());
  };

  return (
    <ul className={className}>
      {items.map((item, i) => {
        let shift = 0;
        if (drag) { const h = start.current?.rects[drag.from]?.h ?? 0; if (i > drag.from && i <= drag.to) shift = -h; else if (i < drag.from && i >= drag.to) shift = h; }
        const dragging = drag?.from === i;
        const style: CSSProperties = dragging ? { transform: `translateY(${drag!.dy}px)`, zIndex: 30, position: 'relative' } : { transform: shift ? `translateY(${shift}px)` : undefined, transition: drag ? 'transform 150ms ease' : undefined };
        const handle = (
          <button type="button" data-grip aria-label="Drag to reorder (or press the up and down arrow keys)" title="Drag to reorder"
            className="grid h-7 w-6 shrink-0 cursor-grab touch-none place-items-center rounded text-muted hover:text-fg focus-visible:outline focus-visible:outline-2 active:cursor-grabbing"
            onPointerDown={down(i)} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={key(i)}><GripVertical size={16} /></button>);
        return <li key={keyOf(item)} ref={(el) => { rows.current[i] = el; }} style={style} className={cn(rowClass, dragging && 'rounded-theme bg-surface shadow-xl ring-1 ring-accent/60')}>{render(item, { handle, dragging, index: i })}</li>;
      })}
    </ul>
  );
}
