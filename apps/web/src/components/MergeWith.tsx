import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GitMerge, Search } from 'lucide-react';
import type { AlbumData, TrackData } from '@turbomusic/core';
import { useLibraryLive, type Library } from '../lib/derive.ts';
import { useStore } from '../lib/store.ts';
import { logJournal } from '../lib/journal.ts';
import { eraPatches } from '../lib/eraOps.ts';
import { leaveRemoved } from '../lib/leave.ts';
import { planMergeAlbums, planMergeArtists, type StoredRows } from '../lib/mergeEntities.ts';
import { cn, plural } from '../lib/cn.ts';
import { Modal } from './forms.tsx';
import { MergeTracksDialog } from './MergeTracksDialog.tsx';

export type MergeKind = 'track' | 'artist' | 'album';

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

interface Candidate { id: string; label: string; hint: string }
function candidates(lib: Library, kind: MergeKind, selfId: string): Candidate[] {
  if (kind === 'track') return lib.tracks.filter((t) => t.id !== selfId).map((t) => ({ id: t.id, label: t.title, hint: `${t.artistName} · ${t.albumTitle ?? 'single'}` }));
  if (kind === 'album') return lib.albums.filter((a) => a.id !== selfId).map((a) => ({ id: a.id, label: a.title, hint: `${a.artistName} · ${plural(a.trackIds.length, 'track')}` }));
  return lib.artists.filter((a) => a.id !== selfId).map((a) => ({ id: a.id, label: a.name, hint: (a.aliases ?? []).length ? `also ${(a.aliases ?? []).slice(0, 2).join(', ')}` : '' }));
}

/**
 * "Merge with…" for the duplicates the automatic check misses: pick the other copies (search by name), then the existing review step
 * for that kind shows what will happen before anything changes.
 */
export function MergeWithDialog({ kind, id, onClose }: { kind: MergeKind; id: string; onClose: () => void }) {
  const lib = useLibraryLive();
  const [picked, setPicked] = useState<string[]>([]);
  const [find, setFind] = useState('');
  const [confirm, setConfirm] = useState(false);
  const self = kind === 'track' ? lib.trackById.get(id)?.title : kind === 'album' ? lib.albumById.get(id)?.title : lib.artistById.get(id)?.name;
  const all = useMemo(() => candidates(lib, kind, id), [lib, kind, id]);
  const shown = useMemo(() => {
    const q = norm(find), me = norm(self ?? '');
    const scored = all.map((c) => {
      const n = norm(c.label);
      // typing narrows by name (or the hint: artist, album); with nothing typed, the likeliest copies of this one come first
      if (q) return { c, s: n === q ? 0 : n.startsWith(q) ? 1 : n.includes(q) ? 2 : norm(c.hint).includes(q) ? 3 : 9 };
      return { c, s: n === me ? 0 : me && (n.includes(me) || me.includes(n)) ? 1 : n.split(' ')[0] === me.split(' ')[0] ? 2 : 9 };
    });
    const list = q ? scored.filter((x) => x.s < 9) : scored;
    return list.sort((a, b) => a.s - b.s || a.c.label.localeCompare(b.c.label)).slice(0, 60).map((x) => x.c);
  }, [all, find, self]);
  const chosen = picked.flatMap((p) => all.find((c) => c.id === p) ?? []);

  if (confirm) {
    const ids = [id, ...picked];
    if (kind === 'track') return <MergeTracksDialog ids={ids} onClose={onClose} />;
    return <MergeEntitiesDialog kind={kind} ids={ids} onBack={() => setConfirm(false)} onClose={onClose} />;
  }
  return (
    <Modal title={`Merge “${self ?? ''}” with…`} onClose={onClose} footer={<div className="ml-auto flex gap-2"><button className="btn btn-ghost" onClick={onClose}>Cancel</button>
      <button className="btn btn-accent" disabled={!picked.length} onClick={() => setConfirm(true)}><GitMerge size={15} />Review the merge{picked.length ? ` (${picked.length + 1})` : ''}</button></div>}>
      <p className="text-sm text-muted">Pick the other {kind === 'artist' ? 'artist' : kind} entries that are really the same thing. Next you choose which one to keep and see exactly what changes before anything is done.</p>
      <label className="relative block"><Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <input className="input !pl-9" autoFocus type="search" aria-label="Search" placeholder={kind === 'track' ? 'Search by title, artist or album…' : kind === 'album' ? 'Search by title or artist…' : 'Search by name…'} value={find} onChange={(e) => setFind(e.target.value)} /></label>
      {chosen.length > 0 && <div className="flex flex-wrap gap-1.5">{chosen.map((c) => <button key={c.id} className="chip" title="Remove from the merge" onClick={() => setPicked(picked.filter((x) => x !== c.id))}>{c.label} ✕</button>)}</div>}
      <div className="max-h-72 divide-y divide-line/60 overflow-y-auto rounded-theme border border-line">
        {shown.map((c) => (
          <label key={c.id} className={cn('flex cursor-pointer items-start gap-3 px-3 py-2 text-sm hover:bg-raised/60', picked.includes(c.id) && 'bg-raised/60')}>
            <input type="checkbox" className="mt-1" checked={picked.includes(c.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, c.id] : picked.filter((x) => x !== c.id))} />
            <span className="min-w-0 flex-1"><span className="block truncate font-medium">{c.label}</span>{c.hint && <span className="block truncate text-xs text-muted">{c.hint}</span>}</span>
          </label>))}
        {!shown.length && <div className="p-3 text-sm text-muted">{find ? 'Nothing matches.' : 'Nothing else to merge with.'}</div>}
      </div>
      {!find && all.length > shown.length && <p className="text-xs text-muted">Showing the likeliest. Type to search all {all.length}.</p>}
    </Modal>
  );
}

