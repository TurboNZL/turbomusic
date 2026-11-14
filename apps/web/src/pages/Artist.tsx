import { useMemo, useState } from 'react';
import { canPlay } from '../lib/spotifyPlayer.ts';
import { statsPath } from '../lib/entityStats.ts';
import { BarChart3, MoreHorizontal, Pencil } from 'lucide-react';
import { PlayControls } from '../components/PlayControls.tsx';
import { Link, useParams } from 'react-router-dom';
import { Layers } from 'lucide-react';
import { cn } from '../lib/cn.ts';
import { useEditor } from '../lib/editor.ts';
import { useLibrary } from '../lib/derive.ts';
import { Notes } from '../components/Notes.tsx';
import { Cover } from '../components/Cover.tsx';
import { TrackTable } from '../components/TrackTable.tsx';
import { DetailLayout } from '../components/DetailLayout.tsx';
import { SingleGrid } from '../components/SingleCard.tsx';
import { ArtistLinks } from '../components/ArtistLinks.tsx';
import { idChip, searchHref } from '../lib/searchUrl.ts';
import { akaLine } from '../lib/autofill.ts';
import { useChunks } from '../lib/useChunks.ts';
import { useMenu } from '../components/Menu.tsx';
import { useAlbumMenuItems, useArtistMenuItems } from '../components/entityMenus.tsx';

/** Long lists are drawn a piece at a time as you scroll (a long discography would otherwise draw hundreds of rows at once). */
const ALBUM_CHUNK = 24, SINGLE_CHUNK = 24, TRACK_CHUNK = 30;

