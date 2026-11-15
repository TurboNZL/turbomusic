import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, LayoutGrid, List } from 'lucide-react';
import { FilterBar } from './FilterBar.tsx';
import { Select } from './Select.tsx';
import { cn } from '../lib/cn.ts';
import type { Chip, FilterScope } from '../lib/filters.ts';
import type { SortOption } from '../lib/listSort.ts';
import type { ViewMode } from '../lib/pageState.ts';
import type { SortDir } from '../lib/trackSort.ts';

/**
 * The one row every list page (Tracks, Albums, Artists, Eras, Singles) puts under its title: the search box with its filter
 * chips, then Sort (column + direction) and the Covers/List switch, all on the same line so they line up from page to page.
 */
export function ListToolbar<K extends string>({ actions, scope, chips, onChips, text, onText, placeholder, sorts, sort, dir, onSort, onFlip, view, onView, views = ['grid', 'list'] }: {
  scope: FilterScope; chips: Chip[]; onChips: (c: Chip[]) => void; text: string; onText: (t: string) => void; placeholder?: string;
  sorts: SortOption<K>[]; sort: K; dir: SortDir; onSort: (k: K) => void; onFlip: () => void;
  view: ViewMode; onView: (v: ViewMode) => void; views?: ViewMode[];
  /** the page's own buttons (play, shuffle, new…): they sit on this row, after the search box, so the title row stays a title */
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-center gap-2" role="toolbar" aria-label="Search, sort and view">
      <FilterBar scope={scope} chips={chips} onChips={onChips} text={text} onText={onText} placeholder={placeholder} />
      <div className="flex items-center gap-2 max-sm:-mx-1 max-sm:w-full max-sm:flex-nowrap max-sm:overflow-x-auto max-sm:px-1 max-sm:pb-1 sm:ml-auto sm:flex-wrap [&>*]:shrink-0">
        {actions && <div className="flex items-center gap-2 max-sm:order-last sm:contents">{actions}</div>}
        <Select className="!w-44 max-sm:!w-36" aria-label="Sort by" value={sort} onChange={(v) => v !== sort && onSort(v as K)} options={sorts.map((o) => ({ value: o.value, label: `Sort: ${o.label}` }))} />
        <button type="button" className="btn !px-2.5" onClick={onFlip} aria-label={dir === 'asc' ? 'Ascending: switch to descending' : 'Descending: switch to ascending'} title={dir === 'asc' ? 'Ascending' : 'Descending'}>
          {dir === 'asc' ? <ArrowUp size={15} /> : <ArrowDown size={15} />}
        </button>
        {views.length > 1 && (
          <div className="flex" role="group" aria-label="View">
            <button type="button" className={cn('btn !rounded-r-none', view === 'grid' && 'btn-accent')} aria-pressed={view === 'grid'} onClick={() => onView('grid')} title="Covers"><LayoutGrid size={15} /></button>
            <button type="button" className={cn('btn !rounded-l-none', view === 'list' && 'btn-accent')} aria-pressed={view === 'list'} onClick={() => onView('list')} title="List"><List size={15} /></button>
          </div>)}
      </div>
    </div>
  );
}
