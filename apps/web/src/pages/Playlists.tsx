import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { canPlay } from '../lib/spotifyPlayer.ts';
import { statsPath } from '../lib/entityStats.ts';
import { ArrowLeft, BarChart3, Search, ArrowDown, ArrowUp, Link2, ListEnd, ListStart, Pencil, Play, Plus, Shuffle, X } from 'lucide-react';
import { shuffleWithRules } from '@turbomusic/core';
import { moveTrack, removeTrack } from '../lib/defaults.ts';
import { useLibrary } from '../lib/derive.ts';
import { useEditor } from '../lib/editor.ts';
import { usePlayer } from '../lib/player.ts';
import { useStore } from '../lib/store.ts';
import { Cover } from '../components/Cover.tsx';
import { PlaylistCover } from '../components/PlaylistCover.tsx';
import { ArtistLinks } from '../components/ArtistLinks.tsx';
import { Link, useParams } from 'react-router-dom';
import { useMenu } from '../components/Menu.tsx';
import { usePlaylistMenuItems } from '../components/entityMenus.tsx';
import { isAlbumList, isQuickPlaylist, playlistAlbums, playlistCount, playlistTrackIds, quickPlaylists } from '../lib/playlists.ts';
import { KeepOffline } from '../components/KeepOffline.tsx';
import { cn, plural } from '../lib/cn.ts';
import { PlaylistNote, withoutKey } from '../components/PlaylistNote.tsx';
import { TrackTable } from '../components/TrackTable.tsx';
import { useChunks } from '../lib/useChunks.ts';

