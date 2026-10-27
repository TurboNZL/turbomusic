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

/**
 * The Spotify device id of the server's Soloist, found by its name. The mirror depends only on the switch in Settings and on Soloist
 * running with its beam on: not on which device this app has chosen for Spotify, so "Play on this device only" or disconnecting
 * every device does not stop it.
 */
let soloistId: { name: string; id: string; at: number } | null = null;
async function silentDevice(): Promise<string | null> {
  const s = useStore.getState().settings;
  if (!s.spotifyMirror || !s.token) return null;
  const b = await refreshSoloistInfo();
  if (!b.enabled || b.deviceName === '') return null;
  if (soloistId && soloistId.name === b.deviceName && Date.now() - soloistId.at < 60_000) return soloistId.id;
  try {
    const d = (await api().spotifyDevices()).devices.find((x) => x.name === b.deviceName && x.id);
    if (!d) return null;
    soloistId = { name: b.deviceName, id: d.id, at: Date.now() };
    return d.id;
  } catch { return null; }
}

async function apply() {
  const st = useStore.getState().settings;
  const p = usePlayer.getState();
  const track = p.queue.currentId ? getLibrary().trackById.get(p.queue.currentId) : undefined;
  const uri = track ? spotifyUriOf(track) : null;
  const device = st.spotifyMirror ? await silentDevice() : null;
  const want = mirrorWanted({ enabled: st.spotifyMirror, engine: p.engine, playing: p.playing, loading: p.loading, hasFile: !!track?.file, uri, signedIn: useSpotifyLink.getState().signedIn, silent: !!device });
  try {
    if (!want || !uri) {
      if (running) { running = false; await api().spotifyCommand('pause', device ?? soloistId?.id ?? ''); }
      return;
    }
    if (mirrored === uri && running) return;
    if (mirrored === uri) { running = true; await api().spotifyCommand('resume', device!); return; }
    mirrored = uri; running = true;
    await api().spotifyPlay([uri], device!, Math.round(p.time * 1000));
  } catch { running = false; mirrored = null; /* the next change tries again */ }
}

function schedule() {
  clearTimeout(timer);
  const p = usePlayer.getState();
  // a new song waits a few seconds so skipping through a list does not hammer Spotify
  timer = setTimeout(() => void apply(), p.playing ? MIRROR_DELAY_MS : 0);
}

/** Something else may have paused or moved Soloist (disconnecting devices): forget what the mirror believes and let it start again. */
export function resyncMirror(): void { running = false; mirrored = null; schedule(); }

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
