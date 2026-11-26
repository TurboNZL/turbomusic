import { useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import type { TrackData } from '@turbomusic/core';
import { appendTrack, removeTrack } from '../lib/defaults.ts';
import type { Library } from '../lib/derive.ts';
import { useEditor } from '../lib/editor.ts';
import { useStore } from '../lib/store.ts';
import { TrackPicker } from './forms.tsx';
import { Sortable } from './Sortable.tsx';

type Album = Library['albums'][number];

/** Reorder, remove, and add tracks of one album. Order is saved on the album (`trackOrder`). */
export function TracklistEditor({ album, lib }: { album: Album; lib: Library }) {
  const patch = useStore((s) => s.patch);
  const removeRecord = useStore((s) => s.remove);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const edit = useEditor((s) => s.open);
  const rawAlbums = (trackId: string) => (useStore.getState().rows.tracks.get(trackId)?.data as TrackData | undefined)?.albums ?? [];
  const setOrder = (order: string[]) => patch('albums', album.id, { trackOrder: order });

  const chosen = album.trackIds.filter((id) => picked.has(id));
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  /** take the chosen tracks out of this album (they stay in the library) */
  const takeOut = () => {
    if (!chosen.length || !confirm(`Take ${chosen.length} track${chosen.length === 1 ? '' : 's'} out of “${album.title}”? They stay in your library (as singles, unless another album has them).`)) return;
    for (const id of chosen) patch('tracks', id, { albums: rawAlbums(id).filter((l) => l.albumId !== album.id) });
    setOrder(album.trackIds.filter((id) => !picked.has(id)));
    setPicked(new Set());
  };
  /** delete the chosen tracks for good: their records, audio links, votes' history stay in the log but the songs are gone */
  const deleteForGood = () => {
    if (!chosen.length) return;
    const names = chosen.slice(0, 5).map((id) => lib.trackById.get(id)?.title ?? '').join(', ') + (chosen.length > 5 ? `, and ${chosen.length - 5} more` : '');
    if (!confirm(`Delete ${chosen.length} track${chosen.length === 1 ? '' : 's'} from your library?\n\n${names}\n\nThey disappear from every album, release and playlist. The audio files stay on the server until you clean them up. This cannot be undone.`)) return;
    setOrder(album.trackIds.filter((id) => !picked.has(id)));
    for (const id of chosen) removeRecord('tracks', id);
    setPicked(new Set());
  };
  const remove = (id: string) => {
    patch('tracks', id, { albums: rawAlbums(id).filter((l) => l.albumId !== album.id) });
    setOrder(removeTrack(album.trackIds, id));
  };
  const addExisting = (id: string | null) => {
    if (!id) return;
    // the link added here goes first: a track's album, cover and genres come from its first link, and the user just put it here
    patch('tracks', id, { albums: [{ albumId: album.id, order: album.trackIds.length }, ...rawAlbums(id).filter((l) => l.albumId !== album.id)] });
    setOrder(appendTrack(album.trackIds, id));
  };

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={chosen.length > 0 && chosen.length === album.trackIds.length} ref={(el) => { if (el) el.indeterminate = chosen.length > 0 && chosen.length < album.trackIds.length; }} onChange={(e) => setPicked(e.target.checked ? new Set(album.trackIds) : new Set())} />{chosen.length ? `${chosen.length} selected` : 'Select tracks'}</label>
        {chosen.length > 0 && <div className="ml-auto flex flex-wrap gap-2">
          <button className="btn !py-1 text-xs" onClick={takeOut}><X size={13} />Take out of the album</button>
          <button className="btn !py-1 text-xs text-bad" onClick={deleteForGood}><Trash2 size={13} />Delete {chosen.length}…</button></div>}
      </div>
      <Sortable items={album.trackIds} keyOf={(id) => id} onReorder={setOrder} className="divide-y divide-line/60" rowClass="bg-surface"
        render={(id, { handle, index: i }) => {
          const t = lib.trackById.get(id)!;
          return (
            <div className="flex items-center gap-2 px-3 py-2">
              {handle}
              <input type="checkbox" aria-label={`Select ${t.title}`} checked={picked.has(id)} onChange={() => toggle(id)} />
              <span className="w-6 text-center text-sm text-muted">{i + 1}</span>
              <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{t.title}</div><div className="truncate text-xs text-muted">{t.artistName}</div></div>
              <button className="btn btn-ghost !p-1.5 text-bad" aria-label={`Remove ${t.title} from this album`} onClick={() => remove(id)}><X size={15} /></button>
            </div>
          );
        }} />
      <div className="flex flex-wrap items-center gap-3 border-t border-line p-3">
        <div className="w-64 max-w-full"><TrackPicker value={null} onChange={addExisting} /></div>
        <span className="text-xs text-muted">adds an existing track</span>
        <button className="btn ml-auto" onClick={() => edit({ kind: 'new-track', id: album.id })}><Plus size={15} />New track</button>
      </div>
    </div>
  );
}
