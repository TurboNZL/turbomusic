import { useMemo, useState } from 'react';
import { EyeOff, Eye, Tag, Trash2 } from 'lucide-react';
import type { PlaybackLogData, SyncRecord } from '@turbomusic/core';
import { Modal } from './forms.tsx';
import { useLibraryLive } from '../lib/derive.ts';
import { useStore } from '../lib/store.ts';
import { cn } from '../lib/cn.ts';
import { groupLogs, matchWords, type GroupBy, type LogRow } from '../lib/historyGroups.ts';
import { fmtHours } from './charts.tsx';

const BY: { id: GroupBy; label: string }[] = [
  { id: 'artist', label: 'Artists' }, { id: 'album', label: 'Albums' }, { id: 'track', label: 'Tracks' }, { id: 'account', label: 'Accounts' }, { id: 'year', label: 'Years' }, { id: 'source', label: 'How they arrived' },
];

/**
 * Imported Spotify history, kept simple: see it grouped (by artist, album, account, year), tick what does not belong (ASMR played as
 * albums, an old account) and hide it. Hidden plays leave every list and statistic but are kept, so they can come back; delete removes
 * them for good. "Name the account" files plays under an account name so a whole account can be hidden later in one tick.
 */
export function HistoryManager({ onClose }: { onClose: () => void }) {
  const lib = useLibraryLive();
  const importRecords = useStore((s) => s.importRecords);
  const deviceId = useStore((s) => s.settings.deviceId);
  const [by, setBy] = useState<GroupBy>('artist');
  const [q, setQ] = useState('');
  const [words, setWords] = useState('');
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [account, setAccount] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const rows: LogRow[] = useMemo(() => [...lib.logs, ...lib.hiddenLogs].map((l) => ({ id: l.id, data: l as unknown as PlaybackLogData })), [lib.logs, lib.hiddenLogs]);
  const groups = useMemo(() => groupLogs(rows, by), [rows, by]);
  const shown = q.trim() ? groups.filter((g) => `${g.label} ${g.sub ?? ''}`.toLowerCase().includes(q.trim().toLowerCase())) : groups;
  const total = groups.reduce((n, g) => n + g.plays, 0);
  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r] as const)), [rows]);
  // the plays behind the ticks: whole groups, plus any plays the "words" box finds
  const wordIds = useMemo(() => matchWords(rows, words), [rows, words]);
  const ids = useMemo(() => { const s = new Set<string>(wordIds); for (const g of groups) if (picked.has(g.key)) g.ids.forEach((i) => s.add(i)); return [...s]; }, [groups, picked, wordIds]);

  const toggle = (k: string) => setPicked((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  async function change(what: string, make: (d: PlaybackLogData) => PlaybackLogData | null) {
    if (!ids.length) return;
    setBusy(what); setNote(null);
    const now = Date.now();
    let done = 0;
    for (let i = 0; i < ids.length; i += 4000) {
      const recs: SyncRecord[] = [];
      for (const id of ids.slice(i, i + 4000)) {
        const row = byId.get(id); if (!row) continue;
        const next = make(row.data);
        recs.push(next ? { table: 'playbackLogs', id, updatedAt: now, deviceId, deleted: false, data: next as unknown as Record<string, unknown> } : { table: 'playbackLogs', id, updatedAt: now, deviceId, deleted: true, data: {} });
      }
      await importRecords(recs, 'merge');
      done += recs.length;
      await new Promise((r) => setTimeout(r, 0));
    }
    setBusy(null); setPicked(new Set()); setWords('');
    setNote(`${what}: ${done.toLocaleString()} plays.`);
  }

  return (
    <Modal title="Manage imported Spotify history" onClose={onClose} wide footer={<button className="btn ml-auto" onClick={onClose}>Done</button>}>
      <p className="text-sm text-muted">{total.toLocaleString()} imported plays. Tick the groups that do not belong in your history (ASMR played as albums, an old account…) and hide them: they disappear from Stats, Home and the track pages but are kept, so you can bring them back. Plays hidden are shown struck through.</p>
      <div role="tablist" className="flex flex-wrap gap-1.5">
        {BY.map((x) => <button key={x.id} role="tab" aria-selected={by === x.id} onClick={() => { setBy(x.id); setPicked(new Set()); }} className={cn('rounded-full border px-3 py-0.5 text-sm font-medium', by === x.id ? 'border-accent/60 bg-accent/15 text-accent' : 'border-line text-muted hover:text-fg')}>{x.label}</button>)}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <input className="input" placeholder={`Find in ${BY.find((x) => x.id === by)!.label.toLowerCase()}…`} value={q} onChange={(e) => setQ(e.target.value)} />
        <input className="input" placeholder="Or select by words in artist, album or title: asmr, sleep" value={words} onChange={(e) => setWords(e.target.value)} />
      </div>
      {words.trim() && <p className="text-xs text-muted" role="status">{wordIds.length.toLocaleString()} play{wordIds.length === 1 ? '' : 's'} contain{wordIds.length === 1 ? 's' : ''} those words; they are included in the selection below.</p>}
      <div className="max-h-[22rem] overflow-y-auto rounded-theme border border-line">
        {!shown.length && <p className="p-3 text-sm text-muted">{total ? 'Nothing matches.' : 'No imported Spotify plays yet. Import an export file or turn on the automatic check in Settings > Spotify.'}</p>}
        {shown.slice(0, 400).map((g) => (
          <label key={g.key} className="flex cursor-pointer items-center gap-3 border-b border-line/60 px-3 py-1.5 text-sm last:border-b-0 hover:bg-raised/60">
            <input type="checkbox" checked={picked.has(g.key)} onChange={() => toggle(g.key)} />
            <span className={cn('min-w-0 flex-1 truncate', g.hidden && 'text-muted line-through')}>{g.label}{g.sub && <span className="text-muted"> · {g.sub}</span>}</span>
            <span className="shrink-0 text-xs tabular-nums text-muted">{g.plays.toLocaleString()} plays · {fmtHours(g.ms)}</span>
          </label>))}
        {shown.length > 400 && <p className="p-2 text-center text-xs text-muted">Showing the first 400 of {shown.length.toLocaleString()}: search to narrow it down.</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted">{ids.length.toLocaleString()} selected</span>
        <button className="btn" disabled={!ids.length || !!busy} onClick={() => void change('Hidden', (d) => ({ ...d, hidden: true }))}><EyeOff size={15} />Hide</button>
        <button className="btn" disabled={!ids.length || !!busy} onClick={() => void change('Shown again', (d) => { const { hidden: _h, ...rest } = d; return rest; })}><Eye size={15} />Show again</button>
        <button className="btn text-bad" disabled={!ids.length || !!busy} onClick={() => confirm(`Delete ${ids.length.toLocaleString()} plays for good?`) && void change('Deleted', () => null)}><Trash2 size={15} />Delete</button>
        <span className="ml-auto flex items-center gap-1.5"><input className="input !w-44 !py-1" placeholder="Account name" value={account} onChange={(e) => setAccount(e.target.value)} aria-label="Account name" />
          <button className="btn" disabled={!ids.length || !account.trim() || !!busy} title="File the selected plays under this account name" onClick={() => void change(`Filed under “${account.trim()}”`, (d) => ({ ...d, account: account.trim() }))}><Tag size={15} />Name the account</button></span>
      </div>
      {busy && <p className="text-sm text-muted" role="status">{busy}…</p>}
      {note && <p className="text-sm text-good" role="status">{note}</p>}
    </Modal>
  );
}
