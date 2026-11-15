import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';

export type MenuItem =
  | { separator: true }
  /** `checked` draws a tick (a switch); `keepOpen` runs the item without closing the menu, and the tick flips at once */
  | { label: string; icon?: ReactNode; run?: () => void; to?: string; disabled?: boolean; danger?: boolean; checked?: boolean; keepOpen?: boolean };

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
  const [flipped, setFlipped] = useState<ReadonlySet<number>>(new Set());

  // keep the menu on screen
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // offset sizes, not getBoundingClientRect: the opening animation scales the menu, which would measure it too small
    const w = el.offsetWidth, h = el.offsetHeight;
    setPos({ left: Math.max(8, Math.min(at.x, window.innerWidth - w - 8)), top: Math.max(8, Math.min(at.y, window.innerHeight - h - 8)) });
  }, [at.x, at.y]);
  useEffect(() => {
    const down = (e: MouseEvent) => {
      const el = e.target as Element;
      if (ref.current?.contains(el) || el.closest?.('[data-menu-trigger]')) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', down); window.addEventListener('keydown', key); window.addEventListener('scroll', onClose, true); window.addEventListener('resize', onClose);
    return () => { window.removeEventListener('mousedown', down); window.removeEventListener('keydown', key); window.removeEventListener('scroll', onClose, true); window.removeEventListener('resize', onClose); };
  }, [onClose]);

  return createPortal(
    <div ref={ref} role="menu" aria-label={at.label} className="bt-menu fixed z-[60] max-h-[calc(100vh-1rem)] w-56 overflow-y-auto py-1"
      style={{ ...pos, transformOrigin: `${Math.max(0, at.x - pos.left)}px ${Math.max(0, at.y - pos.top)}px` }}
      onContextMenu={(e) => e.preventDefault()}>
      {at.items.map((it, i) => 'separator' in it
        ? <div key={i} role="separator" className="my-1 border-t border-line/60" />
        : <button key={i} role="menuitem" disabled={it.disabled} className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm disabled:opacity-40 ${it.danger ? 'text-bad' : ''}`}
            aria-checked={it.checked === undefined ? undefined : it.checked !== flipped.has(i)}
            onClick={() => {
              if (it.keepOpen) { it.run?.(); setFlipped((f) => { const n = new Set(f); if (n.has(i)) n.delete(i); else n.add(i); return n; }); return; }
              onClose(); if (it.to) nav(it.to); it.run?.();
            }}>{it.icon}<span className="min-w-0 flex-1">{it.label}</span>{it.checked !== undefined && <span className="w-4 shrink-0 text-accent" aria-hidden>{it.checked !== flipped.has(i) ? '✓' : ''}</span>}</button>)}
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
