import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface Selection {
  ids: ReadonlySet<string>;
  size: number;
  has(id: string): boolean;
  /** a click on a row: toggles it; Shift extends from the last one clicked; Ctrl/Cmd toggles without moving the anchor logic */
  click(id: string, e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): void;
  toggle(id: string): void;
  selectAll(): void;
  clear(): void;
  /** the selected ids in list order */
  ordered: string[];
}

/** True when a click landed on something that does its own thing (a link, a button, a field), so it must not also select the row. */
export const isInteractive = (target: EventTarget | null) => !!(target as Element | null)?.closest?.('a, button, input, select, textarea, label, [role="menu"], [data-nosel]');

/**
 * Row selection for a list: click toggles a row, Shift-click selects the range from the last click, Ctrl/Cmd-click toggles one.
 * Escape clears. `order` is the list as drawn (all of it, so a range can cover rows not drawn yet).
 */
export function useSelection(order: string[]): Selection {
  const [ids, setIds] = useState<ReadonlySet<string>>(new Set());
  const anchor = useRef<string | null>(null);
  const orderRef = useRef(order); orderRef.current = order;
  // rows that left the list (a filter, a delete) leave the selection too
  useEffect(() => { setIds((cur) => { if (!cur.size) return cur; const live = new Set(order); const next = new Set([...cur].filter((x) => live.has(x))); return next.size === cur.size ? cur : next; }); }, [order]);
  const toggle = useCallback((id: string) => { anchor.current = id; setIds((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; }); }, []);
  const click = useCallback((id: string, e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) => {
    const list = orderRef.current;
    if (e.shiftKey && anchor.current && anchor.current !== id) {
      const a = list.indexOf(anchor.current), b = list.indexOf(id);
      if (a >= 0 && b >= 0) { const [lo, hi] = a < b ? [a, b] : [b, a]; setIds((cur) => { const n = new Set(e.ctrlKey || e.metaKey ? cur : []); for (let i = lo; i <= hi; i++) n.add(list[i]); return n; }); return; }
    }
    toggle(id);
  }, [toggle]);
  const clear = useCallback(() => { anchor.current = null; setIds(new Set()); }, []);
  const selectAll = useCallback(() => setIds(new Set(orderRef.current)), []);
  useEffect(() => {
    if (!ids.size) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && !(e.target as Element | null)?.closest?.('input, textarea, select, [role="dialog"], [role="menu"]')) clear(); };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [ids.size, clear]);
  const ordered = useMemo(() => order.filter((x) => ids.has(x)), [order, ids]);
  return { ids, size: ids.size, has: (id) => ids.has(id), click, toggle, selectAll, clear, ordered };
}
