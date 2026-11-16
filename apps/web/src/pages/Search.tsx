import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Layers } from 'lucide-react';
import { useLibrary, type Library } from '../lib/derive.ts';
import { albumSubject, artistSubject, eraSubject, matchesAll, splitTyped, trackSubject } from '../lib/filters.ts';
import { KIND_SCOPE, SEARCH_KINDS, chipsApply, parseSearch, searchHref, type SearchKind } from '../lib/searchUrl.ts';
import { cn } from '../lib/cn.ts';
import { useStore } from '../lib/store.ts';
import { Cover } from '../components/Cover.tsx';
import { TrackTable } from '../components/TrackTable.tsx';
import { SingleGrid } from '../components/SingleCard.tsx';
import { ArtistLinks } from '../components/ArtistLinks.tsx';
import { useMenu } from '../components/Menu.tsx';
import { useAlbumMenuItems, useArtistMenuItems } from '../components/entityMenus.tsx';

const LABEL: Record<SearchKind, string> = { all: 'All', artists: 'Artists', albums: 'Albums', singles: 'Singles', tracks: 'Tracks', eras: 'Eras' };
const GLANCE = 12, CHUNK = 100;

/** Oldest first, undated last. */
const byDate = <T extends { releaseDate?: string | null }>(xs: T[]) => [...xs].sort((a, b) => (a.releaseDate ? (b.releaseDate ? a.releaseDate.localeCompare(b.releaseDate) : -1) : b.releaseDate ? 1 : 0));

