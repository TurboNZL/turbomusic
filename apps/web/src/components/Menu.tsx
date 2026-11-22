import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronRight, Minus, Plus } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';

export type MenuItem =
  | { separator: true }
  /**
   * `checked` draws a tick (a switch); `keepOpen` runs the item without closing the menu, and the tick flips at once.
   * `label` may be a function: it is read on every draw, so a switch can change the words of its neighbours.
   * `children` makes a group: it opens as a flyout beside the row on hover (a tap on touch screens); pressing the row itself does the group's main action.
   */
  | { label: string | (() => string); icon?: ReactNode; run?: () => void; to?: string; disabled?: boolean; danger?: boolean; checked?: boolean; keepOpen?: boolean; children?: MenuItem[]; flyout?: (close: () => void) => ReactNode }
  /** a row with a number between a minus and a plus (memories): the buttons act without closing the menu */
  | { counter: { label: string; icon?: ReactNode; value: number; onMinus: () => void; onPlus: () => void; minusDisabled?: boolean } };

/** A submenu entry; hidden when it would be empty, and just the item itself when it would hold only one. */
export function group(label: string, icon: ReactNode, items: MenuItem[], primary?: number): MenuItem[] {
  const real = items.filter((i) => !('separator' in i) && !('counter' in i));
  if (!real.length) return [];
  if (real.length === 1) return real;
  // pressing the row does the group's main action (the first item, or `primary`); the arrow beside it opens all of them
  const main = real[primary ?? 0] as Extract<MenuItem, { label: string | (() => string) }>;
  // a main action that cannot run (a song with no audio) leaves the row as a plain opener; the row is disabled only when nothing inside can be used
  const usable = !main.disabled;
  return [{ label, icon, children: items, run: usable ? main.run : undefined, to: usable ? main.to : undefined, disabled: real.every((i) => (i as Leaf).disabled) }];
}

const labelOf = (it: { label: string | (() => string) }) => (typeof it.label === 'function' ? it.label() : it.label);

export interface MenuAt { x: number; y: number; items: MenuItem[]; label: string; key?: string }

type Chain = { index: number; rect: DOMRect }[];
type Leaf = Extract<MenuItem, { label: string | (() => string) }>;
const isLeaf = (it: MenuItem): it is Leaf => 'label' in it;

/** Is point p inside the triangle a-b-c? Used so a pointer heading for a flyout can cross the rows in between. */
function inTriangle(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }) {
  const s = (p1: typeof p, p2: typeof p, p3: typeof p) => (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y);
  const d1 = s(p, a, b), d2 = s(p, b, c), d3 = s(p, c, a);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}

/**
 * A pop-up menu at a screen position, in a portal so a list that clips its content cannot cut it off. Closes on
 * Escape, scrolling, resizing and a press outside. Presses on an element marked `data-menu-trigger` are ignored
 * here because that element toggles the menu itself (otherwise its own press closes the menu and its click reopens it).
 *
 * A group opens as a flyout beside its row (hover with a short delay, or a tap on touch screens) and the main menu stays
 * visible. The flyout is kept on screen (it flips to the left side when the right has no room), and a pointer that is
 * heading for it may cross the rows in between without it closing (a grace delay plus the "safe triangle" test).
 */
