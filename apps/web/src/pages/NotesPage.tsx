import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUp, ListMusic, Plus, Search } from 'lucide-react';
import { Select } from '../components/Select.tsx';
import { useLibrary } from '../lib/derive.ts';
import { useEditor } from '../lib/editor.ts';
import { cn } from '../lib/cn.ts';
import { NoteCard } from '../components/Notes.tsx';
import { resolveEntity } from '../lib/entities.ts';

/** Every note, with the user's own categories as filters. */
export function NotesPage() {
  const lib = useLibrary();
  const edit = useEditor((s) => s.open);
  const [cat, setCat] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'new' | 'title' | 'category' | 'links'>('new');
  const [flip, setFlip] = useState(false);
  const dirSign = ((sort === 'new' || sort === 'links') ? -1 : 1) * (flip ? -1 : 1);
  const notes = useMemo(() => {
    const n = q.trim().toLowerCase();
    return [...lib.groups]
      .filter((g) => (cat === null || (cat === '' ? !g.categoryId : g.categoryId === cat)))
      .filter((g) => !n || `${g.name} ${g.description ?? ''} ${g.members.map((m) => resolveEntity(lib, m.entityType, m.entityId)?.label ?? '').join(' ')}`.toLowerCase().includes(n))
      .sort((a, b) => {
        const cname = (x: typeof a) => lib.noteCategories.find((c) => c.id === x.categoryId)?.name ?? '';
        const base = sort === 'title' ? a.name.localeCompare(b.name) : sort === 'category' ? cname(a).localeCompare(cname(b)) : sort === 'links' ? a.members.length - b.members.length : (a.createdAt ?? 0) - (b.createdAt ?? 0);
        // newest and most-linked run biggest first, title and category A to Z; the arrow button flips whichever it is
        return base * dirSign || a.name.localeCompare(b.name);
      });
  }, [lib, cat, q, sort, dirSign]);
  // notes written on playlist rows ("why this song is here") are notes too: listed after the others, by playlist
  const playlistNotes = useMemo(() => {
    const n = q.trim().toLowerCase();
    return lib.playlists.flatMap((p) => [
      ...Object.entries(p.trackNotes ?? {}).flatMap(([id, text]) => { const t = lib.trackById.get(id); return t && text ? [{ key: `${p.id}t${id}`, playlistId: p.id, playlist: p.name, what: t.title, sub: t.artistName, text }] : []; }),
      ...Object.entries(p.albumNotes ?? {}).flatMap(([id, text]) => { const a = lib.albumById.get(id); return a && text ? [{ key: `${p.id}a${id}`, playlistId: p.id, playlist: p.name, what: a.title, sub: a.artistName, text }] : []; }),
    ]).filter((x) => !n || `${x.playlist} ${x.what} ${x.sub} ${x.text}`.toLowerCase().includes(n));
  }, [lib, q]);
  const used = lib.noteCategories.filter((c) => lib.groups.some((g) => g.categoryId === c.id));
  const chip = (on: boolean) => cn('rounded-full border px-3 py-1 text-sm', on ? 'border-accent text-accent' : 'border-line text-muted hover:text-fg');
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-2xl font-bold">Notes <span className="text-base font-normal text-muted">{lib.groups.length}</span></h1>
        <div className="relative"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" /><input className="input !w-56 pl-8" placeholder="Search notes" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <Select className="!w-44" aria-label="Sort by" value={sort} onChange={(v) => { setSort(v as typeof sort); setFlip(false); }} options={[{ value: 'new', label: 'Sort: Date written' }, { value: 'title', label: 'Sort: Title' }, { value: 'category', label: 'Sort: Category' }, { value: 'links', label: 'Sort: Most linked things' }]} />
        <button type="button" className="btn !px-2.5" onClick={() => setFlip(!flip)} aria-label={dirSign > 0 ? 'Ascending: switch to descending' : 'Descending: switch to ascending'} title={dirSign > 0 ? 'Ascending' : 'Descending'}>{dirSign > 0 ? <ArrowUp size={15} /> : <ArrowDown size={15} />}</button>
        <button className="btn btn-accent" onClick={() => edit({ kind: 'new-note', id: '' })}><Plus size={15} />New note</button></div>
      {used.length > 0 && <div className="flex flex-wrap gap-2" role="group" aria-label="Category">
        <button className={chip(cat === null)} aria-pressed={cat === null} onClick={() => setCat(null)}>All</button>
        {used.map((c) => <button key={c.id} className={chip(cat === c.id)} aria-pressed={cat === c.id} onClick={() => setCat(c.id)}>{c.name}</button>)}
        {lib.groups.some((g) => !g.categoryId) && <button className={chip(cat === '')} aria-pressed={cat === ''} onClick={() => setCat('')}>No category</button>}
      </div>}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{notes.map((g) => <NoteCard key={g.id} lib={lib} note={g} />)}</div>
      {playlistNotes.length > 0 && <section className="space-y-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold"><ListMusic size={17} className="text-accent" />Playlist notes <span className="text-sm font-normal text-muted">{playlistNotes.length}</span></h2>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{playlistNotes.map((x) => (
          <Link key={x.key} to={`/playlists/${x.playlistId}`} className="card block space-y-1 p-4 hover:bg-raised/50">
            <div className="truncate text-xs uppercase tracking-wider text-muted">{x.playlist}</div>
            <div className="truncate font-medium">{x.what}<span className="text-sm font-normal text-muted"> · {x.sub}</span></div>
            <p className="line-clamp-4 whitespace-pre-wrap text-sm italic text-muted">{x.text}</p></Link>))}</div></section>}
      {!notes.length && !playlistNotes.length && <p className="text-sm text-muted">{lib.groups.length ? 'No note matches.' : 'No notes yet. Write one here, or with the + on an artist, album, track or era page. Every note is tied to at least one thing.'}</p>}
    </div>
  );
}
