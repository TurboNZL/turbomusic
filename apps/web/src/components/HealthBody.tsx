import { useDeferredValue, useMemo, useState, type ReactNode } from 'react';
import { Search } from 'lucide-react';
import type { HealthCheck, HealthItem } from '../lib/health.ts';
import type { Library } from '../lib/derive.ts';
import { rankHealthItems } from '../lib/healthRank.ts';
import { useChunks } from '../lib/useChunks.ts';

/**
 * The list part of one Library health check: a search box, the items sorted by relevance, and only a screenful drawn at a time
 * (more arrive as you scroll). Before, opening a check drew every item at once, which froze on a library with thousands of them.
 */
export function CheckBody({ check, lib, children }: { check: HealthCheck; lib: Library; children: (items: HealthItem[]) => ReactNode }) {
  const [q, setQ] = useState('');
  const deferred = useDeferredValue(q);
  const ranked = useMemo(() => rankHealthItems(lib, check.items, deferred), [lib, check.items, deferred]);
  const { shown, left, more, sentinel } = useChunks(ranked.length, 40, `${check.id}|${deferred}`);
  return (
    <div>
      {check.items.length > 8 && <label className="relative mx-4 mb-2 block"><Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <input className="input w-full !py-1.5 !pl-9 text-sm" placeholder={`Search these ${check.items.length}`} aria-label={`Search ${check.title}`} value={q} onChange={(e) => setQ(e.target.value)} /></label>}
      {children(ranked.slice(0, shown))}
      {left > 0 && <div ref={sentinel} className="px-4 py-2"><button className="btn btn-ghost text-xs" onClick={more}>Show more ({left} left)</button></div>}
      {!ranked.length && <div className="px-4 py-3 text-sm text-muted">Nothing matches “{deferred}”.</div>}
    </div>
  );
}
