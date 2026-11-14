import { useMemo, useState } from 'react';
import { useChunks } from '../lib/useChunks.ts';
import { Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useEditor } from '../lib/editor.ts';
import { useLibrary } from '../lib/derive.ts';
import { Cover } from '../components/Cover.tsx';
import { useMenu } from '../components/Menu.tsx';
import { plural } from '../lib/cn.ts';
import { useArtistMenuItems } from '../components/entityMenus.tsx';
import { ListToolbar } from '../components/ListToolbar.tsx';
import { EntityList } from '../components/EntityList.tsx';
import { artistSubject, matchesAll, splitTyped, type Chip } from '../lib/filters.ts';
import { ARTIST_SORTS, artistRows, sortArtists } from '../lib/listSort.ts';
import { usePageState } from '../lib/pageState.ts';

export function ArtistsPage() {
  const lib = useLibrary();
  const edit = useEditor((s) => s.open);
  const menu = useMenu();
  const itemsFor = useArtistMenuItems();
  const [q, setQ] = useState('');
  const [chips, setChips] = useState<Chip[]>([]);
  const page = usePageState('artists', ARTIST_SORTS, { sort: 'tracks' });
  const all = useMemo(() => artistRows(lib), [lib]);
  const rows = useMemo(() => {
    const needle = splitTyped(q, 'artists') ? '' : q.toLowerCase();
    const f = all.filter((a) => a.name.toLowerCase().includes(needle) && (!chips.length || matchesAll(chips, artistSubject(lib, a.id))));
    return sortArtists(f, page.sort, page.dir);
  }, [lib, all, q, chips, page.sort, page.dir]);
  const CH = useChunks(rows.length, 60, `${q}|${chips.length}|${page.sort}|${page.dir}|${page.view}`);
  const shownRows = rows.slice(0, CH.shown);
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-2xl font-bold">Artists <span className="text-base font-normal text-muted">{rows.length}</span></h1>
        <button className="btn" onClick={() => edit({ kind: 'new-artist', id: '' })}><Plus size={15} />New artist</button>
      </div>
      <ListToolbar scope="artists" chips={chips} onChips={setChips} text={q} onText={setQ} placeholder="Search artists, or filter: era, genre, before…" sorts={ARTIST_SORTS} sort={page.sort} dir={page.dir} onSort={page.setSort} onFlip={page.flip} view={page.view} onView={page.setView} />
      {page.view === 'list'
        ? <EntityList rows={shownRows.map((a) => ({ id: a.id, to: `/artists/${a.id}`, cover: a.image, seed: a.name, title: a.name, kind: 'artist' as const,
            sub: `${plural(a.tracks, 'track')} · ${plural(a.albums, 'album')}`, meta: a.rating != null ? a.rating.toFixed(1) : undefined, menu: menu.onContextMenu(itemsFor(a.id), `Actions for ${a.name}`, a.id) }))} />
        : <div className="grid gap-5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(var(--grid-min), 1fr))' }}>
            {shownRows.map((a) => (
              <Link key={a.id} to={`/artists/${a.id}`} className="bt-tile group block text-center" onContextMenu={menu.onContextMenu(itemsFor(a.id), `Actions for ${a.name}`, a.id)}>
                <Cover kind="artist" hash={a.image} seed={a.name} className="mx-auto w-full transition-transform group-hover:scale-[1.03]" />
                <div className="bt-cap-t mt-2 truncate text-sm font-medium">{a.name}</div>
                <div className="bt-cap text-xs text-muted">{plural(a.tracks, 'track')}</div>
              </Link>
            ))}
          </div>}
      {CH.left > 0 && <div ref={CH.sentinel} className="mt-4 text-center"><button className="btn" onClick={CH.more}>Show more ({CH.left} left)</button></div>}
      {!rows.length && <p className="text-sm text-muted">{lib.artists.length ? 'No artists match.' : 'No artists yet.'}</p>}
      {menu.element}
    </div>
  );
}
