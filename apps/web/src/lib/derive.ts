import { useMemo } from 'react';
import { buildLibrary, withLogs, type Library } from './library.ts';
import { useStore } from './store.ts';
import { useSpotifyLink } from './spotifyPlayer.ts';
import { withoutUnimported } from './unimported.ts';

export * from './library.ts';

let cache: { rev: number; logsRev: number; lib: Library } | null = null;

/** The derived library for the current data; rebuilt only when `rev` changes. A new play-history row only swaps the logs (cheap), so skipping through tracks never rebuilds it. */
export function getLibrary(): Library {
  const { rev, logsRev, rows } = useStore.getState();
  if (!cache || cache.rev !== rev) cache = { rev, logsRev, lib: buildLibrary(rows) };
  else if (cache.logsRev !== logsRev) cache = { rev, logsRev, lib: withLogs(cache.lib, rows) };
  return cache.lib;
}

function useSpotifyDeps() {
  // what can be played depends on Spotify being usable (signed in, a device chosen): pages that list tracks re-render when that changes
  useSpotifyLink((s) => s.signedIn);
  useStore((s) => `${s.settings.spotifyDeviceId}${s.settings.spotifyAuto}`);
}

/**
 * The derived library for a component. It does NOT re-render when only the play history changed (every play and skip writes a row,
 * and re-rendering a whole track list for that made starting a track feel slow); use `useLibraryLive` where the history is shown.
 * Tracks, albums and artists that have no source yet are left out of its lists (`all` includes them: the lists with a "Hidden" switch use it and filter themselves).
 */
export function useLibrary(all = false): Library {
  const rev = useStore((s) => s.rev);
  useSpotifyDeps();
  return useMemo(() => (all ? getLibrary() : withoutUnimported(getLibrary())), [rev, all]);
}

/** Like `useLibrary`, and also refreshes when a play is logged: for pages that show the listening history or statistics. */
export function useLibraryLive(all = false): Library {
  const rev = useStore((s) => s.rev);
  const logsRev = useStore((s) => s.logsRev);
  useSpotifyDeps();
  return useMemo(() => (all ? getLibrary() : withoutUnimported(getLibrary())), [rev, logsRev, all]);
}
