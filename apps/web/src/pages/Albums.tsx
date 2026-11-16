import { ListToolbar } from '../components/ListToolbar.tsx';
import { EntityList } from '../components/EntityList.tsx';
import { albumSubject, matchesAll, splitTyped, type Chip } from '../lib/filters.ts';
import { ALBUM_SORTS, sortAlbums } from '../lib/listSort.ts';
import { usePageState } from '../lib/pageState.ts';
import { useMemo, useState } from 'react';
import { useChunks } from '../lib/useChunks.ts';
import { Download, EyeOff, Plus, Shuffle } from 'lucide-react';
import { shuffleWithRules } from '@turbomusic/core';
import { usePlayer } from '../lib/player.ts';
import { canPlay } from '../lib/spotifyPlayer.ts';
import { Link } from 'react-router-dom';
import { useEditor } from '../lib/editor.ts';
import { useLibrary } from '../lib/derive.ts';
import { Cover } from '../components/Cover.tsx';
import { useMenu } from '../components/Menu.tsx';
import { PlayControls } from '../components/PlayControls.tsx';
import { useAlbumMenuItems } from '../components/entityMenus.tsx';
import { ArtistLinks } from '../components/ArtistLinks.tsx';
import { plural } from '../lib/cn.ts';

export function AlbumsPage() {
  const lib = useLibrary();
  const edit = useEditor((s) => s.open);
  const menu = useMenu();
  const itemsFor = useAlbumMenuItems();
  const play = usePlayer((s) => s.play);
  const [q, setQ] = useState('');
  const [chips, setChips] = useState<Chip[]>([]);
  // albums marked hidden stay out of the list unless this is ticked
  const [showHidden, setShowHidden] = useState(false);
  const hiddenCount = useMemo(() => lib.albums.filter((a) => (a as { hidden?: boolean }).hidden).length, [lib]);
  const page = usePageState('albums', ALBUM_SORTS, { sort: 'title' });
  const albums = useMemo(() => {
    const needle = splitTyped(q, 'albums') ? '' : q.toLowerCase();
    const f = lib.albums.filter((a) => (showHidden || !(a as { hidden?: boolean }).hidden) && `${a.title} ${a.artistName}`.toLowerCase().includes(needle) && matchesAll(chips, albumSubject(lib, a)));
    return sortAlbums(lib, f, page.sort, page.dir);
  }, [lib, q, chips, page.sort, page.dir, showHidden]);

  /** every playable track of the albums shown (filters apply), shuffled by the playback rules */
  const playable = useMemo(() => [...new Set(albums.flatMap((a) => a.trackIds))].filter((id) => { const t = lib.trackById.get(id); return !!t && canPlay(t); }), [albums, lib]);

  const CH = useChunks(albums.length, 48, `${q}|${chips.length}|${page.sort}|${page.dir}|${page.view}`); // drawn a screenful at a time
  const shownAlbums = albums.slice(0, CH.shown);
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-2xl font-bold">Albums <span className="text-base font-normal text-muted">{albums.length}</span></h1>
      </div>
      <ListToolbar actions={<>{hiddenCount > 0 && <button type="button" className={`btn ${showHidden ? 'btn-accent' : ''}`} aria-pressed={showHidden} title="Albums you hid are left out of this list" onClick={() => setShowHidden(!showHidden)}><EyeOff size={15} />Hidden {hiddenCount}</button>}<PlayControls ids={playable} source={{ type: 'search', id: 'Albums' }} label="these albums" /></>} scope="albums" chips={chips} onChips={setChips} text={q} onText={setQ} sorts={ALBUM_SORTS} sort={page.sort} dir={page.dir} onSort={page.setSort} onFlip={page.flip} view={page.view} onView={page.setView} />
      {page.view === 'list'
        ? <EntityList rows={shownAlbums.map((a) => ({ id: a.id, to: `/albums/${a.id}`, cover: a.cover, seed: a.title, title: a.title, sub: <ArtistLinks leads={a.leads} />,
            meta: <>{a.releaseDate?.slice(0, 4)}{a.releaseDate ? ' · ' : ''}{plural(a.trackIds.length, 'track')}{a.rating != null && ` · ${a.rating.toFixed(1)}`}</>, menu: menu.onContextMenu(itemsFor(a), `Actions for ${a.title}`, a.id) }))} />
        : <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(var(--grid-min), 1fr))' }}>
            {shownAlbums.map((a) => (
              <div key={a.id} className="bt-tile group" onContextMenu={(e) => menu.onContextMenu(itemsFor(a), `Actions for ${a.title}`, a.id)(e)}>
                <Link to={`/albums/${a.id}`} className="block">
                  <Cover hash={a.cover} seed={a.title} className="transition-transform group-hover:scale-[1.02]" />
                  <div className="bt-cap-t mt-2 truncate text-sm font-medium">{a.title}</div>
                </Link>
                <div className="bt-cap flex justify-between text-xs text-muted"><span className="truncate"><ArtistLinks leads={a.leads} /></span>{a.rating != null && <span className="tabular-nums">{a.rating.toFixed(1)}</span>}</div>
              </div>
            ))}
          </div>}
      {CH.left > 0 && <div ref={CH.sentinel} className="mt-4 text-center"><button className="btn" onClick={CH.more}>Show more ({CH.left} left)</button></div>}
      {!albums.length && <p className="text-sm text-muted">{lib.albums.length ? 'No albums match.' : 'No albums yet.'}</p>}
      {menu.element}
    </div>
  );
}