export function ArtistPage() {
  const { id } = useParams();
  const lib = useLibrary();
  const edit = useEditor((s) => s.open);
  const menu = useMenu();
  const artistItems = useArtistMenuItems();
  const albumItems = useAlbumMenuItems();
  const [era, setEra] = useState<string | null>(null);
  const [newest, setNewestState] = useState(() => { try { return localStorage.getItem('turbomusic.artistNewestFirst') === '1'; } catch { return false; } });
  const setNewest = (v: boolean) => { setNewestState(v); try { localStorage.setItem('turbomusic.artistNewestFirst', v ? '1' : '0'); } catch { /* not remembered */ } };
  const artist = id ? lib.artistById.get(id) : undefined;
  const newestKey = newest ? 1 : 0;
  // derived once per artist/era/order, not on every scroll step
  const { albums, singles, tracks, eraIds } = useMemo(() => {
    if (!artist) return { albums: [], singles: [], tracks: [], eraIds: [] as string[] };
    const credited = (cs: { artistId: string }[]) => cs.some((c) => c.artistId === artist.id);
    const allAlbums = lib.albums.filter((a) => credited(a.credits));
    const allTracks = lib.tracks.filter((t) => credited(t.credits));
    // the eras this artist appears in; picking one narrows the page to it
    const eraIds = [...new Set([...allAlbums.flatMap((a) => a.eraIds), ...allTracks.flatMap((t) => t.eraIds)])].filter((e) => lib.eraById.has(e));
    // albums and singles run by release date (undated last whichever way it runs); the direction is remembered
    const byDate = <T extends { releaseDate?: string | null }>(xs: T[]) => [...xs].sort((a, b) => (a.releaseDate ? (b.releaseDate ? (newestKey ? -1 : 1) * a.releaseDate.localeCompare(b.releaseDate) : -1) : b.releaseDate ? 1 : 0));
    const albums = byDate(era ? allAlbums.filter((a) => a.eraIds.includes(era)) : allAlbums);
    const tracks = (era ? allTracks.filter((t) => t.eraIds.includes(era)) : allTracks).sort((a, b) => b.effectiveRating - a.effectiveRating || b.elo - a.elo);
    const singles = byDate(tracks.filter((t) => !t.albumId));
    return { albums, singles, tracks, eraIds };
  }, [lib, artist, era, newestKey]);
  const playable = useMemo(() => tracks.filter(canPlay).map((t) => t.id), [tracks]);
  const resetKey = `${id}|${era}|${newestKey}`;
  const albumChunks = useChunks(albums.length, ALBUM_CHUNK, resetKey);
  const singleChunks = useChunks(singles.length, SINGLE_CHUNK, resetKey);
  const trackChunks = useChunks(tracks.length, TRACK_CHUNK, resetKey);
  if (!artist) return <div className="text-muted">Artist not found.</div>;
  // a link to the search page with this artist as a chip, listing only that kind
  const where = (kind: 'albums' | 'singles' | 'tracks') => searchHref({ kind, chips: [idChip('artist', artist.id, artist.name), ...(era ? [idChip('era', era, lib.eraById.get(era)?.name ?? '')] : [])] });
  return (
    <DetailLayout right={<Notes lib={lib} type="artist" id={artist.id} />}>
      <div className="flex items-center gap-5" onContextMenu={menu.onContextMenu(artistItems(artist.id), `Actions for ${artist.name}`, 'artist')}>
        <Cover kind="artist" hash={artist.image} seed={artist.name} className="w-32 shrink-0 sm:w-40" />
        <div><div className="text-xs uppercase tracking-wider text-muted">Artist</div><h1 className="text-3xl font-bold">{artist.name}</h1>
          {akaLine(artist.aliases) && <div className="text-sm text-muted" title={artist.aliases!.join(', ')}>{akaLine(artist.aliases)}</div>}
          <div className="text-sm text-muted"><Link className="hover:text-fg hover:underline" to={where('albums')}>{albums.length} album{albums.length === 1 ? "" : "s"}</Link>{singles.length > 0 && <> · <Link className="hover:text-fg hover:underline" to={where('singles')}>{singles.length} single{singles.length === 1 ? "" : "s"}</Link></>} · <Link className="hover:text-fg hover:underline" to={where('tracks')}>{tracks.length} tracks</Link></div>
          <div className="mt-3 flex flex-wrap gap-2">
            <PlayControls ids={playable} source={{ type: 'search', id: null }} label="this artist" />
            <Link className="btn btn-ghost" to={statsPath('artist', artist.id)}><BarChart3 size={15} />Stats</Link>
            <button className="btn btn-ghost" onClick={() => edit({ kind: 'artist', id: artist.id })}><Pencil size={15} />Edit</button>
            <button data-menu-trigger className="btn btn-ghost !p-2" aria-label="More actions" aria-haspopup="menu" onClick={(e) => menu.toggle(e.currentTarget, 'artist', artistItems(artist.id), `Actions for ${artist.name}`)}><MoreHorizontal size={16} /></button></div></div>
      </div>
      {eraIds.length > 0 && <section className="flex flex-wrap items-center gap-2" aria-label="Eras">
        <span className="flex items-center gap-1.5 text-sm font-medium"><Layers size={14} />Eras</span>
        {eraIds.map((e) => (
          <span key={e} className={cn('inline-flex overflow-hidden rounded-full border text-sm', era === e ? 'border-accent text-accent' : 'border-line')}>
            <button className="px-3 py-1 hover:bg-raised/60" aria-pressed={era === e} title="Show only this era" onClick={() => { setEra(era === e ? null : e); }}>{lib.eraById.get(e)!.name}</button>
            <Link to={`/eras/${e}`} className="border-l border-line px-2 py-1 text-muted hover:text-fg" aria-label={`Open ${lib.eraById.get(e)!.name}`}>↗</Link>
          </span>))}
        {era && <button className="text-xs text-muted underline" onClick={() => setEra(null)}>Show everything</button>}
      </section>}
      {(albums.length > 0 || singles.length > 0) && <div className="flex items-center gap-2 text-sm text-muted">Albums and singles by release date:
        <button className="btn btn-ghost !px-2.5 !py-1" aria-label="Reverse the order" onClick={() => setNewest(!newest)}>{newest ? 'Newest first' : 'Oldest first'}</button></div>}
      {albums.length > 0 && <section><h2 className="mb-3 text-lg font-semibold"><Link to={where('albums')} className="hover:underline" title="Search these albums">Albums</Link></h2>
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(var(--grid-min), 1fr))' }}>
          {albums.slice(0, albumChunks.shown).map((a) => (
            <div key={a.id} className="bt-tile" onContextMenu={menu.onContextMenu(albumItems(a), `Actions for ${a.title}`, a.id)}>
              <Link to={`/albums/${a.id}`} className="block"><Cover hash={a.cover} seed={a.title} /><div className="bt-cap-t mt-2 truncate text-sm font-medium">{a.title}</div></Link>
              <div className="bt-cap truncate text-xs text-muted"><ArtistLinks leads={a.leads} /></div>
            </div>))}
        </div>{albumChunks.left > 0 && <div ref={albumChunks.sentinel} className="mt-3 text-center"><button className="btn" onClick={albumChunks.more}>Show more ({albumChunks.left} left)</button></div>}</section>}
      {singles.length > 0 && <section><h2 className="mb-3 text-lg font-semibold"><Link to={where('singles')} className="hover:underline" title="Search these singles">Singles</Link></h2><SingleGrid tracks={singles.slice(0, singleChunks.shown)} />{singleChunks.left > 0 && <div ref={singleChunks.sentinel} className="mt-3 text-center"><button className="btn" onClick={singleChunks.more}>Show more ({singleChunks.left} left)</button></div>}</section>}
      <section><h2 className="mb-3 text-lg font-semibold"><Link to={where('tracks')} className="hover:underline" title="Search these tracks">Tracks</Link>, best first</h2>
        <div className="card overflow-hidden"><TrackTable tracks={tracks.slice(0, trackChunks.shown)} queue={tracks} source="search" covers /></div>
        {trackChunks.left > 0 && <div ref={trackChunks.sentinel} className="mt-3 text-center"><button className="btn" onClick={trackChunks.more}>Show more ({trackChunks.left} left)</button></div>}</section>
      {menu.element}
    </DetailLayout>
  );
}