export function PlaylistsPage() {
  const lib = useLibrary();
  const patch = useStore((s) => s.patch);
  const edit = useEditor((s) => s.open);
  const play = usePlayer((s) => s.play);
  const openId = useParams().playlistId ?? null;
  const menu = useMenu();
  useEffect(() => setWithin(''), [openId]);
  const menuItems = usePlaylistMenuItems();
  // one switch instead of a Shuffle button next to every Play: it applies to Play, Then: replace and Add to Then
  const [shuffleOn, setShuffleOn] = useState(() => { try { return localStorage.getItem('turbomusic.playlistShuffle') === '1'; } catch { return false; } });
  const toggleShuffle = () => setShuffleOn((v) => { const n = !v; try { localStorage.setItem('turbomusic.playlistShuffle', n ? '1' : '0'); } catch { /* private window */ } return n; });
  const [adding, setAdding] = useState('');
  const [find, setFind] = useState('');
  const replaceRest = usePlayer((s) => s.replaceRest);
  const appendRest = usePlayer((s) => s.appendRest);
  const hasCurrent = usePlayer((s) => !!s.queue.currentId);
  const deferredFind = useDeferredValue(find); // typing stays smooth: the lists below follow a moment later
  // two automatic playlists (thumbs up / thumbs down) come first; they are read-only
  const quick = useMemo(() => quickPlaylists(lib), [lib]);
  const all = useMemo(() => [...quick, ...lib.playlists], [quick, lib.playlists]);
  // playlists match by name, description, or a track or artist inside them
  const listed = useMemo(() => {
    const f = deferredFind.trim().toLowerCase();
    if (!f) return all;
    return all.filter((p) => `${p.name} ${p.description ?? ''}`.toLowerCase().includes(f)
      || playlistTrackIds(lib, p).some((id) => { const t = lib.trackById.get(id); return !!t && `${t.title} ${t.artistName}`.toLowerCase().includes(f); }));
  }, [lib, all, deferredFind]);
  const open = all.find((p) => p.id === openId);
  const readOnly = isQuickPlaylist(open?.id);
  const albumMode = !!open && isAlbumList(open);
  // derived once per playlist, not on every keystroke in the boxes below
  const albums = useMemo(() => (open && albumMode ? playlistAlbums(lib, open) : []), [lib, open, albumMode]);
  const tracks = useMemo(() => (open ? playlistTrackIds(lib, open).map((id) => lib.trackById.get(id)!) : []), [lib, open]);
  const playable = useMemo(() => tracks.filter(canPlay).map((t) => t.id), [tracks]);
  const ordered = () => (shuffleOn ? shuffleWithRules(playable, lib.rules) : playable);
  const offlineHashes = useMemo(() => tracks.flatMap((t) => (t.file ? [t.file] : [])), [tracks]);
  // a filter box inside the open playlist: title, artist and album (reordering is off while it is on: positions would be of the filtered list)
  const [within, setWithin] = useState('');
  const deferredWithin = useDeferredValue(within).trim().toLowerCase();
  const filtering = !!deferredWithin;
  const hit = (text: string) => text.toLowerCase().includes(deferredWithin);
  const shownTracks = useMemo(() => (filtering ? tracks.filter((t) => hit(`${t.title} ${t.artistName} ${t.albumTitle ?? ''}`)) : tracks), [tracks, deferredWithin]); // eslint-disable-line react-hooks/exhaustive-deps
  const shownAlbums = useMemo(() => (filtering ? albums.filter((a) => hit(`${a.title} ${a.leads.map((l) => l.name).join(' ')}`)) : albums), [albums, deferredWithin]); // eslint-disable-line react-hooks/exhaustive-deps
  // long lists are drawn a piece at a time (rows are heavy: rating, menu, note), so opening a big playlist does not freeze the page
  const rows = useChunks(shownTracks.length, 40, `${openId}|${deferredWithin}`);
  const albumRows = useChunks(shownAlbums.length, 30, `${openId}|${deferredWithin}`);
  const cards = useChunks(listed.length, 48, deferredFind);
  const needle = adding.toLowerCase();
  const matches = adding.length > 1 && !albumMode ? lib.tracks.filter((t) => `${t.title} ${t.artistName}`.toLowerCase().includes(needle)).slice(0, 6) : [];
  const albumMatches = adding.length > 1 && albumMode ? lib.albums.filter((a) => !(open!.albumIds ?? []).includes(a.id) && `${a.title} ${a.artistName}`.toLowerCase().includes(needle)).slice(0, 6) : [];
  const ids = open?.albumIds ?? [];

  return (
    <div className="space-y-5">
      {!open && <><div className="flex items-center gap-3"><h1 className="mr-auto text-2xl font-bold">Playlists</h1>
        <button className="btn btn-accent" onClick={() => edit({ kind: 'new-playlist', id: '' })}><Plus size={16} />New playlist</button></div>
      {all.length > 0 && <label className="relative block max-w-md"><Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <input className="input !pl-9" type="search" aria-label="Search playlists" placeholder="Search playlists, or a track or artist in them…" value={find} onChange={(e) => setFind(e.target.value)} /></label>}
      {find.trim() && !listed.length && <p className="text-sm text-muted">No playlist matches.</p>}
      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(var(--grid-min), 9rem), 1fr))' }}>{listed.slice(0, cards.shown).map((p) => { const c = playlistCount(lib, p); return (
        <Link key={p.id} to={`/playlists/${p.id}`} className="bt-tile group block text-left" onContextMenu={menu.onContextMenu(menuItems(p), `Actions for ${p.name}`, p.id)}>
          <PlaylistCover playlist={p} className="transition-transform group-hover:scale-[1.02]" />
          <div className="bt-cap-t mt-2 truncate text-sm font-medium">{p.name}</div>
          <div className="bt-cap text-xs text-muted">{isAlbumList(p) ? 'Albums · ' : ''}{plural(c.n, c.noun)}</div>
        </Link>); })}</div>
      {cards.left > 0 && <div ref={cards.sentinel} className="text-center"><button className="btn" onClick={cards.more}>Show more ({cards.left} left)</button></div>}</>}
      {openId && !open && <div className="space-y-3"><Link to="/playlists" className="btn btn-ghost"><ArrowLeft size={15} />Playlists</Link><p className="text-sm text-muted">This playlist was not found (it may have been deleted, or the library is still loading).</p></div>}
      {open && (
        <section className="space-y-3">
          <Link to="/playlists" className="btn btn-ghost -ml-2"><ArrowLeft size={15} />Playlists</Link>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end" onContextMenu={menu.onContextMenu(menuItems(open), `Actions for ${open.name}`, open.id)}>
            <PlaylistCover playlist={open} className="w-32 shrink-0 sm:w-40" />
            <div className="min-w-0 space-y-2">
              <div className="text-xs uppercase tracking-wider text-muted">{albumMode ? `Album playlist · ${plural(albums.length, 'album')} · ${plural(tracks.length, 'track')}` : `Playlist · ${plural(tracks.length, 'track')}`}</div>
              <h2 className="text-2xl font-bold leading-tight">{open.name}</h2>
              {open.description && <p className="max-w-xl whitespace-pre-wrap text-sm text-muted">{open.description}</p>}
              <div className="flex flex-wrap gap-2 pt-1">
                <button className="btn btn-accent" disabled={!playable.length} onClick={() => { const o = ordered(); play(o[0], o, { type: 'playlist', id: open.id }); }}><Play size={16} fill="currentColor" />Play</button>
                <button className={cn('btn', shuffleOn && 'btn-accent')} aria-pressed={shuffleOn} onClick={toggleShuffle} title={shuffleOn ? 'Shuffle is on: Play, Then and Add to Then mix the playlist' : 'Shuffle is off: they keep the playlist order'}><Shuffle size={16} />Shuffle {shuffleOn ? 'on' : 'off'}</button>
                {hasCurrent && <>
                  <button className="btn" disabled={!playable.length} title="Keep playing the current track, then continue with this playlist instead of what was coming next" onClick={() => replaceRest(ordered(), { type: 'playlist', id: open.id })}><ListStart size={16} />Then: replace</button>
                  <button className="btn btn-ghost" disabled={!playable.length} title="Add this playlist to the end of what is coming next" onClick={() => appendRest(ordered())}><ListEnd size={16} />Add to Then</button>
                </>}
                {!readOnly && <Link className="btn btn-ghost" to={statsPath('playlist', open.id)}><BarChart3 size={15} />Stats</Link>}
                {!readOnly && <button className="btn btn-ghost" onClick={() => edit({ kind: 'playlist', id: open.id })}><Pencil size={15} />Edit</button>}
                <KeepOffline hashes={offlineHashes} />
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-start gap-3">
          <label className="relative block w-full max-w-xs"><Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input className="input !pl-9" type="search" aria-label="Search this playlist" placeholder={albumMode ? 'Search this playlist…' : 'Search this playlist: title, artist, album…'} value={within} onChange={(e) => setWithin(e.target.value)} /></label>
          {!readOnly && <div className="relative w-full max-w-md"><input className="input" placeholder={albumMode ? 'Add an album…' : 'Add a track…'} value={adding} onChange={(e) => setAdding(e.target.value)} />
            {matches.length > 0 && <div className="card absolute z-10 mt-1 w-full overflow-hidden shadow-xl">{matches.map((t) => (
              <button key={t.id} className="block w-full px-3 py-2 text-left text-sm hover:bg-raised" onClick={() => { patch('playlists', open.id, { trackIds: [...open.trackIds, t.id] }); setAdding(''); }}>{t.title} <span className="text-muted">· {t.artistName}</span></button>))}</div>}
            {albumMatches.length > 0 && <div className="card absolute z-10 mt-1 w-full overflow-hidden shadow-xl">{albumMatches.map((a) => (
              <button key={a.id} className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-raised" onClick={() => { patch('playlists', open.id, { albumIds: [...ids, a.id] }); setAdding(''); }}><Cover hash={a.cover} seed={a.title} className="h-8 w-8 shrink-0" /><span className="min-w-0 truncate">{a.title} <span className="text-muted">· {a.artistName}</span></span></button>))}</div>}</div>}
          </div>
          {filtering && <p className="text-xs text-muted">{albumMode ? `${shownAlbums.length} of ${albums.length} albums` : `${shownTracks.length} of ${tracks.length} tracks`} match. Clear the box to reorder.</p>}
          {albumMode
            ? <div className="card divide-y divide-line/50 overflow-hidden">
                {shownAlbums.slice(0, albumRows.shown).map((a, i) => (
                  <div key={a.id} className="flex items-center gap-3 px-3 py-2">
                    <Link to={a.to} className="flex min-w-0 flex-1 items-center gap-3"><Cover hash={a.cover} seed={a.title} className="h-12 w-12 shrink-0" />
                      <span className="min-w-0"><span className="block truncate text-sm font-medium">{a.title}</span><span className="block truncate text-xs text-muted"><ArtistLinks leads={a.leads} /> · {plural(a.trackIds.length, 'track')}</span></span></Link>
                    <button className={cn('p-1 text-muted hover:text-fg disabled:opacity-30', (filtering || readOnly) && 'hidden')} aria-label={`Move ${a.title} up`} disabled={i === 0} onClick={() => patch('playlists', open.id, { albumIds: moveTrack(albums.map((x) => x.id), i, i - 1) })}><ArrowUp size={15} /></button>
                    <button className={cn('p-1 text-muted hover:text-fg disabled:opacity-30', (filtering || readOnly) && 'hidden')} aria-label={`Move ${a.title} down`} disabled={i === albums.length - 1} onClick={() => patch('playlists', open.id, { albumIds: moveTrack(albums.map((x) => x.id), i, i + 1) })}><ArrowDown size={15} /></button>
                    <button className="p-1 text-muted hover:text-bad" aria-label={`Remove ${a.title} from the playlist`} onClick={() => patch('playlists', open.id, { albumIds: removeTrack(ids, a.id) })}><X size={15} /></button>
                  </div>))}
                {!shownAlbums.length && <div className="px-3 py-4 text-sm text-muted">{filtering ? 'No album matches.' : 'No albums yet. Search above, or use “Add to an album playlist…” in an album’s menu.'}</div>}
              </div>
            : <div className="card overflow-hidden"><TrackTable tracks={shownTracks.slice(0, rows.shown)} queue={tracks} source="playlist" sourceId={open.id} numbered={!filtering} covers below={readOnly ? undefined : (t) => <PlaylistNote playlistId={open.id} trackId={t.id} notes={open.trackNotes} />} extra={(t, i) => (
            <div className="flex">
              <button className={cn('p-1 text-muted hover:text-fg disabled:opacity-30', (filtering || readOnly) && 'hidden')} aria-label={`Move ${t.title} up`} disabled={i === 0} onClick={() => patch('playlists', open.id, { trackIds: moveTrack(tracks.map((x) => x.id), i, i - 1) })}><ArrowUp size={15} /></button>
              <button className={cn('p-1 text-muted hover:text-fg disabled:opacity-30', (filtering || readOnly) && 'hidden')} aria-label={`Move ${t.title} down`} disabled={i === tracks.length - 1} onClick={() => patch('playlists', open.id, { trackIds: moveTrack(tracks.map((x) => x.id), i, i + 1) })}><ArrowDown size={15} /></button>
              <button className={cn('p-1 text-muted hover:text-bad', readOnly && 'hidden')} aria-label={`Remove ${t.title} from the playlist`} onClick={() => patch('playlists', open.id, { trackIds: removeTrack(open.trackIds, t.id), trackNotes: withoutKey(open.trackNotes, t.id) })}><X size={15} /></button>
            </div>)} /></div>}
          {!albumMode && rows.left > 0 && <div ref={rows.sentinel} className="text-center"><button className="btn" onClick={rows.more}>Show more ({rows.left} left)</button></div>}
          {albumMode && albumRows.left > 0 && <div ref={albumRows.sentinel} className="text-center"><button className="btn" onClick={albumRows.more}>Show more ({albumRows.left} left)</button></div>}
        </section>
      )}
      {!lib.playlists.length && !open && <div className="flex items-center gap-2 text-sm text-muted"><Link2 size={14} />No playlists of your own yet.</div>}
      {menu.element}
    </div>
  );
}
