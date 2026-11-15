import { ArrowDown, ArrowUp, Shuffle, X } from 'lucide-react';
import { useLibrary } from '../lib/derive.ts';
import { usePlayer } from '../lib/player.ts';
import { Link } from 'react-router-dom';
import { TrackTable } from '../components/TrackTable.tsx';
import { Cover } from '../components/Cover.tsx';
import { sourceLabel } from '../lib/sourceLabel.ts';

export function QueuePage() {
  const lib = useLibrary();
  const source = usePlayer((s) => s.source);
  const labels = usePlayer((st) => st.queueLabels);
  const { queue, dequeue, moveQueued, clearQueued, shuffleQueued, shuffleRest, keepRest, clearRest } = usePlayer();
  const get = (ids: string[]) => ids.map((id) => lib.trackById.get(id)).filter((t) => !!t);
  const current = queue.currentId ? lib.trackById.get(queue.currentId) : null;
  const user = get(queue.user), active = get(queue.active);
  const from = sourceLabel(lib, source);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Queue</h1>
      {current && <section><h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted">Now playing</h2><div className="card overflow-hidden"><TrackTable tracks={[current]} source="track" covers /></div></section>}
      <section>
        <div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-semibold uppercase tracking-wider text-muted">Up next · queued by you</h2>{user.length > 0 && <div className="flex gap-1"><button className="btn btn-ghost" onClick={shuffleQueued}><Shuffle size={14} />Shuffle</button><button className="btn btn-ghost" onClick={clearQueued}>Clear</button></div>}</div>
        {user.length ? <div className="card divide-y divide-line/60">{user.map((t, i) => (
          <div key={`${t.id}-${i}`}>
          {(i === 0 || (labels[user[i - 1].id] ?? '') !== (labels[t.id] ?? '')) && <div className="border-b border-line/60 bg-raised/40 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted">{labels[t.id] ? `From ${labels[t.id]}` : 'Added one by one'}</div>}
          <div className="flex items-center gap-3 px-3 py-2"><Cover hash={t.cover} seed={t.albumTitle ?? t.title} className="w-10 shrink-0" /><div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{t.title}</div><div className="truncate text-xs text-muted">{t.artistName}</div></div>
            <button className="p-1 text-muted hover:text-fg disabled:opacity-30" aria-label="Move up" disabled={i === 0} onClick={() => moveQueued(i, i - 1)}><ArrowUp size={15} /></button>
            <button className="p-1 text-muted hover:text-fg disabled:opacity-30" aria-label="Move down" disabled={i === user.length - 1} onClick={() => moveQueued(i, i + 1)}><ArrowDown size={15} /></button>
            <button className="p-1 text-muted hover:text-fg" aria-label="Remove" onClick={() => dequeue(i)}><X size={15} /></button></div></div>))}</div>
          : <div className="text-sm text-muted">Nothing queued. Use the ⋯ menu on any track (or right-click it). Playback rules ("play B after A") also land here.</div>}
      </section>
      {active.length > 0 && <section><div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-semibold uppercase tracking-wider text-muted">Then, from {from ? (from.to ? <Link to={from.to} className="normal-case text-fg hover:underline">{from.text}</Link> : <span className="normal-case text-fg">{from.text}</span>) : 'the album or list'}</h2>
        <div className="flex gap-1"><button className="btn btn-ghost" onClick={shuffleRest}><Shuffle size={14} />Shuffle</button><button className="btn btn-ghost" onClick={keepRest} title="Move these into your own queue">Add all to my queue</button><button className="btn btn-ghost" onClick={clearRest}>Clear</button></div></div><div className="card overflow-hidden"><TrackTable tracks={active.slice(0, 100)} source="track" covers /></div></section>}
    </div>
  );
}
