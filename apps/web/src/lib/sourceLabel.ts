import type { Library } from './derive.ts';

/** What the "then, from…" part of the queue is playing from, in words ("Album: Abbey Road", "Playlist: Gym"), or null when it is nothing in particular. */
export function sourceLabel(lib: Library, source: { type: string; id: string | null }): { text: string; to: string | null } | null {
  const id = source.id;
  if (source.type === 'album' && id) { const a = lib.albumById.get(id); if (a) return { text: `Album: ${a.title}`, to: `/albums/${a.id}` }; }
  if (source.type === 'playlist' && id) {
    const p = lib.playlists.find((x) => x.id === id);
    if (p) return { text: `Playlist: ${p.name}`, to: `/playlists/${p.id}` };
  }
  if (source.type === 'shuffle') return { text: 'Shuffle', to: null };
  if (source.type === 'search') return { text: id || 'A list of tracks', to: null };
  return null;
}
