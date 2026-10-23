import { api, useStore } from './store.ts';
import { getLibrary } from './derive.ts';
import { usePlayer } from './player.ts';
import { useSpotifyLink, spotifyUriOf, spotifyEngine } from './spotifyPlayer.ts';
import { refreshSoloistInfo } from './beam.ts';
import { mirrorWanted } from './spotifyMirrorPure.ts';

/**
 * Silent mirror: while a track plays from its audio file here, the server's Soloist plays the same song on Spotify so the stream is counted
 * on the account (Wrapped, listening history). Soloist's sound goes to the virtual output that nobody listens to (the beam is simply not
 * started), so nothing is heard from it. Only done when the chosen Spotify device IS that Soloist with the beam on: any other device would
 * play the mirrored song out loud. Spotify counts a stream after about 30 s; skipping before that mirrors nothing worth counting, so the
 * start is delayed a little. Tracks without a Spotify link are skipped. This is an opt-in (Settings > Spotify > Soloist): Spotify's terms
 * do not allow artificially inflating streams, and an account can be flagged for it.
 */
export const MIRROR_DELAY_MS = 4000;
let mirrored: string | null = null; // the Spotify uri the mirror is playing (or paused on)
let running = false;
let timer: ReturnType<typeof setTimeout> | undefined;

async function silentDevice(): Promise<boolean> {
  const s = useStore.getState().settings;
  if (!s.spotifyMirror || !s.token || !s.spotifyDeviceId) return false;
  const b = await refreshSoloistInfo();
  return b.enabled && b.deviceName !== '' && s.spotifyDeviceName === b.deviceName;
}

async function apply() {
  const st = useStore.getState().settings;
  const p = usePlayer.getState();
  const track = p.queue.currentId ? getLibrary().trackById.get(p.queue.currentId) : undefined;
  const uri = track ? spotifyUriOf(track) : null;
  const want = mirrorWanted({ enabled: st.spotifyMirror, engine: p.engine, playing: p.playing, loading: p.loading, hasFile: !!track?.file, uri, signedIn: useSpotifyLink.getState().signedIn, silent: st.spotifyMirror ? await silentDevice() : false });
  const device = st.spotifyDeviceId;
  try {
    if (!want || !uri) {
      if (running) { running = false; await api().spotifyCommand('pause', device); }
      return;
    }
    if (mirrored === uri && running) return;
    if (mirrored === uri) { running = true; await api().spotifyCommand('resume', device); return; }
    mirrored = uri; running = true;
    await api().spotifyPlay([uri], device, Math.round(p.time * 1000));
  } catch { running = false; mirrored = null; /* the next change tries again */ }
}

function schedule() {
  clearTimeout(timer);
  const p = usePlayer.getState();
  // a new song waits a few seconds so skipping through a list does not hammer Spotify
  timer = setTimeout(() => void apply(), p.playing ? MIRROR_DELAY_MS : 0);
}

/** Called once at start-up. */
export function startSpotifyMirror(): void {
  let key = '';
  usePlayer.subscribe((s) => {
    const k = `${s.queue.currentId}|${s.playing}|${s.loading}|${s.engine}`;
    if (k === key) return; key = k;
    if (s.queue.currentId && mirrored && s.queue.currentId !== undefined) {
      // another song: the old mirror must not keep counting
      const t = getLibrary().trackById.get(s.queue.currentId);
      if (spotifyUriOf(t ?? {}) !== mirrored) { running = false; mirrored = null; }
    }
    if (spotifyEngine.active()) return;
    schedule();
  });
}
