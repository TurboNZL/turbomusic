import { useMemo, useState } from 'react';
import { Check, Plus, Search } from 'lucide-react';
import { useLibrary } from '../lib/derive.ts';
import { useStore } from '../lib/store.ts';
import { PLAYLIST_SORTS, readPlaylistSort, sortPlaylists } from '../lib/playlistSort.ts';
import { playlistCount } from '../lib/playlists.ts';
import type { PlaylistData } from '@turbomusic/core';

/**
 * The "Add to playlist" flyout of a track menu: search box, your playlists in the order the Playlists page uses, a tick for the ones
 * the song is already on (pressing toggles it, the menu stays open), and a row that makes a new playlist from what you typed.
 */
export function PlaylistFlyout({ trackId }: { trackId: string }) {
  const lib = useLibrary();
  const { put, patch } = useStore();
  const [q, setQ] = useState('');
  const { sort, dir } = useMemo(readPlaylistSort, []);
  const lists = useMemo(() => sortPlaylists(lib.playlists.filter((p) => p.kind !== 'albums'), sort, dir, (p) => playlistCount(lib, p).n), [lib, sort, dir]);
  const f = q.trim().toLowerCase();
  const shown = f ? lists.filter((p) => p.name.toLowerCase().includes(f)) : lists;
  const toggle = (id: string, ids: string[]) => patch('playlists', id, { trackIds: ids.includes(trackId) ? ids.filter((x) => x !== trackId) : [...ids, trackId] });
  const create = () => { if (!q.trim()) return; put('playlists', { name: q.trim(), description: null, cover: null, createdAt: Date.now(), trackIds: [trackId] } satisfies PlaylistData); setQ(''); };
  return (
    <div className="flex max-h-[min(22rem,70dvh)] flex-col">
      <label className="relative m-1.5 block"><Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
        <input autoFocus className="input w-full !py-1.5 !pl-8 text-sm" placeholder="Search playlists" aria-label="Search playlists" value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key !== 'Escape') e.stopPropagation(); if (e.key === 'Enter' && !shown.length) create(); }} /></label>
      <div className="min-h-0 flex-1 overflow-y-auto" role="group" aria-label={`Playlists, ${PLAYLIST_SORTS.find((o) => o.value === sort)?.label ?? ''}`}>
        {shown.map((p) => { const on = p.trackIds.includes(trackId); return (
          <button key={p.id} type="button" role="menuitemcheckbox" aria-checked={on} className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm" onClick={() => toggle(p.id, p.trackIds)}>
            <span className="flex h-4 w-4 shrink-0 items-center justify-center text-accent">{on && <Check size={14} />}</span><span className="min-w-0 flex-1 truncate">{p.name}</span><span className="text-xs text-muted">{p.trackIds.length}</span></button>); })}
        {!shown.length && <div className="px-3 py-2 text-sm text-muted">{lists.length ? 'No playlist by that name.' : 'No playlists yet.'}</div>}
      </div>
      {q.trim() && !lists.some((p) => p.name.toLowerCase() === f) && <button type="button" role="menuitem" className="flex w-full items-center gap-3 border-t border-line/60 px-3 py-2 text-left text-sm" onClick={create}><Plus size={15} /><span className="min-w-0 flex-1 truncate">New playlist “{q.trim()}”</span></button>}
    </div>
  );
}