/** What the search bar and its chips found. The words and chips live in the address (see lib/searchUrl.ts). */
export function SearchPage() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const lib = useLibrary();
  const menu = useMenu();
  const albumItems = useAlbumMenuItems();
  const artistItems = useArtistMenuItems();
  const searchPlaysAll = useStore((s) => s.settings.searchPlaysAll);
  const { q, chips, kind } = parseSearch(params);
  const [shown, setShown] = useState(CHUNK);
  const watcher = useRef<IntersectionObserver | null>(null);
  const grow = useRef<() => void>(() => {});
  const sentinel = (el: HTMLElement | null) => { watcher.current?.disconnect(); if (!el || typeof IntersectionObserver === 'undefined') return; watcher.current = new IntersectionObserver((e) => { if (e.some((x) => x.isIntersecting)) grow.current(); }, { rootMargin: '600px' }); watcher.current.observe(el); };
  grow.current = () => setShown((n) => n + CHUNK);

  const results = useMemo(() => {
    const needle = (splitTyped(q) ? '' : q).trim().toLowerCase();
    const has = (s: string) => !needle || s.toLowerCase().includes(needle);
    const ok = (k: keyof typeof KIND_SCOPE) => chipsApply(chips, k);
    return {
      artists: ok('artists') ? lib.artists.filter((a) => has([a.name, ...(a.aliases ?? [])].join(' ')) && matchesAll(chips, artistSubject(lib, a.id))).sort((a, b) => a.name.localeCompare(b.name)) : null,
      albums: ok('albums') ? (() => {
        const found = lib.albums.filter((a) => has(`${a.title} ${a.artistName}`) && matchesAll(chips, albumSubject(lib, a)));
        // hidden albums only turn up when nothing else matches
        const shown = found.filter((a) => !(a as { hidden?: boolean }).hidden);
        return byDate(shown.length ? shown : found);
      })() : null,
      singles: ok('singles') ? byDate(lib.singles.filter((t) => has(`${t.title} ${t.artistName}`) && matchesAll(chips, trackSubject(lib, t)))) : null,
      tracks: ok('tracks') ? lib.tracks.filter((t) => has(`${t.title} ${t.artistName} ${t.albumTitle ?? ''}`) && matchesAll(chips, trackSubject(lib, t))).sort((a, b) => b.effectiveRating - a.effectiveRating) : null,
      eras: ok('eras') ? lib.eras.filter((e) => has(e.name) && matchesAll(chips, eraSubject(lib, e))).sort((a, b) => a.name.localeCompare(b.name)) : null,
    };
  }, [lib, q, chips]);

  const where = (k: SearchKind) => searchHref({ q, chips, kind: k });
  const count = (k: SearchKind) => (k === 'all' ? null : results[k]?.length ?? null);
  const only = kind !== 'all';
  const cap = <T,>(xs: T[], k: Exclude<SearchKind, 'all'>) => (only && kind === k ? xs.slice(0, shown) : xs.slice(0, k === 'tracks' ? CHUNK : GLANCE));
  const visible = (k: Exclude<SearchKind, 'all'>) => results[k] !== null && (kind === 'all' || kind === k) && (results[k]!.length > 0 || kind === k);
  const total = kind === 'all' ? (['artists', 'albums', 'singles', 'tracks', 'eras'] as const).reduce((n, k) => n + (results[k]?.length ?? 0), 0) : results[kind]?.length ?? 0;
  const heading = (k: Exclude<SearchKind, 'all'>) => (kind === 'all'
    ? <h2 className="mb-2 font-semibold"><Link to={where(k)} className="hover:underline">{LABEL[k]}</Link> <span className="text-sm font-normal text-muted">{results[k]!.length}</span></h2> : null);
  const more = (k: Exclude<SearchKind, 'all'>) => (kind === 'all' && results[k]!.length > (k === 'tracks' ? CHUNK : GLANCE)
    ? <Link to={where(k)} className="mt-2 inline-block text-sm text-accent hover:underline">See all {results[k]!.length}</Link>
    : kind === k && shown < results[k]!.length ? <div ref={sentinel} className="mt-4 text-center"><button className="btn" onClick={() => setShown(shown + CHUNK)}>Show more ({results[k]!.length - shown} left)</button></div> : null);

  return (
    <div className="space-y-6">
      {menu.element}
      <div>
        <h1 className="text-2xl font-bold">Search</h1>
        <p className="text-sm text-muted">{chips.length || q ? `${total} result${total === 1 ? '' : 's'}` : 'Type in the search bar above, or add a filter such as artist: or era:.'}</p>
      </div>
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="What to list">
        {SEARCH_KINDS.map((k) => {
          const n = count(k);
          return <button key={k} role="tab" aria-selected={kind === k} disabled={n === null && k !== 'all'} title={n === null && k !== 'all' ? 'One of the filters does not apply to this' : undefined}
            className={cn('btn !py-1', kind === k && 'btn-accent')} onClick={() => { setShown(CHUNK); nav(where(k), { replace: true }); }}>{LABEL[k]}{n !== null && <span className="ml-1 text-xs opacity-70">{n}</span>}</button>;
        })}
      </div>
      {visible('artists') && <section>{heading('artists')}<div className="flex flex-wrap gap-3">{cap(results.artists!, 'artists').map((a) => (
        <Link key={a.id} to={`/artists/${a.id}`} className="card flex w-48 items-center gap-3 p-2" onContextMenu={(e) => menu.onContextMenu(artistItems(a.id), `Actions for ${a.name}`, a.id)(e)}><Cover kind="artist" hash={a.image} seed={a.name} className="w-10" /><span className="truncate text-sm">{a.name}</span></Link>))}</div>{more('artists')}</section>}
      {visible('albums') && <section>{heading('albums')}
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(var(--grid-min), 1fr))' }}>
          {cap(results.albums!, 'albums').map((a: Library['albums'][number]) => (
            <div key={a.id} className="bt-tile" onContextMenu={(e) => menu.onContextMenu(albumItems(a), `Actions for ${a.title}`, a.id)(e)}><Link to={`/albums/${a.id}`} className="block"><Cover hash={a.cover} seed={a.title} /><div className="bt-cap-t mt-2 truncate text-sm font-medium">{a.title}</div></Link>
              <div className="bt-cap truncate text-xs text-muted"><ArtistLinks leads={a.leads} /></div></div>))}
        </div>{more('albums')}</section>}
      {visible('singles') && <section>{heading('singles')}<SingleGrid tracks={cap(results.singles!, 'singles')} />{more('singles')}</section>}
      {visible('eras') && <section>{heading('eras')}<div className="flex flex-wrap gap-3">{cap(results.eras!, 'eras').map((e) => (
        <Link key={e.id} to={`/eras/${e.id}`} className="card flex w-56 items-center gap-3 p-2"><Cover hash={e.cover} seed={e.name} className="w-10" /><span className="flex min-w-0 items-center gap-1.5 truncate text-sm"><Layers size={13} className="shrink-0 text-muted" />{e.name}</span></Link>))}</div>{more('eras')}</section>}
      {visible('tracks') && <section>{heading('tracks')}<div className="card overflow-hidden"><TrackTable tracks={cap(results.tracks!, 'tracks')} queue={results.tracks!} source="search" sourceId="Search results" covers keepQueue={!searchPlaysAll} /></div>{more('tracks')}</section>}
      {(chips.length > 0 || q) && total === 0 && <p className="text-muted">Nothing matches.</p>}
    </div>
  );
}
