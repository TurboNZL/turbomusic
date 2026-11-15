import type { ReleaseData } from '@turbomusic/core';
import type { Library, Track } from './library.ts';
import { api, useStore } from './store.ts';

/**
 * "Make a single release": a track on an album gets a release of its own (titled like the track, holding just it) in that album, so the
 * single's own cover and date can live next to the album's releases. Its date is the track's own date when it has one, else the first
 * exact answer of the date lookup (Spotify, iTunes, MusicBrainz); a failed lookup leaves the date empty for the editor.
 * Returns the new release's id, or null when the track is on no album.
 */
export async function makeSingleRelease(lib: Library, t: Track): Promise<string | null> {
  if (!t.albumId || !lib.albumById.has(t.albumId)) return null;
  const store = useStore.getState();
  const raw = store.rows.tracks.get(t.id)?.data as { releaseDate?: string | null; cover?: string | null } | undefined;
  let releaseDate = raw?.releaseDate ?? null;
  const artist = t.leads[0]?.name;
  if (!releaseDate && artist && store.settings.token) {
    try {
      const { results } = await api().releaseDates([{ id: 'single', album: t.title, artist }]);
      releaseDate = results[0]?.answer?.date ?? null;
    } catch { /* the editor opens with an empty date and the user can look it up there */ }
  }
  const release: ReleaseData = { albumId: t.albumId, title: t.title, cover: raw?.cover ?? null, releaseDate, trackIds: [t.id] };
  return store.put('releases', release);
}
