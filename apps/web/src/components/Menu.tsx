import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Minus, Plus } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';

export type MenuItem =
  | { separator: true }
  /**
   * `checked` draws a tick (a switch); `keepOpen` runs the item without closing the menu, and the tick flips at once.
   * `label` may be a function: it is read on every draw, so a switch can change the words of its neighbours.
   * `children` makes a group: pressing it opens its items in the same menu (with a Back row), which works the same by touch and mouse.
   */
  | { label: string | (() => string); icon?: ReactNode; run?: () => void; to?: string; disabled?: boolean; danger?: boolean; checked?: boolean; keepOpen?: boolean; children?: MenuItem[] }
  /** a row with a number between a minus and a plus (memories): the buttons act without closing the menu */
  | { counter: { label: string; icon?: ReactNode; value: number; onMinus: () => void; onPlus: () => void; minusDisabled?: boolean } };

/** A submenu entry; hidden when it would be empty, and just the item itself when it would hold only one. */
export function group(label: string, icon: ReactNode, items: MenuItem[], primary?: number): MenuItem[] {
  const real = items.filter((i) => !('separator' in i) && !('counter' in i));
  if (!real.length) return [];
  if (real.length === 1) return real;
  // pressing the row does the group's main action (the first item, or `primary`); the arrow beside it opens all of them
  const main = real[primary ?? 0] as Extract<MenuItem, { label: string | (() => string) }>;
  return [{ label, icon, children: items, run: main.run, to: main.to, disabled: main.disabled }];
}

const labelOf = (it: { label: string | (() => string) }) => (typeof it.label === 'function' ? it.label() : it.label);

export interface MenuAt { x: number; y: number; items: MenuItem[]; label: string; key?: string }

/**
 * A pop-up menu at a screen position, in a portal so a list that clips its content cannot cut it off. Closes on
 * Escape, scrolling, resizing and a press outside. Presses on an element marked `data-menu-trigger` are ignored
 * here because that element toggles the menu itself (otherwise its own press closes the menu and its click reopens it).
 */
