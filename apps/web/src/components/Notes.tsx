import { Link } from 'react-router-dom';
import { Disc3, ListMusic, Layers, Music2, Pencil, Plus, User } from 'lucide-react';
import { notesFor, resolveEntity, type EntityType } from '../lib/entities.ts';
import type { Library } from '../lib/derive.ts';
import { useEditor } from '../lib/editor.ts';
import { NoteText } from './NoteText.tsx';

/** a note longer than this is cut off in cards; its page shows all of it */
export const CARD_CLAMP_CHARS = 240;

export const ENTITY_ICON = { artist: User, album: Disc3, track: Music2, release: Disc3, era: Layers, playlist: ListMusic } as const;

/** One note as a card: category, title, text and the other things it is tied to. `from` is the page it is shown on (hidden from its links). */
export function NoteCard({ lib, note, from }: { lib: Library; note: Library['groups'][number]; from?: { type: EntityType; id: string } }) {
  const edit = useEditor((s) => s.open);
  const category = note.categoryId ? lib.noteCategories.find((c) => c.id === note.categoryId) : undefined;
  return (
    <div className="card min-w-0 space-y-2 p-4">
      <div className="flex items-start justify-between gap-2"><h3 className="min-w-0 font-semibold"><Link to={`/notes/${note.id}`} className="break-words hover:underline" title="Open the note">{note.name}</Link></h3>
        <button className="text-muted hover:text-fg" aria-label={`Edit ${note.name}`} onClick={() => edit({ kind: 'note', id: note.id })}><Pencil size={14} /></button></div>
      {category && <span className="chip">{category.name}</span>}
      {note.description && <>
        <p className="line-clamp-4 whitespace-pre-line break-words text-sm text-muted"><NoteText lib={lib} text={note.description} /></p>
        {note.description.length > CARD_CLAMP_CHARS || note.description.split('\n').length > 4 ? <Link to={`/notes/${note.id}`} className="text-xs text-accent hover:underline">Read the whole note</Link> : null}</>}
      <div className="flex flex-wrap gap-1.5 pt-1">{note.members.filter((m) => !(from && m.entityType === from.type && m.entityId === from.id)).map((m, i) => {
        const r = resolveEntity(lib, m.entityType, m.entityId);
        if (!r) return null;
        const Icon = ENTITY_ICON[r.type];
        const body = <><Icon size={11} />{r.label}</>;
        return r.to ? <Link key={i} to={r.to} className="chip gap-1 hover:text-fg">{body}</Link> : <span key={i} className="chip gap-1">{body}</span>;
      })}</div>
    </div>
  );
}

/** The notes tied to an entity, with a + to write a new one that is already linked to it. */
export function Notes({ lib, type, id }: { lib: Library; type: EntityType; id: string }) {
  const edit = useEditor((s) => s.open);
  const notes = notesFor(lib, type, id);
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2"><h2 className="text-lg font-semibold">Notes</h2>
        <button className="btn btn-ghost !p-1.5" aria-label="New note" onClick={() => edit({ kind: 'new-note', id: `${type}:${id}` })}><Plus size={16} /></button></div>
      {!notes.length && <p className="text-sm text-muted">No notes yet.</p>}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-1">{notes.map((n) => <NoteCard key={n.id} lib={lib} note={n} from={{ type, id }} />)}</div>
    </section>
  );
}
