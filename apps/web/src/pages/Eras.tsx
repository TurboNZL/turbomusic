import { useMemo, useState } from 'react';
import { ListToolbar } from '../components/ListToolbar.tsx';
import { EntityList } from '../components/EntityList.tsx';
import { albumSubject, eraSubject, matchesAll, splitTyped, trackSubject, type Chip } from '../lib/filters.ts';
import { ERA_ITEM_SORTS, ERA_SORTS, eraRows, sortEraItems, sortEras, type EraItem } from '../lib/listSort.ts';
import { usePageState } from '../lib/pageState.ts';
import { canPlay } from '../lib/spotifyPlayer.ts';
import { PlayControls } from '../components/PlayControls.tsx';
import { Link, useParams } from 'react-router-dom';
import { idChip, searchHref } from '../lib/searchUrl.ts';
import { statsPath } from '../lib/entityStats.ts';
import { BarChart3, Layers, MoreHorizontal, Pencil, Play, Plus, Shuffle } from 'lucide-react';
import { shuffleWithRules } from '@turbomusic/core';
import { useLibrary } from '../lib/derive.ts';
import { useEditor } from '../lib/editor.ts';
import { usePlayer } from '../lib/player.ts';
import { Cover } from '../components/Cover.tsx';
import { PlaylistCover } from '../components/PlaylistCover.tsx';
import { playlistCount } from '../lib/playlists.ts';
import { Notes } from '../components/Notes.tsx';
import { DetailLayout } from '../components/DetailLayout.tsx';
import { SingleTile, fmtDate } from '../components/SingleCard.tsx';
import { useTrackMenuItems } from '../components/TrackMenu.tsx';
import { ArtistLinks } from '../components/ArtistLinks.tsx';
import { useMenu } from '../components/Menu.tsx';
import { plural } from '../lib/cn.ts';
import { useAlbumMenuItems } from '../components/entityMenus.tsx';

/** An era is a collection of albums, singles and playlists (they can overlap); notes can be tied to it. */
export function ErasPage() {
  const lib = useLibrary();
  const edit = useEditor((s) => s.open);
  const [q, setQ] = useState('');
  const [chips, setChips] = useState<Chip[]>([]);
  const page = usePageState('eras', ERA_SORTS, { sort: 'name' });
  const all = useMemo(() => eraRows(lib), [lib]);
  const rows = useMemo(() => {
    const needle = splitTyped(q, 'eras') ? '' : q.toLowerCase();
    const f = all.filter((r) => r.era.name.toLowerCase().includes(needle) && (!chips.length || matchesAll(chips, eraSubject(lib, r.era))));
    return sortEras(f, page.sort, page.dir);
  }, [lib, all, q, chips, page.sort, page.dir]);
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-2xl font-bold">Eras <span className="text-base font-normal text-muted">{rows.length}</span></h1>
      </div>
      <ListToolbar scope="eras" chips={chips} onChips={setChips} text={q} onText={setQ} placeholder="Search eras, or filter: artist, genre, before…" sorts={ERA_SORTS} sort={page.sort} dir={page.dir} onSort={page.setSort} onFlip={page.flip} view={page.view} onView={page.setView} />
      {!all.length && <p className="max-w-xl text-sm text-muted">An era groups albums and singles that belong to the same period (a phase of an artist, a scene). Make one here and fill it, or choose it in an album’s or single’s editor. Eras can overlap, and notes and playlists can belong to them.</p>}
      {all.length > 0 && !rows.length && <p className="text-sm text-muted">No eras match.</p>}
      {page.view === 'list'
        ? <EntityList rows={rows.map(({ era, albums, singles, cover }) => ({ id: era.id, to: `/eras/${era.id}`, cover, seed: era.name, title: era.name, sub: `${plural(albums.length, 'album')} · ${plural(singles.length, 'single')}` }))} />
        : <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(var(--grid-min), 1fr))' }}>
            {rows.map(({ era, albums, singles, cover }) => (
              <Link key={era.id} to={`/eras/${era.id}`} className="bt-tile group block">
                <Cover hash={cover} seed={era.name} className="transition-transform group-hover:scale-[1.02]" />
                <div className="bt-cap-t mt-2 truncate text-sm font-medium">{era.name}</div>
                <div className="bt-cap text-xs text-muted">{plural(albums.length, 'album')} · {plural(singles.length, 'single')}</div>
              </Link>))}
          </div>}
    </div>
  );
}

