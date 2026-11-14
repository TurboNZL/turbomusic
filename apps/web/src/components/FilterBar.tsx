import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search, X } from 'lucide-react';
import { useLibrary } from '../lib/derive.ts';
import { FILTER_DOCS, HAS_VALUES, filterKeys, makeChip, splitTyped, type Chip, type FilterScope } from '../lib/filters.ts';
import { allReleaseTags } from '../lib/releaseOps.ts';
import { usePresence } from '../lib/presence.ts';
import { cn } from '../lib/cn.ts';

interface Suggestion { id: string; label: string; hint?: string; run: () => void }

/**
 * A search box with filters, after Discord's: type words to search, or `artist:` / `before:` / `has:` and friends to add a
 * chip. Focus the empty box to see every filter; keep typing to narrow it. Chips combine, and Backspace on an empty box
 * takes the last one off.
 */
export function FilterBar({ chips, onChips, text, onText, scope, placeholder = 'Search, or filter: artist, era, before…' }: {
  chips: Chip[]; onChips: (c: Chip[]) => void; text: string; onText: (t: string) => void; scope: FilterScope; placeholder?: string;
}) {
  const lib = useLibrary();
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [focus, setFocus] = useState(false);
  const [hi, setHi] = useState(0);
  const [pos, setPos] = useState<React.CSSProperties>({});
  const keys = filterKeys(scope);

  const add = (c: Chip | null) => { if (!c) return false; if (!chips.some((x) => x.key === c.key && x.value === c.value)) onChips([...chips, c]); onText(''); return true; };
  const split = splitTyped(text, scope);

  const years = useMemo(() => [...new Set([...lib.albums.map((a) => a.releaseDate), ...lib.tracks.map((t) => t.releaseDate)].flatMap((d) => (d ? [d.slice(0, 4)] : [])))].sort().reverse().slice(0, 12), [lib]);
  const suggestions: Suggestion[] = useMemo(() => {
    const out: Suggestion[] = [];
    if (!split) {
      const t = text.trim().toLowerCase();
      for (const k of keys) if (!t || k.startsWith(t)) out.push({ id: k, label: `${k}:`, hint: FILTER_DOCS[k].hint, run: () => { onText(`${k}: `); input.current?.focus(); } });
      return out;
    }
    const { key, rest } = split;
    const r = rest.trim().toLowerCase();
    const named = (list: { label: string }[]) => list.filter((x) => !r || x.label.toLowerCase().includes(r)).slice(0, 8).map((x) => ({ id: x.label, label: x.label, run: () => add(makeChip(lib, key, x.label)) }));
    if (key === 'artist') out.push(...named(lib.artists.map((a) => ({ label: a.name }))));
    else if (key === 'album') out.push(...named(lib.albums.map((a) => ({ label: a.title }))));
    else if (key === 'era') out.push(...named(lib.eras.map((e) => ({ label: e.name }))));
    else if (key === 'genre') out.push(...named(lib.genres.map((g) => ({ label: g.name }))));
    else if (key === 'tag') out.push(...named(allReleaseTags(lib.releases).map((t) => ({ label: t }))));
    else if (key === 'has') out.push(...HAS_VALUES.filter((v) => !r || v.startsWith(r)).map((v) => ({ id: v, label: v, run: () => add(makeChip(lib, 'has', v)) })));
    else if (key === 'before' || key === 'after') {
      const typedChip = makeChip(lib, key, rest);
      if (typedChip) out.push({ id: 'typed', label: `${key}: ${rest.trim()}`, hint: 'Use this', run: () => add(typedChip) });
      out.push(...years.filter((y) => !r || y.startsWith(r)).map((y) => ({ id: y, label: y, hint: key === 'before' ? `Before ${y}` : `After ${y}`, run: () => add(makeChip(lib, key, y)) })));
    } else if (key === 'rating') {
      const typedChip = makeChip(lib, key, rest);
      if (typedChip) out.push({ id: 'typed', label: `rating: ${rest.trim()}`, hint: 'Use this', run: () => add(typedChip) });
      for (const e of ['>7', '>=8', '<4', '7-9']) if (!r || e.startsWith(r)) out.push({ id: e, label: e, hint: e.startsWith('>') ? 'Above' : e.startsWith('<') ? 'Below' : 'Between', run: () => add(makeChip(lib, 'rating', e)) });
    }
    return out;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, lib, chips, scope, years]);
  useEffect(() => setHi(0), [text]);

  const open = focus && suggestions.length > 0;
  const { mounted, leaving } = usePresence(open);
  useLayoutEffect(() => {
    if (!mounted || !box.current) return;
    const place = () => { const r = box.current!.getBoundingClientRect(); setPos({ left: r.left, top: r.bottom + 6, width: Math.max(r.width, 280) }); };
    place();
    window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [mounted]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !text && chips.length) { onChips(chips.slice(0, -1)); return; }
    if (e.key === 'Escape') { input.current?.blur(); return; }
    if (!open) { if (e.key === 'Enter' && split) { e.preventDefault(); add(makeChip(lib, split.key, split.rest)); } return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(suggestions.length - 1, h + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
    else if (e.key === 'Tab' && suggestions[hi]) { e.preventDefault(); suggestions[hi].run(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (split && !suggestions.length) add(makeChip(lib, split.key, split.rest)); else suggestions[hi]?.run(); }
  };

  return (
    <>
      <div ref={box} role="search" className={cn('input flex min-h-[2.25rem] min-w-0 flex-1 sm:min-w-[min(16rem,100%)] cursor-text flex-wrap items-center gap-1.5 !py-1 sm:max-w-xl', focus && 'bt-focus')} onClick={() => input.current?.focus()}>
        <Search size={14} className="shrink-0 text-muted" />
        {chips.map((c, i) => (
          <span key={`${c.key}${c.value}`} className="chip gap-1 !bg-accent/15 !text-fg">
            <span className="text-muted">{c.key}:</span>{c.label}
            <button type="button" aria-label={`Remove ${c.key} filter ${c.label}`} className="text-muted hover:text-fg" onClick={(e) => { e.stopPropagation(); onChips(chips.filter((_, j) => j !== i)); }}><X size={12} /></button>
          </span>))}
        <input ref={input} className="min-w-[3.5rem] flex-1 bg-transparent py-0.5 text-sm outline-none placeholder:text-muted" placeholder={chips.length ? 'Add a filter…' : placeholder} aria-label="Search and filter"
          value={text} onChange={(e) => onText(e.target.value)} onFocus={() => setFocus(true)} onBlur={() => setTimeout(() => setFocus(false), 120)} onKeyDown={onKey} />
        {(chips.length > 0 || text) && <button type="button" className="shrink-0 text-xs text-muted hover:text-fg" onClick={(e) => { e.stopPropagation(); onChips([]); onText(''); }}>Clear</button>}
      </div>
      {mounted && createPortal(
        <div role="listbox" data-leaving={leaving || undefined} style={pos} className="bt-menu bt-popover fixed z-[70] max-h-80 overflow-y-auto py-1" onMouseDown={(e) => e.preventDefault()}>
          <div className="px-3 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wider text-muted">{split ? `${split.key}` : 'Filters'}</div>
          {suggestions.map((s, i) => (
            <button key={s.id} type="button" role="option" aria-selected={i === hi} className={cn('flex w-full items-baseline gap-3 px-3 py-1.5 text-left text-sm', i === hi && 'bt-select-hi')} onMouseEnter={() => setHi(i)} onClick={s.run}>
              <span className="font-medium">{s.label}</span>{s.hint && <span className="ml-auto truncate text-xs text-muted">{s.hint}</span>}
            </button>))}
        </div>, document.body)}
    </>
  );
}
