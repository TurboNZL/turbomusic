import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import type { TrackData } from '@turbomusic/core';
import { useLibraryLive } from '../lib/derive.ts';
import { useStore } from '../lib/store.ts';
import { leaveRemoved } from '../lib/leave.ts';
import { eraPatches } from '../lib/eraOps.ts';
import { logJournal } from '../lib/journal.ts';
import { buildListens } from '../lib/listens.ts';
import { LOOSE_KINDS, looseSingles, planDeleteAlbum, type LooseKind } from '../lib/deleteOps.ts';
import { cn, plural } from '../lib/cn.ts';
import { Modal } from './forms.tsx';
import { Cover } from './Cover.tsx';

const rawLinks = (id: string) => (useStore.getState().rows.tracks.get(id)?.data as TrackData | undefined)?.albums;

/** Delete an album for good: its releases, its page, and (by choice) the songs that are on no other album, with their pages. */
export function DeleteAlbumDialog({ albumId, onClose }: { albumId: string; onClose: () => void }) {
  const lib = useLibraryLive();
  const nav = useNavigate();
  const [withSongs, setWithSongs] = useState(true);
  const album = lib.albumById.get(albumId);
  const plan = useMemo(() => planDeleteAlbum(lib, albumId, rawLinks, withSongs), [lib, albumId, withSongs]);
  if (!album || !plan) return null;
  const run = () => {
    const { patch, remove } = useStore.getState();
    for (const u of plan.unlink) patch('tracks', u.id, { albums: u.albums });
    for (const id of plan.deleteTrackIds) remove('tracks', id);
    for (const r of plan.releaseIds) remove('releases', r);
    for (const p of plan.playlistPatches) patch('playlists', p.id, { albumIds: p.albumIds });
    for (const e of eraPatches(lib, 'album', albumId, [])) patch('eras', e.id, e.patch);
    remove('albums', albumId);
    logJournal('edit', `Deleted the album ${album.title}${plan.deleteTrackIds.length ? ` and ${plural(plan.deleteTrackIds.length, 'song')}` : ''}`, '');
    onClose();
    leaveRemoved(nav, 'album', albumId, { fallback: '/albums' });
  };
  const kept = plan.unlink.length;
  return (
    <Modal title={`Delete “${album.title}”`} onClose={onClose} footer={<div className="ml-auto flex gap-2"><button className="btn btn-ghost" onClick={onClose}>Cancel</button>
      <button className="btn btn-accent !bg-bad" onClick={run}><Trash2 size={15} />Delete album</button></div>}>
      <div className="space-y-2" role="radiogroup" aria-label="What to delete">
        <label className="flex cursor-pointer items-start gap-2 text-sm"><input type="radio" name="del" className="mt-1" checked={withSongs} onChange={() => setWithSongs(true)} />
          <span><span className="font-medium">The album and its songs</span><span className="block text-xs text-muted">Every song that is on no other album is deleted, with its page. This is what “unimport” means for an album from a Spotify import. Their votes stay in the history.</span></span></label>
        <label className="flex cursor-pointer items-start gap-2 text-sm"><input type="radio" name="del" className="mt-1" checked={!withSongs} onChange={() => setWithSongs(false)} />
          <span><span className="font-medium">Only the album</span><span className="block text-xs text-muted">The songs stay in your library as singles (or on their other albums).</span></span></label>
      </div>
      <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted">
        <li>the album and {plural(plan.releaseIds.length, 'release')} (singles included) are deleted for good</li>
        {plan.deleteTrackIds.length > 0 && <li>{plural(plan.deleteTrackIds.length, 'song')} deleted</li>}
        {kept > 0 && <li>{plural(kept, 'song')} stay{kept === 1 ? 's' : ''}{withSongs ? ' (also on another album)' : ' as singles or on other albums'}</li>}
        {plan.playlistPatches.length > 0 && <li>it is taken out of {plural(plan.playlistPatches.length, 'album playlist')}</li>}
        <li>audio files stay on the server until you clean them up; this cannot be undone</li>
      </ul>
    </Modal>
  );
}

