import { useState } from 'react';
import { MessageSquarePlus, Pencil } from 'lucide-react';
import { useStore } from '../lib/store.ts';

export function withoutKey(notes: Record<string, string> | undefined, key: string): Record<string, string> {
  const { [key]: _gone, ...rest } = notes ?? {};
  return rest;
}

/** "Playlist note": why this track is in this playlist, written under its row. Empty notes show a quiet prompt on hover. */
export function PlaylistNote({ playlistId, trackId, notes, field = 'trackNotes' }: { playlistId: string; trackId: string; notes: Record<string, string> | undefined; /** where the notes live on the playlist: per track, or per album in an album playlist */ field?: 'trackNotes' | 'albumNotes' }) {
  const patch = useStore((s) => s.patch);
  const text = notes?.[trackId] ?? '';
  const [draft, setDraft] = useState<string | null>(null);
  const save = (v: string) => {
    const t = v.trim();
    if (t !== text) patch('playlists', playlistId, { [field]: t ? { ...(notes ?? {}), [trackId]: t } : withoutKey(notes, trackId) });
    setDraft(null);
  };
  if (draft !== null) {
    return (
      <div className="px-3 pb-2 pl-12">
        <textarea autoFocus className="input min-h-16 w-full text-sm" placeholder="Why is this song in the playlist? A memory, a mood, what to listen for…" value={draft} onChange={(e) => setDraft(e.target.value)}
          onBlur={() => save(draft)} onKeyDown={(e) => { if (e.key === 'Escape') setDraft(null); else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save(draft); }} />
        <div className="mt-0.5 text-[11px] text-muted">Click away or press Ctrl+Enter to save, Esc to cancel.</div>
      </div>
    );
  }
  return text ? (
    <button type="button" className="group/note flex w-full items-start gap-2 px-3 pb-2 pl-12 text-left text-xs italic text-muted hover:text-fg" onClick={() => setDraft(text)} aria-label="Edit playlist note">
      <span className="whitespace-pre-wrap">{text}</span><Pencil size={11} className="mt-0.5 shrink-0 opacity-0 group-hover/note:opacity-100" />
    </button>
  ) : (
    <button type="button" className="flex items-center gap-1.5 px-3 pb-1.5 pl-12 text-[11px] text-muted/70 opacity-60 hover:text-fg hover:opacity-100 focus-visible:opacity-100" onClick={() => setDraft('')}><MessageSquarePlus size={12} />Playlist note</button>
  );
}
