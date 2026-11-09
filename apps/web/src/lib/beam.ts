import { api, useStore } from './store.ts';
import { nativeAudio, nativeAudioAvailable } from './nativeAudio.ts';

/**
 * Hearing Soloist on this device. Soloist can only play on the machine it runs on (the Pi). With "Send the sound to the apps" on, the
 * server captures Soloist's output and streams it as live MP3 (server/src/beam.ts, `GET /api/soloist/stream`); this plays that stream
 * whenever the Spotify device is that Soloist: in the Android app through the app's own player (notification, lock screen, keeps playing
 * with the screen off), elsewhere in an <audio> element. The stream is live: a few seconds behind Spotify's own clock, and a pause
 * stops it (it starts again on resume, so old buffered sound is never played).
 */
export const BEAM_ID = 'spotify-beam';

let cached: { at: number; enabled: boolean; deviceName: string; host: string } | null = null;
async function soloistBeam(): Promise<{ enabled: boolean; deviceName: string; host: string }> {
  if (cached && Date.now() - cached.at < 20_000) return cached;
  try { const i = await api().soloist(); cached = { at: Date.now(), enabled: !!i.beam?.enabled && i.running, deviceName: i.deviceName, host: i.supported ? i.host.name : '' }; }
  catch { cached = { at: Date.now(), enabled: false, deviceName: '', host: '' }; }
  return cached;
}
/** What was last learned about the server's Soloist (its Spotify name and the machine it runs on), for labels. Filled by `refreshSoloistInfo`. */
export const peekSoloist = () => cached;
export const refreshSoloistInfo = () => soloistBeam();
export const forgetBeamInfo = () => { cached = null; };

/** Is the Spotify device of this app the server's Soloist, and is it beaming? */
export async function shouldBeam(): Promise<boolean> {
  const s = useStore.getState().settings;
  if (!s.spotifyBeam || !s.token || !s.spotifyDeviceId) return false;
  const b = await soloistBeam();
  return b.enabled && b.deviceName !== '' && s.spotifyDeviceName === b.deviceName;
}

let mode: 'none' | 'native' | 'audio' = 'none';
/** the person wants to hear the stream (Spotify is playing on the server's Soloist): a stream that dies is then started again, not left silent */
let wanted = false;
let retries = 0, retryTimer: ReturnType<typeof setTimeout> | undefined, watchdog: ReturnType<typeof setInterval> | undefined;
let lastTime = -1, stuckSince = 0, nativeIdleSince = 0;
let el: HTMLAudioElement | null = null;
let onError: (message: string) => void = () => {};
export const setBeamErrorListener = (f: (message: string) => void) => { onError = f; };

export const beamActive = () => mode !== 'none';

/** Start playing the stream (does nothing when it already plays, or when this device should not beam). */
export async function startBeam(): Promise<boolean> {
  wanted = true;
  if (mode !== 'none') {
    // "already playing" is only true while the stream really flows: a live stream that ended (the connection dropped, ffmpeg restarted) must be started again
    if (streamLooksDead()) dropStream(); else return true;
  }
  if (!(await shouldBeam())) return false;
  if (mode !== 'none') return true; // started while we checked
  const url = api().beamUrl();
  const volume = Number(localStorage.getItem('turbomusic.volume') ?? 0.8);
  if (nativeAudioAvailable()) {
    mode = 'native';
    // a new key every time: a live stream is never the same bytes twice
    nativeAudio.sync({ currentId: BEAM_ID, positionMs: 0, play: true, hard: true, items: [{ id: BEAM_ID, key: `${BEAM_ID}-${Date.now()}`, url, title: 'Spotify', artist: 'through TurboMusic', album: '' }] });
    nativeAudio.volume(volume);
    return true;
  }
  mode = 'audio';
  el ??= new Audio();
  el.src = url; el.volume = volume;
  el.onerror = () => { if (mode === 'audio') retrySoon('error'); };
  el.onended = () => { if (mode === 'audio') retrySoon('ended'); }; // a live stream never ends by itself: the connection was cut
  startWatchdog();
  try { await el.play(); retries = 0; }
  catch (e) { mode = 'none'; onError((e as Error)?.name === 'NotAllowedError' ? 'The browser blocked starting the sound by itself: tap anywhere on the page, then press play.' : 'Could not play the sound stream from your server.'); return false; }
  return true;
}

function streamLooksDead(): boolean {
  if (mode === 'audio') return !el || el.ended || !!el.error || el.paused;
  return false; // the app's player reports its own trouble (beamNativeEvent)
}
/** stop the sound without forgetting that it is wanted */
function dropStream(): void {
  if (mode === 'native') nativeAudio.stop();
  else if (mode === 'audio' && el) { el.onerror = null; el.onended = null; el.pause(); el.removeAttribute('src'); el.load(); }
  mode = 'none';
}
/** Start the stream again after a short wait (longer each time, up to 8 s); gives up with a message after a few tries in a row. */
function retrySoon(why: string): void {
  if (!wanted || retryTimer) return;
  dropStream();
  if (retries >= 6) { wanted = false; stopWatchdog(); onError(`The sound stream from your server keeps stopping (${why}). Check Soloist in Settings > Spotify.`); return; }
  const wait = Math.min(8000, 700 * 2 ** retries++);
  retryTimer = setTimeout(() => { retryTimer = undefined; if (wanted) void startBeam(); }, wait);
}
/** Plays-but-silent check: the element says "playing" yet its clock has not moved for a while (a stalled connection that never closes). */
function startWatchdog(): void {
  if (watchdog) return;
  watchdog = setInterval(() => {
    if (!wanted) return;
    if (mode === 'audio' && el && !el.paused) {
      if (el.currentTime !== lastTime) { lastTime = el.currentTime; stuckSince = 0; retries = 0; }
      else if (!stuckSince) stuckSince = Date.now();
      else if (Date.now() - stuckSince > 9000) { stuckSince = 0; lastTime = -1; retrySoon('stalled'); }
    }
  }, 3000);
}
function stopWatchdog(): void { if (watchdog) clearInterval(watchdog); watchdog = undefined; lastTime = -1; stuckSince = 0; }

/** Events of the Android app's player about the stream: when it ends, errors or sits idle while Spotify plays, start it again. */
export function beamNativeEvent(e: { t: string; playing?: boolean; buffering?: boolean; message?: string }): void {
  if (mode !== 'native' || !wanted) return;
  if (e.t === 'ended') { retrySoon('ended'); return; }
  if (e.t === 'state') {
    if (e.playing || e.buffering) { nativeIdleSince = 0; retries = 0; return; }
    if (!nativeIdleSince) nativeIdleSince = Date.now();
    else if (Date.now() - nativeIdleSince > 6000) { nativeIdleSince = 0; retrySoon('idle'); }
  }
}

export function stopBeam(): void {
  wanted = false;
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = undefined; }
  retries = 0; stopWatchdog();
  dropStream();
}

export function setBeamVolume(v: number): void { if (el) el.volume = v; }

/** an error reported by the Android app's player about the stream */
export function beamFailed(message: string): void { if (mode === 'native') { if (wanted && retries < 6) retrySoon('error'); else { mode = 'none'; onError(`The sound stream from your server could not play (${message}).`); } } }