export function EraPage() {
  const { id } = useParams();
  const lib = useLibrary();
  const edit = useEditor((s) => s.open);
  const play = usePlayer((s) => s.play);
  const menu = useMenu();
  const albumItems = useAlbumMenuItems();
  const era = id ? lib.eraById.get(id) : undefined;
  const trackMenu = useTrackMenuItems();
  const [q, setQ] = useState('');
  const [chips, setChips] = useState<Chip[]>([]);
  const page = usePageState('era-items', ERA_ITEM_SORTS, { sort: 'released', view: 'grid' });
  // albums and singles of the era as one list: oldest first by default, and the same sort/search/filter controls as the other pages
  const items = useMemo(() => {
    if (!era) return [] as EraItem[];
    const all: EraItem[] = [
      ...era.albumIds.flatMap((aid) => { const album = lib.albumById.get(aid); return album ? [{ kind: 'album' as const, id: album.id, album }] : []; }),
      ...era.trackIds.flatMap((tid) => { const track = lib.trackById.get(tid); return track ? [{ kind: 'single' as const, id: track.id, track }] : []; }),
    ];
    const needle = splitTyped(q, 'albums') ? '' : q.trim().toLowerCase();
    const shown = all.filter((i) => {
      const text = i.kind === 'album' ? `${i.album.title} ${i.album.artistName}` : `${i.track.title} ${i.track.artistName}`;
      return (!needle || text.toLowerCase().includes(needle)) && matchesAll(chips, i.kind === 'album' ? albumSubject(lib, i.album) : trackSubject(lib, i.track));
    });
    return sortEraItems(lib, shown, page.sort, page.dir);
  }, [lib, era, q, chips, page.sort, page.dir]);
  if (!era) return <div className="text-muted">Era not found.</div>;
  const albums = items.flatMap((i) => (i.kind === 'album' ? [i.album] : []));
  const singles = items.flatMap((i) => (i.kind === 'single' ? [i.track] : []));
  const total = { albums: era.albumIds.filter((x) => lib.albumById.has(x)).length, singles: era.trackIds.filter((x) => lib.trackById.has(x)).length };
  const playlists = era.playlistIds.flatMap((id) => lib.playlists.find((p) => p.id === id) ?? []);
  // a link to the search page with this era as a chip, listing only that kind
  const where = (kind: 'albums' | 'singles' | 'tracks') => searchHref({ kind, chips: [idChip('era', era.id, era.name)] });
  const ids = items.flatMap((i) => (i.kind === 'album' ? i.album.trackIds : [i.track.id])).filter((t) => canPlay(lib.trackById.get(t)));
  const singleIds = singles.filter(canPlay).map((t) => t.id);
  const cover = era.cover || albums.find((a) => a.cover)?.cover || null;
  return (
    <DetailLayout right={<Notes lib={lib} type="era" id={era.id} />}>
      <div className="flex items-center gap-5">
        <Cover hash={cover} seed={era.name} className="w-40 shrink-0 sm:w-48" />
        <div className="min-w-0 space-y-2"><div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted"><Layers size={13} />Era</div>
          <h1 className="text-3xl font-bold">{era.name}</h1>
          <div className="text-sm text-muted"><Link className="hover:text-fg hover:underline" to={where('albums')}>{plural(total.albums, 'album')}</Link> · <Link className="hover:text-fg hover:underline" to={where('singles')}>{plural(total.singles, 'single')}</Link>{playlists.length > 0 && ` · ${plural(playlists.length, 'playlist')}`}</div>
          {era.description && <p className="max-w-prose text-sm">{era.description}</p>}
          <div className="flex flex-wrap gap-2 pt-1">
            <PlayControls ids={ids} source={{ type: 'search', id: `Era: ${era.name}` }} label={era.name} />
            <button data-menu-trigger className="btn btn-ghost !p-2" aria-label="More actions" aria-haspopup="menu" title="Stats, edit, the tracks in this era…" onClick={(e) => menu.toggle(e.currentTarget, 'era', [
              { label: 'Tracks in this era', icon: <Layers size={15} />, to: where('tracks') },
              { label: 'Stats page', icon: <BarChart3 size={15} />, to: statsPath('era', era.id) },
              { label: 'Edit era…', icon: <Pencil size={15} />, run: () => edit({ kind: 'era', id: era.id }) },
            ], `Actions for ${era.name}`)}><MoreHorizontal size={16} /></button></div></div>
      </div>
      {total.albums + total.singles > 0 && <section className="space-y-3"><h2 className="text-lg font-semibold"><Link to={where('albums')} className="hover:underline" title="Search this era's albums">Albums</Link> and <Link to={where('singles')} className="hover:underline" title="Search this era's singles">singles</Link></h2>
        <ListToolbar scope="albums" chips={chips} onChips={setChips} text={q} onText={setQ} placeholder="Search this era, or filter: artist, genre, before…" sorts={ERA_ITEM_SORTS} sort={page.sort} dir={page.dir} onSort={page.setSort} onFlip={page.flip} view={page.view} onView={page.setView} />
        {!items.length && <p className="text-sm text-muted">Nothing here matches.</p>}
        {page.view === 'grid'
          ? <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(var(--grid-min), 1fr))' }}>
              {items.map((i) => i.kind === 'album'
                ? <div key={i.id} className="bt-tile" onContextMenu={(e) => menu.onContextMenu(albumItems(i.album), `Actions for ${i.album.title}`, i.id)(e)}>
                    <Link to={`/albums/${i.album.id}`} className="block"><Cover hash={i.album.cover} seed={i.album.title} /><div className="bt-cap-t mt-2 truncate text-sm font-medium">{i.album.title}</div></Link>
                    <div className="bt-cap truncate text-xs text-muted"><ArtistLinks leads={i.album.leads} /></div>
                    <div className="bt-cap truncate text-xs text-muted">{i.album.releaseDate ? fmtDate(i.album.releaseDate) : 'No date'}</div>
                  </div>
                : <SingleTile key={i.id} t={i.track} ids={singleIds} menu={menu} itemsFor={trackMenu} />)}
            </div>
          : <div className="card divide-y divide-line/60 overflow-hidden">
              {items.map((i) => {
                const to = i.kind === 'album' ? `/albums/${i.album.id}` : statsPath('track', i.track.id);
                const title = i.kind === 'album' ? i.album.title : i.track.title;
                const cover = i.kind === 'album' ? i.album.cover : i.track.cover;
                const date = i.kind === 'album' ? i.album.releaseDate : i.track.releaseDate;
                const artist = i.kind === 'album' ? i.album.artistName : i.track.artistName;
                return (
                  <Link key={i.id} to={to} className="bt-row flex items-center gap-3 px-3 py-2 hover:bg-raised/50">
                    <Cover hash={cover} seed={title} className="w-10 shrink-0" />
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{title}</span><span className="block truncate text-xs text-muted">{artist}</span></span>
                    <span className="chip">{i.kind === 'album' ? 'Album' : 'Single'}</span>
                    <span className="w-24 text-right text-xs tabular-nums text-muted">{date ? fmtDate(date) : ''}</span>
                  </Link>);
              })}
            </div>}
      </section>}
      {playlists.length > 0 && <section><h2 className="mb-3 text-lg font-semibold">Playlists</h2>
        <div className="grid gap-3 sm:grid-cols-2">{playlists.map((p) => (
          <Link key={p.id} to="/playlists" className="card flex items-center gap-3 p-3 hover:bg-raised/50"><PlaylistCover playlist={p} className="h-12 w-12 shrink-0" /><div className="min-w-0"><div className="truncate font-medium">{p.name}</div><div className="text-xs text-muted">{plural(playlistCount(lib, p).n, playlistCount(lib, p).noun)}</div></div></Link>))}</div></section>}
      {!total.albums && !total.singles && !playlists.length && <p className="text-sm text-muted">Nothing in this era yet. Edit the era to add albums, singles and playlists, or choose it in an album’s or single’s editor.</p>}
      {menu.element}
    </DetailLayout>
  );
}
