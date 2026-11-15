import { create } from 'zustand';
import { cachedMatches, prefetchMatches } from './matchCache.ts';
import { getLibrary } from './derive.ts';
import { useEditor } from './editor.ts';
import { useStore } from './store.ts';

/** Albums whose YouTube Music search is running because the user asked to import a release into them (their button shows a spinner meanwhile). */
export const useImportSearching = create<{ ids: ReadonlySet<string> }>(() => ({ ids: new Set() }));
const mark = (id: string, on: boolean) => useImportSearching.setState((s) => { const ids = new Set(s.ids); if (on) ids.add(id); else ids.delete(id); return { ids }; });

/**
 * "Import a release from YouTube Music": the search for the album runs first, with the button turning into a spinner, and the import
 * screen opens when the answer is in (before, a blocking dialog opened at once and the user waited inside it). A search that fails or has
 * no server just opens the screen, which shows the reason and lets the user type or paste something.
 */
export async function openImportIntoAlbum(albumId: string): Promise<void> {
  const open = () => useEditor.getState().open({ kind: 'import-into-album', id: albumId });
  const lib = getLibrary();
  const album = lib.albumById.get(albumId);
  if (!album || !useStore.getState().settings.token || cachedMatches(albumId) || useImportSearching.getState().ids.has(albumId)) { open(); return; }
  mark(albumId, true);
  try { await prefetchMatches(lib, [album]); } catch { /* the screen reports it */ }
  finally { mark(albumId, false); }
  open();
}