/** Choose which artist/album survives, read what will change, confirm. */
function MergeEntitiesDialog({ kind, ids, onBack, onClose }: { kind: 'artist' | 'album'; ids: string[]; onBack: () => void; onClose: () => void }) {
  const lib = useLibraryLive();
  const nav = useNavigate();
  const [keepId, setKeepId] = useState(ids[0]);
  const stored = (): StoredRows => {
    const rows = useStore.getState().rows;
    const live = <T,>(m: Map<string, { id: string; deleted: boolean; data: unknown }>) => [...m.values()].filter((r) => !r.deleted).map((r) => ({ id: r.id, data: r.data as T }));
    return { tracks: live<TrackData>(rows.tracks as never), albums: live<AlbumData>(rows.albums as never) };
  };
  const artistPlan = useMemo(() => (kind === 'artist' ? planMergeArtists(lib, keepId, ids, stored()) : null), [lib, keepId, ids, kind]); // eslint-disable-line react-hooks/exhaustive-deps
  const albumPlan = useMemo(() => (kind === 'album' ? planMergeAlbums(lib, keepId, ids, stored()) : null), [lib, keepId, ids, kind]); // eslint-disable-line react-hooks/exhaustive-deps
  const plan = artistPlan ?? albumPlan;
  const items = ids.flatMap((i) => (kind === 'artist' ? lib.artistById.get(i) : lib.albumById.get(i)) ?? []);
  if (items.length < 2) return null;

  const run = () => {
    const { patch, remove } = useStore.getState();
    if (artistPlan) {
      patch('artists', artistPlan.keepId, artistPlan.keepPatch);
      for (const p of artistPlan.patches) patch(p.table, p.id, p.patch);
      for (const r of artistPlan.removeIds) { remove('artists', r); leaveRemoved(nav, 'artist', r, { to: `/artists/${artistPlan.keepId}`, fallback: '/artists' }); }
      const keep = lib.artistById.get(artistPlan.keepId)!;
      logJournal('edit', `Merged ${artistPlan.removeIds.length + 1} entries of ${keep.name}`, '', keep.id);
    } else if (albumPlan) {
      const p = albumPlan;
      patch('albums', p.keepId, p.keepPatch);
      for (const r of p.releasePatches) patch('releases', r.id, r.patch);
      for (const t of p.trackPatches) patch('tracks', t.id, t.patch);
      for (const l of p.playlistPatches) patch('playlists', l.id, { albumIds: l.albumIds });
      for (const g of p.noteMembers) patch('groups', g.id, { members: g.members });
      for (const r of p.removeIds) for (const e of eraPatches(lib, 'album', r, [])) patch('eras', e.id, e.patch);
      for (const e of eraPatches(lib, 'album', p.keepId, p.eraIds)) patch('eras', e.id, e.patch);
      for (const r of p.removeIds) { remove('albums', r); leaveRemoved(nav, 'album', r, { to: `/albums/${p.keepId}`, fallback: '/albums' }); }
      const keep = lib.albumById.get(p.keepId)!;
      logJournal('edit', `Merged ${p.removeIds.length + 1} copies of ${keep.title}`, '', keep.id);
    }
    onClose();
  };
  return (
    <Modal title={`Merge ${kind === 'artist' ? 'artists' : 'albums'}`} onClose={onClose} footer={<div className="ml-auto flex gap-2"><button className="btn btn-ghost" onClick={onBack}>Back</button>
      <button className="btn btn-accent" disabled={!plan} onClick={run}><GitMerge size={15} />Merge into one</button></div>}>
      <p className="text-sm text-muted">These are the same {kind}. Pick the one to keep: it stays, takes what the others have, and everything that used the others uses it instead. The others are deleted.</p>
      <div className="divide-y divide-line/60 rounded-theme border border-line" role="radiogroup" aria-label={`${kind} to keep`}>
        {items.map((it) => {
          const name = 'name' in it ? it.name : it.title;
          const info = 'trackIds' in it ? `${(it as { artistName: string }).artistName} · ${plural(it.trackIds.length, 'track')} · ${plural(lib.releases.filter((r) => r.albumId === it.id).length, 'release')}`
            : `${plural(lib.tracks.filter((t) => t.credits.some((c) => c.artistId === it.id)).length, 'track')}${it.image ? ' · has a picture' : ''}`;
          return (
            <label key={it.id} className={cn('flex cursor-pointer items-start gap-3 px-3 py-2.5 text-sm hover:bg-raised/60', keepId === it.id && 'bg-raised/60')}>
              <input type="radio" name="keep" className="mt-1" checked={keepId === it.id} onChange={() => setKeepId(it.id)} />
              <span className="min-w-0 flex-1"><span className="block truncate font-medium">{name}</span><span className="block truncate text-xs text-muted">{info}</span></span>
              {keepId === it.id && <span className="chip shrink-0">keep</span>}
            </label>);
        })}
      </div>
      {plan && <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted">{plan.summary.map((s) => <li key={s}>{s}</li>)}</ul>}
    </Modal>
  );
}