export function ContextMenu({ at, onClose }: { at: MenuAt; onClose: () => void }) {
  const nav = useNavigate();
  // a counter row keeps its own running total, since the menu's items were built when it opened
  const [deltas, setDeltas] = useState<Record<string, number>>({});
  const [flipped, setFlipped] = useState<ReadonlySet<string>>(new Set());
  // the groups open so far: chain[d] is the row of panel d whose flyout is showing
  const [chain, setChain] = useState<Chain>([]);
  const timer = useRef<number | undefined>(undefined);
  const leavePt = useRef<{ x: number; y: number } | null>(null);
  const pointer = useRef('mouse');
  const panels = useRef<(HTMLDivElement | null)[]>([]);
  const clear = () => { if (timer.current !== undefined) { window.clearTimeout(timer.current); timer.current = undefined; } };
  const later = (ms: number, fn: () => void) => { clear(); timer.current = window.setTimeout(() => { timer.current = undefined; fn(); }, ms); };
  useEffect(() => clear, []);

  useEffect(() => {
    const inside = (el: Element | null) => !!el?.closest?.('[data-menu-panel]');
    const down = (e: MouseEvent) => { const el = e.target as Element; if (inside(el) || el.closest?.('[data-menu-trigger]')) return; onClose(); };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    // scrolling a MENU (a long one on a phone) must not close it; only the page moving underneath does
    const scroll = (e: Event) => { if (e.target instanceof Element && inside(e.target)) return; onClose(); };
    // a phone's address bar growing or shrinking fires a resize that only changes the height: not a reason to close
    let w = window.innerWidth;
    const resize = () => { if (window.innerWidth !== w) onClose(); w = window.innerWidth; };
    window.addEventListener('mousedown', down); window.addEventListener('keydown', key); window.addEventListener('scroll', scroll, true); window.addEventListener('resize', resize);
    return () => { window.removeEventListener('mousedown', down); window.removeEventListener('keydown', key); window.removeEventListener('scroll', scroll, true); window.removeEventListener('resize', resize); };
  }, [onClose]);

  const itemsOf = (depth: number): MenuItem[] => {
    let items = at.items;
    for (let k = 0; k < depth; k++) { const it = items[chain[k].index]; items = it && isLeaf(it) && it.children ? it.children : []; }
    return items;
  };
  const openAt = (d: number, i: number, el: HTMLElement) => setChain((c) => [...c.slice(0, d), { index: i, rect: el.getBoundingClientRect() }]);
  const closeFrom = (d: number) => setChain((c) => (c.length > d ? c.slice(0, d) : c));

  /** the pointer arrived on a row of panel `d`: open its group, or close the one that is open, after a grace delay */
  const hover = (d: number, i: number, el: HTMLElement, group: boolean, e: React.PointerEvent) => {
    pointer.current = e.pointerType;
    if (e.pointerType !== 'mouse') return;
    const cur = chain[d];
    if (group && cur?.index === i) { clear(); return; }
    let heading = false;
    const fly = panels.current[d + 1];
    if (cur && fly && leavePt.current) {
      const f = fly.getBoundingClientRect();
      const x = f.left >= cur.rect.right - 8 ? f.left : f.right;
      heading = inTriangle({ x: e.clientX, y: e.clientY }, leavePt.current, { x, y: f.top }, { x, y: f.bottom });
    }
    if (group) later(cur ? (heading ? 380 : 120) : 140, () => openAt(d, i, el));
    else if (cur) later(heading ? 380 : 110, () => closeFrom(d));
    else clear();
  };
  const api = { at, nav, onClose, deltas, setDeltas, flipped, setFlipped, chain, hover, openAt, closeFrom, clear, pointer, leavePt, panels };
  return <>
    {[...Array(chain.length + 1).keys()].map((d) => {
      const parent = d ? itemsOf(d - 1)[chain[d - 1].index] : undefined;
      const content = parent && isLeaf(parent) && parent.flyout ? parent.flyout(onClose) : undefined;
      return <Panel key={d} depth={d} items={d && content ? [] : itemsOf(d)} content={content} api={api} anchor={d ? chain[d - 1].rect : undefined} />;
    })}
  </>;
}

type Api = {
  at: MenuAt; nav: (to: string) => void; onClose: () => void;
  deltas: Record<string, number>; setDeltas: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  flipped: ReadonlySet<string>; setFlipped: React.Dispatch<React.SetStateAction<ReadonlySet<string>>>;
  chain: Chain; hover: (d: number, i: number, el: HTMLElement, group: boolean, e: React.PointerEvent) => void;
  openAt: (d: number, i: number, el: HTMLElement) => void; closeFrom: (d: number) => void; clear: () => void;
  pointer: React.MutableRefObject<string>; leavePt: React.MutableRefObject<{ x: number; y: number } | null>;
  panels: React.MutableRefObject<(HTMLDivElement | null)[]>;
};

