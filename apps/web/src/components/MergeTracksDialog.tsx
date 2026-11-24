import { useMemo, useState } from 'react';
import { GitMerge } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { leaveRemoved } from '../lib/leave.ts';
import { statsPath } from '../lib/entityStats.ts';
import type { TrackData } from '@turbomusic/core';
import { useLibraryLive } from '../lib/derive.ts';
import { useStore } from '../lib/store.ts';
import { logJournal } from '../lib/journal.ts';
import { planMerge, planShareVersions, suggestKeeper } from '../lib/mergeTracks.ts';
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
  // 'one': the tracks become one; 'both': they stay (own title and album) but share the audio, votes and rating
  const [mode, setMode] = useState<'one' | 'both'>('one');
  const [keepSingle, setKeepSingle] = useState(true);
  const single = useMemo(() => planMerge(lib, keepId, ids, raw, { keepSingle: true })?.newReleases.length ?? 0, [lib, keepId, ids]); // eslint-disable-line react-hooks/exhaustive-deps
  const plan = useMemo(() => planMerge(lib, keepId, ids, raw, { keepSingle: keepSingle && single > 0 }), [lib, keepId, ids, keepSingle, single]); // eslint-disable-line react-hooks/exhaustive-deps
  const share = useMemo(() => planShareVersions(lib, keepId, ids), [lib, keepId, ids]);
  if (tracks.length < 2) return null;

  const runShare = () => {
    if (!share) return;
    const { patch } = useStore.getState();
    for (const p of share.patches) patch('tracks', p.id, p.patch);
    const keep = lib.trackById.get(share.keepId)!;
    logJournal('edit', `Linked ${share.patches.length + 1} recordings of ${keep.title}`, keep.artistName);
    onClose();
  };
  const run = () => {
    if (mode === 'both') { runShare(); return; }
    if (!plan) return;
    const { patch, remove, put } = useStore.getState();
    patch('tracks', plan.keepId, plan.keep);
    for (const p of plan.patches) patch(p.table, p.id, p.patch);
    for (const d of plan.deletes) remove(d.table, d.id);
    for (const r of plan.newReleases) put('releases', r);
    for (const id of plan.removeIds) { remove('tracks', id); leaveRemoved(nav, 'track', id, { to: statsPath('track', plan.keepId), fallback: '/tracks' }); }
    const keep = lib.trackById.get(plan.keepId)!;
    logJournal('edit', `Merged ${plan.removeIds.length + 1} copies of ${keep.title}`, keep.artistName);
    onClose();
  };
  return (
    <Modal title="Merge duplicate tracks" onClose={onClose} footer={<div className="ml-auto flex gap-2"><button className="btn btn-ghost" onClick={onClose}>Cancel</button>
      <button className="btn btn-accent" disabled={mode === 'one' ? !plan : !share} onClick={run}><GitMerge size={15} />{mode === 'one' ? 'Merge into one' : 'Link them'}</button></div>}>
      <div className="space-y-1.5" role="radiogroup" aria-label="How to merge">
        <label className="flex cursor-pointer items-start gap-2 text-sm"><input type="radio" name="mode" className="mt-1" checked={mode === 'one'} onChange={() => setMode('one')} /><span><span className="font-medium">Merge into one track</span><span className="block text-xs text-muted">The same song entered twice. One track survives and takes everything the others had; the others are deleted.</span></span></label>
        <label className="flex cursor-pointer items-start gap-2 text-sm"><input type="radio" name="mode" className="mt-1" checked={mode === 'both'} onChange={() => setMode('both')} /><span><span className="font-medium">Keep each track, share the audio and ratings</span><span className="block text-xs text-muted">For a song that has a different title or sits on a different album each time (for example a song on a mixtape and on its album). Every track keeps its own title, album and page; they play the same audio file and share votes and rating.</span></span></label>
      </div>
      {mode === 'one' && single > 0 && <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={keepSingle} onChange={(e) => setKeepSingle(e.target.checked)} /><span><span className="font-medium">Keep the single as a release</span><span className="block text-xs text-muted">Adds a release marked single to the album with the single’s cover and date, so the single stays on the Singles page and keeps its own stats page.</span></span></label>}
      <p className="text-sm text-muted">{mode === 'one' ? 'Pick the one to keep: it stays, takes what the others have, and everything that used the others (albums, playlists, eras, votes, plays, notes) uses it instead.' : 'Pick the main one: the others become other recordings of it.'}</p>
      <div className="divide-y divide-line/60 rounded-theme border border-line" role="radiogroup" aria-label="Track to keep">
        {tracks.map((t) => (
          <label key={t.id} className={cn('flex cursor-pointer items-start gap-3 px-3 py-2.5 text-sm hover:bg-raised/60', keepId === t.id && 'bg-raised/60')}>
            <input type="radio" name="keep" className="mt-1" checked={keepId === t.id} onChange={() => setKeepId(t.id)} />
            <span className="min-w-0 flex-1"><span className="block truncate font-medium">{t.title}</span>
              <span className="block truncate text-xs text-muted">{t.artistName} · {t.albumTitle ?? 'single'} · {t.comparisons} comparisons{t.file ? ' · has audio' : ''} · {allSpotifyUrls(t).length} Spotify link{allSpotifyUrls(t).length === 1 ? '' : 's'}{(t.memories ?? 0) ? ` · ${t.memories} memories` : ''}</span></span>
            {keepId === t.id && <span className="chip shrink-0">keep</span>}
          </label>))}
      </div>
      {(mode === 'one' ? plan : share) && <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted">{(mode === 'one' ? plan!.summary : share!.summary).map((s) => <li key={s}>{s}</li>)}</ul>}
    </Modal>
  );
}