/** Delete songs for good (the multi-select bar, and the loose-singles cleaner use the same step). */
export function DeleteTracksDialog({ ids, onClose, onDone }: { ids: string[]; onClose: () => void; onDone?: () => void }) {
  const lib = useLibraryLive();
  const nav = useNavigate();
  const tracks = ids.flatMap((id) => lib.trackById.get(id) ?? []);
  if (!tracks.length) return null;
  const run = () => {
    const { remove } = useStore.getState();
    for (const t of tracks) { remove('tracks', t.id); leaveRemoved(nav, 'track', t.id, { fallback: '/tracks' }); }
    logJournal('edit', `Deleted ${plural(tracks.length, 'song')}`, '');
    onDone?.(); onClose();
  };
  return (
    <Modal title={`Delete ${plural(tracks.length, 'song')}?`} onClose={onClose} footer={<div className="ml-auto flex gap-2"><button className="btn btn-ghost" onClick={onClose}>Cancel</button>
      <button className="btn btn-accent !bg-bad" onClick={run}><Trash2 size={15} />Delete {tracks.length}</button></div>}>
      <p className="text-sm text-muted">They disappear from every album, release and playlist, and their pages go. Votes and plays stay in the history. The audio files stay on the server until you clean them up. This cannot be undone.</p>
      <ul className="max-h-48 list-disc overflow-y-auto pl-5 text-sm">{tracks.slice(0, 40).map((t) => <li key={t.id}>{t.title} <span className="text-muted">· {t.artistName}</span></li>)}{tracks.length > 40 && <li className="list-none text-muted">…and {tracks.length - 40} more</li>}</ul>
    </Modal>
  );
}

/** Settings: tidy up the singles left behind (for example from an album that was removed), a group at a time. */
export function LooseSinglesDialog({ onClose }: { onClose: () => void }) {
  const lib = useLibraryLive();
  const [kind, setKind] = useState<LooseKind>('unimported');
  const played = useMemo(() => new Set(buildListens(lib).map((l) => l.trackId).filter(Boolean) as string[]), [lib]);
  const list = useMemo(() => looseSingles(lib, kind, played), [lib, kind, played]);
  const [off, setOff] = useState<Set<string>>(new Set()); // ticked out of the deletion
  const chosen = list.filter((t) => !off.has(t.id));
  const [confirm, setConfirm] = useState(false);
  if (confirm) return <DeleteTracksDialog ids={chosen.map((t) => t.id)} onClose={() => setConfirm(false)} onDone={onClose} />;
  return (
    <Modal title="Clean up loose singles" onClose={onClose} footer={<div className="ml-auto flex gap-2"><button className="btn btn-ghost" onClick={onClose}>Close</button>
      <button className="btn btn-accent !bg-bad" disabled={!chosen.length} onClick={() => setConfirm(true)}><Trash2 size={15} />Delete {chosen.length || ''} selected</button></div>}>
      <p className="text-sm text-muted">Singles are songs that are on no album. Pick which ones to look at, untick any you want to keep, then delete the rest together.</p>
      <div className="space-y-1.5" role="radiogroup" aria-label="Which singles">
        {LOOSE_KINDS.map((k) => <label key={k.id} className="flex cursor-pointer items-start gap-2 text-sm"><input type="radio" name="kind" className="mt-1" checked={kind === k.id} onChange={() => { setKind(k.id); setOff(new Set()); }} /><span><span className="font-medium">{k.label}</span><span className="block text-xs text-muted">{k.hint}</span></span></label>)}
      </div>
      <div className="flex items-center gap-2 text-xs text-muted"><span>{plural(list.length, 'single')} found</span>
        {list.length > 0 && <><button className="underline" onClick={() => setOff(new Set())}>Select all</button><button className="underline" onClick={() => setOff(new Set(list.map((t) => t.id)))}>Select none</button></>}</div>
      <div className="max-h-72 divide-y divide-line/60 overflow-y-auto rounded-theme border border-line">
        {list.slice(0, 300).map((t) => (
          <label key={t.id} className={cn('flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-raised/60', off.has(t.id) && 'opacity-50')}>
            <input type="checkbox" checked={!off.has(t.id)} onChange={(e) => setOff((o) => { const n = new Set(o); if (e.target.checked) n.delete(t.id); else n.add(t.id); return n; })} />
            <Cover hash={t.cover} seed={t.title} className="h-8 w-8 shrink-0" />
            <span className="min-w-0 flex-1"><span className="block truncate font-medium">{t.title}</span><span className="block truncate text-xs text-muted">{t.artistName}{t.file ? ' · has audio' : ''}</span></span>
          </label>))}
        {!list.length && <div className="p-3 text-sm text-muted">None of those. Nothing to clean up.</div>}
        {list.length > 300 && <div className="p-2 text-center text-xs text-muted">Showing 300 of {list.length}; the rest are deleted too when ticked.</div>}
      </div>
    </Modal>
  );
}
