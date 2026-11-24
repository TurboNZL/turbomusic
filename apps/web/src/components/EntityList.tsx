import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Cover } from './Cover.tsx';
import { cn } from '../lib/cn.ts';
import { useSelection } from '../lib/useSelection.ts';
import { EntitySelectionBar } from './SelectionBar.tsx';

export interface EntityRow { id: string; to: string; cover: string | null | undefined; seed: string; title: string; sub?: ReactNode; meta?: ReactNode; kind?: 'artist'; menu?: (e: React.MouseEvent) => void }

/**
 * The compact "List" view of Albums, Artists and Eras: one line per item with a small cover, the way Tracks reads.
 * Shift- or Ctrl-click a row to select instead of opening it (once something is selected a plain click toggles); the bar then
 * plays or queues their songs (`trackIdsOf`) and can hide them (`hide`).
 */
export function EntityList({ rows, allIds, trackIdsOf, hide }: { rows: EntityRow[]; /** every id of the list (rows may be drawn in parts), so a Shift range can span them */ allIds?: string[]; trackIdsOf?: (id: string) => string[]; hide?: { hidden: (id: string) => boolean; set: (id: string, v: boolean) => void } }) {
  const sel = useSelection(allIds ?? rows.map((r) => r.id));
  const selectable = !!trackIdsOf;
  return (
    <div className="card divide-y divide-line/50 overflow-hidden">
      {rows.map((r) => (
        <Link key={r.id} to={r.to} data-selected={sel.has(r.id) || undefined} className={cn('bt-row flex items-center gap-3 px-3 py-2 hover:bg-raised/60')} onContextMenu={r.menu}
          onMouseDown={(e) => { if (selectable && e.shiftKey) e.preventDefault(); }}
          onClick={(e) => { if (selectable && (e.shiftKey || e.ctrlKey || e.metaKey || sel.size > 0)) { e.preventDefault(); sel.click(r.id, e); } }}>
          <Cover kind={r.kind} hash={r.cover} seed={r.seed} className="h-11 w-11 shrink-0" />
          <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{r.title}</div>{r.sub && <div className="truncate text-xs text-muted">{r.sub}</div>}</div>
          {r.meta && <div className="shrink-0 text-right text-xs tabular-nums text-muted">{r.meta}</div>}
        </Link>))}
      {selectable && <EntitySelectionBar sel={sel} total={allIds?.length ?? rows.length} trackIdsOf={trackIdsOf!} hide={hide} />}
    </div>
  );
}
