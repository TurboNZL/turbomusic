import { useMemo, useState } from 'react';
import { SlidersHorizontal, X } from 'lucide-react';
import { RANGES } from '../lib/listenStats.ts';
import { DEFAULT_FILTER, activeCount, platformsOf, type DayPart, type StatsFilter } from '../lib/statsFilter.ts';
import type { Listen } from '../lib/listens.ts';
import { cn } from '../lib/cn.ts';
import { useLibrary } from '../lib/derive.ts';
import { FilterBar } from './FilterBar.tsx';

const LENGTHS = [{ ms: 0, label: 'Any length' }, { ms: 10_000, label: '10 s or more' }, { ms: 30_000, label: '30 s or more' }, { ms: 60_000, label: '1 min or more' }, { ms: 120_000, label: '2 min or more' }];
const PARTS: { id: DayPart; label: string }[] = [{ id: 'any', label: 'Any time of day' }, { id: 'morning', label: 'Morning (5–12)' }, { id: 'afternoon', label: 'Afternoon (12–17)' }, { id: 'evening', label: 'Evening (17–22)' }, { id: 'night', label: 'Night (22–5)' }];

/**
 * The filters of the Stats page: a time range (presets or your own dates), the shortest play that counts (30 s by default, like stats.fm),
 * and, under "More filters", where it was heard, skipped or not, when in the day, and the same artist / album / era / genre / rating
 * chips the library lists have. Everything applies to every tab.
 */
export function StatsFilters({ value, onChange, listens }: { value: StatsFilter; onChange: (f: StatsFilter) => void; listens: Listen[] }) {
  const [more, setMore] = useState(() => activeCount(value) > 0);
  const platforms = useMemo(() => platformsOf(listens), [listens]);
  const set = (p: Partial<StatsFilter>) => onChange({ ...value, ...p });
  const n = activeCount(value);
  const hasPre = useLibrary().preReleases.length > 0;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Time range">
          {RANGES.map((r) => <button key={r.id} className={cn('btn !py-1 !text-xs', value.range === r.id && 'btn-accent')} aria-pressed={value.range === r.id} onClick={() => set({ range: r.id })}>{r.label}</button>)}
          <button className={cn('btn !py-1 !text-xs', value.range === 'custom' && 'btn-accent')} aria-pressed={value.range === 'custom'} onClick={() => set({ range: 'custom' })}>Custom</button>
        </div>
        <select className="input !w-auto !py-1 !text-xs" aria-label="Shortest play that counts" title="stats.fm only counts a play that lasted at least 30 seconds" value={value.minMs} onChange={(e) => set({ minMs: Number(e.target.value) })}>
          {LENGTHS.map((l) => <option key={l.ms} value={l.ms}>{l.label}</option>)}</select>
        <button className={cn('btn !py-1 !text-xs', (more || n > 0) && 'btn-accent')} aria-expanded={more} onClick={() => setMore((m) => !m)}><SlidersHorizontal size={13} />More filters{n > 0 && ` (${n})`}</button>
        {(n > 0 || value.range !== DEFAULT_FILTER.range || value.minMs !== DEFAULT_FILTER.minMs) && <button className="btn btn-ghost !py-1 !text-xs" onClick={() => onChange({ ...DEFAULT_FILTER })}><X size={13} />Reset</button>}
      </div>
      {value.range === 'custom' && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <label className="flex items-center gap-1.5">From<input className="input !w-auto !py-1" type="date" value={value.from} max={value.to || undefined} onChange={(e) => set({ from: e.target.value })} /></label>
          <label className="flex items-center gap-1.5">to<input className="input !w-auto !py-1" type="date" value={value.to} min={value.from || undefined} onChange={(e) => set({ to: e.target.value })} /></label>
          <span>both days included</span>
        </div>)}
      {more && (
        <div className="space-y-2 rounded-theme border border-line p-3">
          <div className="flex flex-wrap items-center gap-2">
            <select className="input !w-auto !py-1 !text-xs" aria-label="Source" value={value.source} onChange={(e) => set({ source: e.target.value as StatsFilter['source'] })}><option value="all">All sources</option><option value="turbomusic">Played in TurboMusic</option><option value="spotify">From Spotify</option></select>
            <select className="input !w-auto !py-1 !text-xs" aria-label="Skips" value={value.skips} onChange={(e) => set({ skips: e.target.value as StatsFilter['skips'] })}><option value="all">Plays and skips</option><option value="played">Played through</option><option value="skipped">Skipped only</option></select>
            <select className="input !w-auto !py-1 !text-xs" aria-label="Platform" value={value.platform} onChange={(e) => set({ platform: e.target.value })}><option value="">Any platform</option>{platforms.map((p) => <option key={p} value={p}>{p}</option>)}</select>
            <select className="input !w-auto !py-1 !text-xs" aria-label="Time of day" value={value.dayPart} onChange={(e) => set({ dayPart: e.target.value as DayPart })}>{PARTS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
            <select className="input !w-auto !py-1 !text-xs" aria-label="Days" value={value.days} onChange={(e) => set({ days: e.target.value as StatsFilter['days'] })}><option value="all">Every day</option><option value="weekdays">Weekdays</option><option value="weekends">Weekends</option></select>
            {hasPre && <label className="flex items-center gap-1.5 text-xs text-muted" title="Plays of pre-release versions (marked [U]) count as plays of the released track"><input type="checkbox" checked={!!value.combinePre} onChange={(e) => set({ combinePre: e.target.checked })} />Combine pre-release versions with the released track</label>}
            <label className="flex items-center gap-1.5 text-xs text-muted"><input type="checkbox" checked={value.libraryOnly} onChange={(e) => set({ libraryOnly: e.target.checked })} />Only tracks in my library</label>
          </div>
          <FilterBar scope="tracks" chips={value.chips} onChips={(chips) => set({ chips })} text={value.text} onText={(text) => set({ text })} placeholder="Words, or filter: artist, album, era, genre, rating…" />
          <p className="text-xs text-muted">Filters like <code>artist:</code> and <code>rating:</code> look at tracks in your library, so plays of songs you do not have drop out while one is set.</p>
        </div>)}
    </div>
  );
}
