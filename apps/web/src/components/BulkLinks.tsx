import { useMemo, useState } from 'react';
import { AlertTriangle, Check, Search } from 'lucide-react';
import { healthScores } from '../lib/healthRank.ts';
import { useChunks } from '../lib/useChunks.ts';
import { useLibrary } from '../lib/derive.ts';
import { useStore } from '../lib/store.ts';
import { assignLinks, linkGroups, LINK_LABEL, looksRight, parseLinks, type LinkGroup, type LinkKind } from '../lib/bulkLinks.ts';
import { Modal } from './forms.tsx';
import { cn } from '../lib/cn.ts';

/**
 * Paste the links of a whole album at once: one per line, in tracklist order. Each album is its own box, so a
 * playlist's worth of links lands on the right tracks without opening every track editor.
 */
export function BulkLinks({ kind, onClose }: { kind: LinkKind; onClose: () => void }) {
  const lib = useLibrary();
  const patch = useStore((s) => s.patch);
  const allGroups = useMemo(() => linkGroups(lib, kind), [lib, kind]);
  const [q, setQ] = useState('');
  // the albums you play and rate most come first; the search matches album, artist and song names
  const groups = useMemo(() => {
    const scores = healthScores(lib, allGroups.flatMap((g) => g.tracks.map((t) => ({ kind: 'track' as const, id: t.id, label: t.title }))));
    const best = (g: LinkGroup) => Math.max(0, ...g.tracks.map((t) => scores.get(`track:${t.id}`) ?? 0));
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const kept = words.length ? allGroups.filter((g) => { const hay = `${g.title} ${g.subtitle} ${g.tracks.map((t) => t.title).join(' ')}`.toLowerCase(); return words.every((w) => hay.includes(w)); }) : allGroups;
    return [...kept].sort((a, b) => best(b) - best(a));
  }, [lib, allGroups, q]);
  const { shown, left, more, sentinel } = useChunks(groups.length, 12, `${kind}|${q}`);
  const [text, setText] = useState<Record<string, string>>({});
  const [all, setAll] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState(0);

  const plan = (g: LinkGroup) => {
    const rows = all[g.key] ? g.tracks : g.tracks.filter((t) => !t[kind]);
    const lines = parseLinks(text[g.key] ?? '');
    return { rows, lines, map: assignLinks(rows, lines) };
  };
  const total = allGroups.reduce((n, g) => n + [...plan(g).map.values()].filter(Boolean).length, 0);

  function save() {
    let n = 0;
    for (const g of allGroups) for (const [id, url] of plan(g).map) if (url) { patch('tracks', id, { [kind]: url }); n++; }
    setSaved(n);
    setText({});
  }

  return (
    <Modal wide title={`Paste ${LINK_LABEL[kind]} links`} onClose={onClose}
      footer={<><span className="text-sm text-muted">{saved ? `Saved ${saved} link${saved === 1 ? '' : 's'}.` : total ? `${total} link${total === 1 ? '' : 's'} ready` : 'Nothing pasted yet'}</span>
        <button className="btn ml-auto" onClick={onClose}>Close</button><button className="btn btn-accent" disabled={!total} onClick={save}><Check size={15} />Save {total || ''}</button></>}>
      <p className="text-sm text-muted">One box per album. Paste its links, one per line, in the order of the tracks listed under it. A blank line skips a track. Nothing is saved until you press Save.</p>
      {allGroups.length > 5 && <label className="relative block"><Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" /><input className="input w-full !py-1.5 !pl-9 text-sm" placeholder="Search albums, artists or songs" aria-label="Search albums" value={q} onChange={(e) => setQ(e.target.value)} /></label>}
      {!allGroups.length && <p className="text-sm text-good">Every track has a {LINK_LABEL[kind]} link.</p>}
      {allGroups.length > 0 && !groups.length && <p className="text-sm text-muted">No album matches “{q}”.</p>}
      {groups.slice(0, shown).map((g) => {
        const { rows, lines, map } = plan(g);
        const missing = g.tracks.filter((t) => !t[kind]).length;
        return (
          <section key={g.key} className="space-y-2 rounded-theme border border-line p-3">
            <div className="flex flex-wrap items-baseline gap-x-2"><h3 className="font-semibold">{g.title}</h3><span className="text-xs text-muted">{g.subtitle} · {missing} of {g.tracks.length} missing</span>
              {missing < g.tracks.length && <label className="ml-auto flex items-center gap-1.5 text-xs text-muted"><input type="checkbox" checked={!!all[g.key]} onChange={(e) => setAll({ ...all, [g.key]: e.target.checked })} />Match every track (replaces existing links)</label>}</div>
            <textarea className="input min-h-[4.5rem] font-mono text-xs" placeholder={`Paste ${rows.length} link${rows.length === 1 ? '' : 's'} here, one per line`} value={text[g.key] ?? ''} onChange={(e) => setText({ ...text, [g.key]: e.target.value })} />
            <ol className="divide-y divide-line/50 text-sm">
              {rows.map((t, i) => {
                const url = map.get(t.id);
                const bad = url ? !looksRight(kind, url) : false;
                return (
                  <li key={t.id} className="flex items-center gap-2 py-1">
                    <span className="w-6 shrink-0 text-right text-xs tabular-nums text-muted">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate">{t.title}</span>
                    <span className={cn('min-w-0 max-w-[45%] flex-1 truncate text-xs', url ? (bad ? 'text-warn' : 'text-good') : 'text-muted')} title={url ?? undefined}>
                      {url ? <>{bad && <AlertTriangle size={11} className="mr-1 inline" />}{url.replace(/^https?:\/\/(www\.)?/, '')}</> : t[kind] && !all[g.key] ? '' : '—'}</span>
                  </li>);
              })}
            </ol>
            {lines.filter(Boolean).length > rows.length && <p className="text-xs text-warn">{lines.filter(Boolean).length - rows.length} extra link(s) beyond the last track are ignored.</p>}
          </section>);
      })}
      {left > 0 && <div ref={sentinel}><button className="btn btn-ghost text-xs" onClick={more}>Show more albums ({left} left)</button></div>}
    </Modal>
  );
}
