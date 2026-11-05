import { useMemo, useState } from 'react';
import { GitMerge } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { leaveRemoved } from '../lib/leave.ts';
import { statsPath } from '../lib/entityStats.ts';
import type { TrackData } from '@turbomusic/core';
import { useLibraryLive } from '../lib/derive.ts';
import { useStore } from '../lib/store.ts';
import { logJournal } from '../lib/journal.ts';
import { planMerge, suggestKeeper } from '../lib/mergeTracks.ts';
import { allSpotifyUrls } from '../lib/spotifyLinks.ts';
import { cn } from '../lib/cn.ts';
import { Modal } from './forms.tsx';

/** Merge tracks that are really one song (the single and the album version): pick the one to keep, see what happens, confirm. */
export function MergeTracksDialog({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const lib = useLibraryLive();
  const nav = useNavigate();
  const tracks = ids.flatMap((id) => lib.trackById.get(id) ?? []);
  const [keepId, setKeepId] = useState(() => (tracks.length ? suggestKeeper(tracks).id : ''));
  const raw = (id: string) => useStore.getState().rows.tracks.get(id)?.data as Partial<TrackData> | undefined;
  const plan = useMemo(() => planMerge(lib, keepId, ids, raw), [lib, keepId, ids]); // eslint-disable-line react-hooks/exhaustive-deps
  if (tracks.length < 2) return null;

  const run = () => {
    if (!plan) return;
    const { patch, remove } = useStore.getState();
    patch('tracks', plan.keepId, plan.keep);
    for (const p of plan.patches) patch(p.table, p.id, p.patch);
    for (const d of plan.deletes) remove(d.table, d.id);
    for (const id of plan.removeIds) { remove('tracks', id); leaveRemoved(nav, 'track', id, { to: statsPath('track', plan.keepId), fallback: '/tracks' }); }
    const keep = lib.trackById.get(plan.keepId)!;
    logJournal('edit', `Merged ${plan.removeIds.length + 1} copies of ${keep.title}`, keep.artistName);
    onClose();
  };
  return (
    <Modal title="Merge duplicate tracks" onClose={onClose} footer={<div className="ml-auto flex gap-2"><button className="btn btn-ghost" onClick={onClose}>Cancel</button>
      <button className="btn btn-accent" disabled={!plan} onClick={run}><GitMerge size={15} />Merge into one</button></div>}>
      <p className="text-sm text-muted">These are the same song. Pick the one to keep: it stays, takes what the others have, and everything that used the others (albums, playlists, eras, votes, plays, notes) uses it instead. The others are deleted.</p>
      <div className="divide-y divide-line/60 rounded-theme border border-line" role="radiogroup" aria-label="Track to keep">
        {tracks.map((t) => (
          <label key={t.id} className={cn('flex cursor-pointer items-start gap-3 px-3 py-2.5 text-sm hover:bg-raised/60', keepId === t.id && 'bg-raised/60')}>
            <input type="radio" name="keep" className="mt-1" checked={keepId === t.id} onChange={() => setKeepId(t.id)} />
            <span className="min-w-0 flex-1"><span className="block truncate font-medium">{t.title}</span>
              <span className="block truncate text-xs text-muted">{t.artistName} · {t.albumTitle ?? 'single'} · {t.comparisons} comparisons{t.file ? ' · has audio' : ''} · {allSpotifyUrls(t).length} Spotify link{allSpotifyUrls(t).length === 1 ? '' : 's'}{(t.memories ?? 0) ? ` · ${t.memories} memories` : ''}</span></span>
            {keepId === t.id && <span className="chip shrink-0">keep</span>}
          </label>))}
      </div>
      {plan && plan.summary.length > 0 && <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted">{plan.summary.map((s) => <li key={s}>{s}</li>)}</ul>}
    </Modal>
  );
}