export function ContextMenu({ at, onClose }: { at: MenuAt; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const nav = useNavigate();
  const [pos, setPos] = useState({ left: at.x, top: at.y });
  // a counter row keeps its own running total, since the menu's items were built when it opened
  const [deltas, setDeltas] = useState<Record<string, number>>({});
  const [flipped, setFlipped] = useState<ReadonlySet<string>>(new Set());
  // the groups opened so far: each entry is the group's label and items
  const [stack, setStack] = useState<{ label: string; items: MenuItem[] }[]>([]);
  const items = stack.length ? stack[stack.length - 1].items : at.items;
  const level = stack.length;

  // keep the menu on screen
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // offset sizes, not getBoundingClientRect: the opening animation scales the menu, which would measure it too small
    const w = el.offsetWidth, h = el.offsetHeight;
    setPos({ left: Math.max(8, Math.min(at.x, window.innerWidth - w - 8)), top: Math.max(8, Math.min(at.y, window.innerHeight - h - 8)) });
  }, [at.x, at.y, level]);
  useEffect(() => {
    const down = (e: MouseEvent) => {
      const el = e.target as Element;
      if (ref.current?.contains(el) || el.closest?.('[data-menu-trigger]')) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    // scrolling the MENU (a long one on a phone) must not close it; only the page moving underneath does
    const scroll = (e: Event) => { if (e.target instanceof Node && ref.current?.contains(e.target)) return; onClose(); };
    // a phone's address bar growing or shrinking fires a resize that only changes the height: not a reason to close
    let w = window.innerWidth;
    const resize = () => { if (window.innerWidth !== w) onClose(); w = window.innerWidth; };
    window.addEventListener('mousedown', down); window.addEventListener('keydown', key); window.addEventListener('scroll', scroll, true); window.addEventListener('resize', resize);
    return () => { window.removeEventListener('mousedown', down); window.removeEventListener('keydown', key); window.removeEventListener('scroll', scroll, true); window.removeEventListener('resize', resize); };
  }, [onClose]);

  const back = () => { setStack((st) => st.slice(0, -1)); if (ref.current) ref.current.scrollTop = 0; };
  return createPortal(
    <div ref={ref} role="menu" aria-label={at.label} className="bt-menu fixed z-[60] max-h-[calc(100dvh-1rem)] w-60 overflow-y-auto overscroll-contain py-1 [-webkit-overflow-scrolling:touch]"
      style={{ ...pos, touchAction: 'pan-y', transformOrigin: `${Math.max(0, at.x - pos.left)}px ${Math.max(0, at.y - pos.top)}px` }}
      onContextMenu={(e) => e.preventDefault()}>
      {level > 0 && <>
        <button role="menuitem" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium" onClick={back}><ChevronLeft size={15} /><span className="min-w-0 flex-1 truncate">{stack[level - 1].label}</span></button>
        <div role="separator" className="my-1 border-t border-line/60" />
      </>}
      {items.map((it, i) => {
        if ('separator' in it) return <div key={i} role="separator" className="my-1 border-t border-line/60" />;
        if ('counter' in it) {
          const c = it.counter; const ck = `${level}:${i}`; const d = deltas[ck] ?? 0; const value = Math.max(0, c.value + d);
          return <div key={`${level}:${i}`} role="group" aria-label={c.label} className="flex items-center gap-3 px-3 py-1.5 text-sm">
            {c.icon}<span className="min-w-0 flex-1">{c.label}</span>
            <button type="button" className="btn !p-1" aria-label={`Remove one: ${c.label}`} disabled={c.minusDisabled ? value < 1 && d <= 0 : value < 1} onClick={() => { c.onMinus(); setDeltas((x) => ({ ...x, [ck]: (x[ck] ?? 0) - 1 })); }}><Minus size={13} /></button>
            <span className="w-5 text-center font-semibold tabular-nums">{value}</span>
            <button type="button" className="btn !p-1" aria-label={`Add one: ${c.label}`} onClick={() => { c.onPlus(); setDeltas((x) => ({ ...x, [ck]: (x[ck] ?? 0) + 1 })); }}><Plus size={13} /></button>
          </div>;
        }
        const k = `${level}:${i}`;
        const kids = it.children;
        const on = it.checked === undefined ? undefined : it.checked !== flipped.has(k);
        const open = () => { setStack((st) => [...st, { label: labelOf(it), items: kids! }]); if (ref.current) ref.current.scrollTop = 0; };
        const act = () => {
          if (it.keepOpen) { it.run?.(); if (it.checked === undefined) { setFlipped((f) => new Set(f)); return; } setFlipped((f) => { const n = new Set(f); if (n.has(k)) n.delete(k); else n.add(k); return n; }); return; }
          onClose(); if (it.to) nav(it.to); it.run?.();
        };
        const cls = `flex w-full items-center gap-3 px-3 py-2 text-left text-sm disabled:opacity-40 ${it.danger ? 'text-bad' : ''}`;
        // a group that has its own action: the row does it, the arrow opens the rest
        if (kids && (it.run || it.to)) return (
          <div key={k} className="flex items-stretch">
            <button role="menuitem" disabled={it.disabled} className={`${cls} min-w-0 flex-1`} onClick={act}>{it.icon}<span className="min-w-0 flex-1">{labelOf(it)}</span></button>
            <button type="button" role="menuitem" aria-haspopup="menu" aria-label={`More: ${labelOf(it)}`} className="flex w-9 shrink-0 items-center justify-center border-l border-line/50 text-muted hover:text-fg" onClick={open}><ChevronRight size={14} /></button>
          </div>);
        return <button key={k} role="menuitem" disabled={it.disabled} className={cls} aria-checked={on} aria-haspopup={kids ? 'menu' : undefined}
          onClick={kids ? open : act}>{it.icon}<span className="min-w-0 flex-1">{labelOf(it)}</span>
          {kids ? <ChevronRight size={14} className="shrink-0 text-muted" /> : on !== undefined && <span className="w-4 shrink-0 text-accent" aria-hidden>{on ? '✓' : ''}</span>}</button>;
      })}
    </div>, document.body);
}

/**
 * State for one menu. `onContextMenu(items, label)` is for right-click; `toggle(el, key, items, label)` is for a ⋯ button:
 * pressing it again closes the menu instead of reopening it.
 */
export function useMenu() {
  const [at, setAt] = useState<MenuAt | null>(null);
  const close = useCallback(() => setAt(null), []);
  return {
    at, close,
    onContextMenu: (items: MenuItem[], label: string, key?: string) => (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); setAt({ x: e.clientX, y: e.clientY, items, label, key }); },
    toggle: (el: HTMLElement, key: string, items: MenuItem[], label: string) => {
      const r = el.getBoundingClientRect();
      setAt((cur) => (cur?.key === key ? null : { x: r.right - 224, y: r.bottom + 4, items, label, key }));
    },
    element: at ? <ContextMenu at={at} onClose={close} /> : null,
  };
}