function Panel({ depth, items, api, anchor, content }: { depth: number; items: MenuItem[]; api: Api; anchor?: DOMRect; content?: ReactNode }) {
  const { at, deltas, setDeltas, flipped, setFlipped, chain } = api;
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number; side: 'right' | 'left' }>({ left: anchor ? anchor.right : at.x, top: anchor ? anchor.top : at.y, side: 'right' });
  // keep the panel on screen. Offset sizes, not getBoundingClientRect: the opening animation scales the panel, which would measure it too small.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth, h = el.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
    const clampTop = (t: number) => Math.max(8, Math.min(t, vh - h - 8));
    if (!anchor) { setPos({ left: Math.max(8, Math.min(at.x, vw - w - 8)), top: clampTop(at.y), side: 'right' }); return; }
    if (vw < 560) { setPos({ left: Math.max(8, Math.min(anchor.left + 28, vw - w - 8)), top: clampTop(anchor.top + 6), side: 'right' }); return; }
    const right = anchor.right - 4;
    if (right + w <= vw - 8) setPos({ left: right, top: clampTop(anchor.top - 6), side: 'right' });
    else setPos({ left: Math.max(8, anchor.left - w + 4), top: clampTop(anchor.top - 6), side: 'left' });
  }, [at.x, at.y, anchor, items]);
  const origin = anchor ? `${pos.side === 'right' ? 0 : '100%'} ${Math.max(0, anchor.top + anchor.height / 2 - pos.top)}px` : `${Math.max(0, at.x - pos.left)}px ${Math.max(0, at.y - pos.top)}px`;
  return createPortal(
    <div ref={(el) => { ref.current = el; api.panels.current[depth] = el; }} role="menu" aria-label={at.label} data-menu-panel={depth}
      className={`bt-menu fixed ${depth ? 'z-[61]' : 'z-[60]'} max-h-[calc(100dvh-1rem)] w-60 overflow-y-auto overscroll-contain py-1 [-webkit-overflow-scrolling:touch]`}
      style={{ left: pos.left, top: pos.top, touchAction: 'pan-y', transformOrigin: origin }}
      onPointerEnter={api.clear}
      onContextMenu={(e) => e.preventDefault()}>
      {content}
      {items.map((it, i) => {
        if ('separator' in it) return <div key={i} role="separator" className="my-1 border-t border-line/60" />;
        const k = `${depth}:${i}`;
        if ('counter' in it) {
          const c = it.counter; const d = deltas[k] ?? 0; const value = Math.max(0, c.value + d);
          return <div key={k} role="group" aria-label={c.label} className="flex items-center gap-3 px-3 py-1.5 text-sm" onPointerEnter={(e) => api.hover(depth, i, e.currentTarget, false, e)} onPointerLeave={(e) => { api.leavePt.current = { x: e.clientX, y: e.clientY }; }}>
            {c.icon}<span className="min-w-0 flex-1">{c.label}</span>
            <button type="button" className="btn !p-1" aria-label={`Remove one: ${c.label}`} disabled={c.minusDisabled ? value < 1 && d <= 0 : value < 1} onClick={() => { c.onMinus(); setDeltas((x) => ({ ...x, [k]: (x[k] ?? 0) - 1 })); }}><Minus size={13} /></button>
            <span className="w-5 text-center font-semibold tabular-nums">{value}</span>
            <button type="button" className="btn !p-1" aria-label={`Add one: ${c.label}`} onClick={() => { c.onPlus(); setDeltas((x) => ({ ...x, [k]: (x[k] ?? 0) + 1 })); }}><Plus size={13} /></button>
          </div>;
        }
        const kids = it.children ?? (it.flyout ? [] : undefined);
        const on = it.checked === undefined ? undefined : it.checked !== flipped.has(k);
        const isOpen = !!kids && chain[depth]?.index === i;
        const act = () => {
          if (it.keepOpen) { it.run?.(); if (it.checked === undefined) { setFlipped((f) => new Set(f)); return; } setFlipped((f) => { const n = new Set(f); if (n.has(k)) n.delete(k); else n.add(k); return n; }); return; }
          api.onClose(); if (it.to) api.nav(it.to); it.run?.();
        };
        const click = (e: React.MouseEvent<HTMLButtonElement>) => {
          // a touch has no hover, so a tap on a group opens it (its first item is the group's main action); a mouse click does the main action
          if (kids && (api.pointer.current !== 'mouse' || !(it.run || it.to))) { isOpen ? api.closeFrom(depth) : api.openAt(depth, i, e.currentTarget); return; }
          act();
        };
        return <button key={k} role="menuitem" disabled={it.disabled} aria-checked={on} aria-haspopup={kids ? 'menu' : undefined} aria-expanded={kids ? isOpen : undefined}
          className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm disabled:opacity-40 aria-expanded:bg-hover ${it.danger ? 'text-bad' : ''}`}
          onPointerDown={(e) => { api.pointer.current = e.pointerType; }}
          onPointerEnter={(e) => api.hover(depth, i, e.currentTarget, !!kids && !it.disabled, e)}
          onPointerLeave={(e) => { api.leavePt.current = { x: e.clientX, y: e.clientY }; }}
          onKeyDown={(e) => { if (kids && e.key === 'ArrowRight') { e.preventDefault(); api.openAt(depth, i, e.currentTarget); } else if (depth && e.key === 'ArrowLeft') { e.preventDefault(); api.closeFrom(depth); } }}
          onClick={click}>{it.icon}<span className="min-w-0 flex-1">{labelOf(it)}</span>
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
