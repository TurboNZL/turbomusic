import { create } from 'zustand';
import { cacheMatches, cachedMatches, forgetMatches, prefetchMatches } from './matchCache.ts';
import { getLibrary } from './derive.ts';
import { useEditor } from './editor.ts';
import { useStore } from './store.ts';

/**
 * A YouTube Music album search that runs in the background. It shows as a toast (`ImportToasts`) that you can open when you like and
 * leave alone while the page changes: nothing here opens a dialog by itself, and the answer is kept so opening it later needs no new search.
 */
export interface ImportJob {
  id: string;            // the album id (one job per album)
  title: string;
  status: 'searching' | 'ready' | 'empty' | 'failed';
  startedAt: number;
  count?: number;
  error?: string;
}

export const useImportJobs = create<{ jobs: ImportJob[] }>(() => ({ jobs: [] }));
const setJob = (id: string, patch: Partial<ImportJob>) => useImportJobs.setState((s) => ({ jobs: s.jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)) }));
export const dismissImportJob = (id: string) => useImportJobs.setState((s) => ({ jobs: s.jobs.filter((j) => j.id !== id) }));

/** Albums whose search is running (the album page shows a spinner). */
export const useImportSearching = <T,>(pick: (s: { ids: ReadonlySet<string> }) => T): T =>
  useImportJobs((s) => pick({ ids: new Set(s.jobs.filter((j) => j.status === 'searching').map((j) => j.id)) }));

const openDialog = (albumId: string) => useEditor.getState().open({ kind: 'import-into-album', id: albumId });

/** The toast's Open button: the finished search (kept for a week) is in the import screen at once. */
export function openImportJob(albumId: string) { dismissImportJob(albumId); openDialog(albumId); }

/**
 * "Import a release from YouTube Music" for an album. With an answer already kept, the import screen opens at once; otherwise the search
 * starts in the background and a toast reports it. Without a server there is nothing to search, so the screen opens to let a link be pasted.
 */
export async function startImportSearch(albumId: string, fresh = false): Promise<void> {
  const lib = getLibrary();
  const album = lib.albumById.get(albumId);
  const running = useImportJobs.getState().jobs.find((j) => j.id === albumId && j.status === 'searching');
  if (running) return;
  if (!album || !useStore.getState().settings.token || (!fresh && cachedMatches(albumId))) { openDialog(albumId); return; }
  if (fresh) forgetMatches(albumId);
  useImportJobs.setState((s) => ({ jobs: [...s.jobs.filter((j) => j.id !== albumId), { id: albumId, title: album.title, status: 'searching', startedAt: Date.now() }] }));
  try {
    await prefetchMatches(lib, [album]);
    const found = cachedMatches(albumId);
    if (!found) cacheMatches(albumId, []); // "nothing found" is an answer too: the screen then does not search a second time
    setJob(albumId, found?.length ? { status: 'ready', count: found.length } : { status: 'empty', count: 0 });
  } catch (e) {
    setJob(albumId, { status: 'failed', error: e instanceof Error ? e.message : String(e) });
  }
}

/** Kept under its old name for the places that already call it. */
export const openImportIntoAlbum = (albumId: string) => startImportSearch(albumId);
