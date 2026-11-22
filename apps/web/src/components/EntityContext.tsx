import { useLibrary } from '../lib/derive.ts';
import { usePlayer } from '../lib/player.ts';
import { useMenu } from './Menu.tsx';
import { useTrackMenuItems } from './TrackMenu.tsx';
import { useAlbumMenuItems, useArtistMenuItems } from './entityMenus.tsx';

export type EntityRef = { kind: 'track' | 'album' | 'artist'; id: string };

/** The stats page address of a track, album or artist (`/stats/<kind>/<id>`) as an entity, else null. */
export function entityFromStatsPath(to?: string | null): EntityRef | null {
  const m = to?.match(/^\/stats\/(track|album|artist)\/([^/?#]+)/);
  return m ? { kind: m[1] as EntityRef['kind'], id: decodeURIComponent(m[2]) } : null;
}

/**
 * Right-click (or press and hold) on a track, album or artist anywhere in the stats pages opens the same menu as everywhere else.
 * `ctx(entity)` gives the onContextMenu handler (undefined when the thing is not in the library); render `element` once.
 */
export function useEntityContext() {
  const lib = useLibrary();
  const menu = useMenu();
  const trackItems = useTrackMenuItems(), albumItems = useAlbumMenuItems(), artistItems = useArtistMenuItems();
  const ctx = (e: EntityRef | null | undefined): ((ev: React.MouseEvent) => void) | undefined => {
    if (!e) return undefined;
    if (e.kind === 'track') { const t = lib.trackById.get(e.id); return t ? menu.onContextMenu(trackItems(t, () => usePlayer.getState().play(t.id, [t.id], { type: 'search', id: 'Stats' })), t.title) : undefined; }
    if (e.kind === 'album') { const a = lib.albumById.get(e.id); return a ? menu.onContextMenu(albumItems(a), a.title) : undefined; }
    const ar = lib.artistById.get(e.id); return ar ? menu.onContextMenu(artistItems(ar.id), ar.name) : undefined;
  };
  return { ctx, element: menu.element };
}
