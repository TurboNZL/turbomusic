import { useMemo, useState } from 'react';
import { canPlay } from '../lib/spotifyPlayer.ts';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Layers, ListOrdered, ListPlus, MoreHorizontal, Loader2, Pencil, Play, Plus, Shuffle } from 'lucide-react';
import { shuffleWithRules } from '@turbomusic/core';
import { useLibrary } from '../lib/derive.ts';
import { useEditor } from '../lib/editor.ts';
import { usePlayer } from '../lib/player.ts';
import { initialView, viewTrackIds, type AlbumView } from '../lib/albumOps.ts';
import { plural } from '../lib/cn.ts';
import { Cover } from '../components/Cover.tsx';
import { Notes } from '../components/Notes.tsx';
import { KeepOffline } from '../components/KeepOffline.tsx';
import { TracklistEditor } from '../components/TracklistEditor.tsx';
import { TrackTable } from '../components/TrackTable.tsx';
import { DetailLayout } from '../components/DetailLayout.tsx';
import { ArtistLinks } from '../components/ArtistLinks.tsx';
import { useMenu, type MenuItem } from '../components/Menu.tsx';
import { useImportSearching } from '../lib/openImport.ts';
import { useAlbumMenuItems } from '../components/entityMenus.tsx';

export function AlbumPage() {
  const { id } = useParams();
  const lib = useLibrary();
  const play = usePlayer((s) => s.play);
  const edit = useEditor((s) => s.open);
  const menu = useMenu();
  const itemsFor = useAlbumMenuItems();
  const searchingImport = useImportSearching((st) => !!id && st.ids.has(id)); // a hook: it stays above the early return for a missing album
  const [params, setParams] = useSearchParams();
  const [arranging, setArranging] = useState(false);
  const album = id ? lib.albumById.get(id) : undefined;
  const releases = useMemo(() => (album ? lib.releases.filter((r) => r.albumId === album.id).sort((a, b) => (a.releaseDate ?? '9').localeCompare(b.releaseDate ?? '9') || a.title.localeCompare(b.title)) : []), [lib, album]);
  if (!album) return <div className="text-muted">Album not found.</div>;

  // which tracks to show: the release picked in the side panel (kept in the link, ?release=), else the default release or all tracks
  const asked = params.get('release');
  const view: AlbumView = asked === 'all' ? { kind: 'all' } : asked && releases.some((r) => r.id === asked) ? { kind: 'release', id: asked } : initialView(lib, album);
  const release = view.kind === 'release' ? releases.find((r) => r.id === view.id) : undefined;
  const choose = (v: AlbumView) => { setArranging(false); setParams(v.kind === 'all' ? { release: 'all' } : { release: v.id }, { replace: true }); };

  const ids = viewTrackIds(lib, album, view);
  const tracks = ids.map((t) => lib.trackById.get(t)!);
  const playable = tracks.filter(canPlay).map((t) => t.id);
  const cover = release?.cover || album.cover;
  // the header keeps only what you do while listening; everything that edits or imports is in this menu (the ⋯ button and a right-click)
  const fullMenu: MenuItem[] = [
    ...itemsFor(album, ids), { separator: true },
    view.kind === 'all' ? { label: arranging ? 'Done editing tracks' : 'Edit tracks (order, add, remove)', icon: <ListOrdered size={15} />, run: () => setArranging(!arranging) }
      : { label: 'Edit this release…', icon: <ListOrdered size={15} />, run: () => edit({ kind: 'release', id: view.id }) },
  ];

  return (
    <DetailLayout
      left={<section className="space-y-2" aria-label="Releases">
        <div className="flex items-center gap-2"><h2 className="text-lg font-semibold">Releases</h2>
          <button className="btn btn-ghost !p-1.5" aria-label="New release" onClick={() => edit({ kind: 'new-release', id: album.id })}><Plus size={16} /></button></div>
        {!releases.length && <p className="text-sm text-muted">No releases. A release is an edition of the album (deluxe, streaming, vinyl) with its own date, cover and tracklist.</p>}
        <div className="space-y-1.5" role="radiogroup" aria-label="Release to show">
          {releases.length > 0 && (
            <button role="radio" aria-checked={view.kind === 'all'} data-selected={view.kind === 'all' || undefined} className="card bt-sel flex w-full items-center gap-3 px-3 py-2 text-left text-sm" onClick={() => choose({ kind: 'all' })}>
              <Layers size={18} className="shrink-0 text-muted" /><span className="min-w-0 flex-1"><span className="block font-medium">All tracks</span><span className="block text-xs text-muted">{plural(album.trackIds.length, 'track')}</span></span></button>)}
          {releases.map((r) => {
            const on = view.kind === 'release' && view.id === r.id;
            const reuse = r.title === album.title; // a release called after its album has no name of its own to show
            const isDefault = album.defaultReleaseId ? album.defaultReleaseId === r.id : releases.length > 0 && r.id === [...releases].sort((a, b) => b.trackIds.length - a.trackIds.length)[0].id;
            return (
              <div key={r.id} data-selected={on || undefined} className="card bt-sel group flex items-center gap-2 py-2 pl-2 pr-1">
                <button role="radio" aria-checked={on} className="flex min-w-0 flex-1 items-center gap-3 text-left text-sm" onClick={() => choose({ kind: 'release', id: r.id })}>
                  <Cover hash={r.cover || album.cover} seed={r.title} className="h-11 w-11 shrink-0" />
                  <span className="min-w-0 flex-1"><span className="flex items-center gap-1.5 font-medium"><span className="truncate">{reuse ? (r.releaseDate ?? 'Undated') : r.title}</span>{isDefault && <span className="chip shrink-0">default</span>}</span>
                    <span className="block text-xs text-muted">{reuse ? plural(r.trackIds.length, 'track') : `${r.releaseDate ?? 'undated'} · ${plural(r.trackIds.length, 'track')}`}</span></span>
                </button>
                <button className="-my-2 flex shrink-0 items-center self-stretch px-2.5 text-muted hover:text-fg" aria-label={`Edit ${r.title}`} title="Edit release" onClick={() => edit({ kind: 'release', id: r.id })}><Pencil size={14} /></button>
                <button className="-my-2 flex shrink-0 items-center self-stretch px-2.5 text-muted hover:text-fg" aria-label={`Add ${r.title} to an album playlist`} title="Add this release to an album playlist" onClick={() => edit({ kind: 'add-album-to-playlist', id: r.id })}><ListPlus size={14} /></button>
              </div>);
          })}
        </div>
      </section>}
      right={<Notes lib={lib} type="album" id={album.id} />}>

      <div className="flex flex-col gap-5 sm:flex-row sm:items-end" onContextMenu={menu.onContextMenu(fullMenu, `Actions for ${album.title}`, 'album')}>
        <Cover hash={cover} seed={album.title} className="w-48 shrink-0 sm:w-56" />
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-wider text-muted">{release ? 'Release' : 'Album'}{(album as { complete?: boolean }).complete && <span className="chip !normal-case">Complete</span>}{(album as { hidden?: boolean }).hidden && <span className="chip !normal-case">Hidden</span>}</div>
          <h1 className="text-3xl font-bold leading-tight">{album.title}</h1>
          {release && release.title !== album.title && <div className="text-sm font-medium">{release.title}{release.releaseDate && <span className="text-muted"> · {release.releaseDate}</span>}</div>}
          <div className="text-sm">
            <span className="font-medium"><ArtistLinks leads={album.leads} className="hover:underline" /></span>
            <span className="text-muted"> · {plural(tracks.length, 'track')}{album.rating != null && ` · avg ${album.rating.toFixed(1)}`}</span>
            {album.eraIds.map((e) => lib.eraById.get(e) && <span key={e}> · <Link to={`/eras/${e}`} className="text-muted hover:text-fg hover:underline">{lib.eraById.get(e)!.name}</Link></span>)}
          </div>
          <div className="flex flex-wrap gap-1.5">{album.genres.map((g) => <Link key={g} to={`/tracks?genre=${encodeURIComponent(g)}`} className="chip hover:brightness-125" title={`Tracks in ${g}`}>{g}</Link>)}</div>
          <div className="flex flex-wrap gap-2 pt-2">
            <button className="btn btn-accent" disabled={!playable.length} onClick={() => play(playable[0], playable, { type: 'album', id: album.id })}><Play size={16} fill="currentColor" />Play</button>
            <button className="btn" disabled={!playable.length} onClick={() => { const s = shuffleWithRules(playable, lib.rules); play(s[0], s, { type: 'album', id: album.id }); }}><Shuffle size={16} />Shuffle</button>
            <KeepOffline hashes={tracks.flatMap((t) => (t.file ? [t.file] : []))} />
            <button data-menu-trigger className="btn btn-ghost !p-2" aria-label="More actions" aria-haspopup="menu" title="Stats, edit, add files, import, merge…" onClick={(e) => menu.toggle(e.currentTarget, 'album', fullMenu, `Actions for ${album.title}`)}><MoreHorizontal size={16} /></button>
            {searchingImport && <span className="flex items-center gap-1.5 text-xs text-muted" role="status"><Loader2 size={14} className="animate-spin" />Searching YouTube Music…</span>}
          </div>
          {!playable.length && <div className="text-xs text-muted">No audio on the server yet. Use Library health → Download missing audio.</div>}
        </div>
      </div>

      {arranging && view.kind === 'all' ? <TracklistEditor album={album} lib={lib} />
        : <div className="card overflow-hidden"><TrackTable tracks={tracks} source="album" sourceId={album.id} numbered showAlbum={false} />{!tracks.length && <div className="px-4 pb-4 text-center text-xs text-muted">Use “Edit tracks” to add some.</div>}</div>}
      {menu.element}
    </DetailLayout>
  );
}
