import { create } from 'zustand';
import { api, useStore } from './store.ts';
import type { SpotifyPlayerInfo } from './api.ts';
import { spotifyTrackId } from './spotify.ts';
import { setBeamErrorListener, startBeam, stopBeam } from './beam.ts';

/**
 * Plays tracks that have a Spotify link but no audio file by telling a Spotify Connect device (Soloist on the Pi, the phone's Spotify app,
 * the PC app) what to play, through the server's Spotify account (server/src/spotify.ts). Spotify keeps the audio: TurboMusic cannot equalise it,
 * keep it offline or put it on the Android notification; TurboMusic's own queue and playback rules still decide what comes next, because a
 * track is sent on its own and the next one is sent when it ends. The player (lib/player.ts) treats it as a third engine next to the
 * page's <audio> and the Android app's player.
 */
interface LinkState { signedIn: boolean | null; error: string | null; lastState: SpotifyPlayerInfo | null }
export const useSpotifyLink = create<LinkState>(() => ({ signedIn: null, error: null, lastState: null }));

/**
 * Make a Spotify device the one Spotify tracks play on (this device's choice). When a Spotify track is playing right now it moves there
 * with the playback, so picking a device in the list behaves like Spotify Connect.
 */
export async function chooseSpotifyDevice(d: { id: string; name: string }): Promise<void> {
  const st = useStore.getState();
  const was = st.settings.spotifyDeviceId;
  st.updateSettings({ spotifyDeviceId: d.id, spotifyDeviceName: d.name });
  if (spotifyEngine.active() && was !== d.id) await api().spotifyCommand('transfer', d.id);
}

export const spotifyUriOf = (t: { spotifyUrl?: string | null }): string | null => { const id = spotifyTrackId(t.spotifyUrl); return id ? `spotify:track:${id}` : null; };

export async function refreshSpotifyStatus(): Promise<boolean> {
  if (!useStore.getState().settings.token) { useSpotifyLink.setState({ signedIn: false }); return false; }
  try { const s = await api().spotifyStatus(); useSpotifyLink.setState({ signedIn: s.signedIn }); return s.signedIn; }
  catch { useSpotifyLink.setState({ signedIn: false }); return false; }
}

/** Something the player can start: an audio file, or a Spotify link that Spotify can play. */
export const canPlay = (t: { file?: string | null; spotifyUrl?: string | null } | undefined | null): boolean => !!t && (!!t.file || spotifyCan(t));

/** Can this track be played through Spotify right now? (account signed in on the server, a device chosen on this device, the setting on) */
export function spotifyCan(t: { file?: string | null; spotifyUrl?: string | null } | undefined | null): boolean {
  if (!t || t.file) return false;
  const s = useStore.getState().settings;
  return !!(s.spotifyAuto && s.spotifyDeviceId && useSpotifyLink.getState().signedIn && spotifyUriOf(t));
}

type Report = { playing: boolean; timeMs: number; durationMs: number; ended: boolean };
let uri: string | null = null;
let timer: ReturnType<typeof setInterval> | undefined;
let onReport: (r: Report) => void = () => {};
let lastProgress = 0, lastDuration = 0, lastAt = 0, playingNow = false, startedAt = 0;

const device = () => useStore.getState().settings.spotifyDeviceId;
const fail = (e: unknown) => useSpotifyLink.setState({ error: (e as Error).message });
setBeamErrorListener((m) => useSpotifyLink.setState({ error: m }));

/** Where the song should be by now, by the clock since the last report (a poll can fall seconds before the end, so the last reported position alone looks unfinished). */
const expectedMs = () => (playingNow ? lastProgress + (Date.now() - lastAt) : lastProgress);
let pollQuick = 0;

async function poll() {
  if (!uri) return;
  try {
    const st = await api().spotifyPlayerState();
    const s = st.state;
    useSpotifyLink.setState({ lastState: s, error: null });
    const mine = s?.track?.uri === uri;
    const nearEnd = lastDuration > 0 && expectedMs() >= lastDuration - 8000;
    if (mine && s) {
      // Spotify keeps the last song loaded but paused (at the start or at the very end) when nothing is queued behind it: that is the end of the song too
      const stoppedAtEnd = !s.playing && playingNow && nearEnd && (s.progressMs <= 1500 || s.progressMs >= s.track!.durationMs - 2000);
      if (stoppedAtEnd && Date.now() - startedAt > 6000) { stopPolling(); uri = null; onReport({ playing: false, timeMs: 0, durationMs: 0, ended: true }); return; }
      lastProgress = s.progressMs; lastDuration = s.track!.durationMs; lastAt = Date.now(); playingNow = s.playing;
      onReport({ playing: s.playing, timeMs: s.progressMs, durationMs: lastDuration, ended: false });
    } else if (Date.now() - startedAt > 6000) {
      // another track (or nothing) is playing now: ours finished if it had got to the end, else something else took over
      const finished = nearEnd;
      stopPolling(); uri = null;
      onReport({ playing: false, timeMs: 0, durationMs: 0, ended: finished });
    }
  } catch (e) { fail(e); }
}
function stopPolling() { if (timer) { clearInterval(timer); timer = undefined; } }

/** between polls the position moves on by the clock */
let tick: ReturnType<typeof setInterval> | undefined;
function startTicking() {
  clearInterval(tick);
  tick = setInterval(() => {
    // the clock says the song is over: ask Spotify now instead of waiting for the next poll, so the next song starts without a gap
    if (uri && playingNow && lastDuration > 0 && expectedMs() >= lastDuration - 200 && Date.now() - pollQuick > 1500) { pollQuick = Date.now(); void poll(); }
    if (uri && playingNow) onReport({ playing: true, timeMs: Math.min(lastDuration || Infinity, lastProgress + (Date.now() - lastAt)), durationMs: lastDuration, ended: false });
  }, 500);
}

export const spotifyEngine = {
  active: () => uri !== null,
  setListener(f: (r: Report) => void) { onReport = f; },
  async play(trackUri: string, positionMs = 0, start = true): Promise<void> {
    uri = trackUri; lastProgress = positionMs; lastDuration = 0; lastAt = Date.now(); playingNow = start; startedAt = Date.now();
    try {
      await api().spotifyPlay([trackUri], device(), positionMs);
      // another engine may have taken over while this request was in flight (release() clears `uri`): the beam must not start then, or it
      // would carry the silent mirror's sound and the song would play twice
      if (uri !== trackUri) return;
      if (!start) await api().spotifyCommand('pause', device());
      else void startBeam(); // the server's Soloist beams its sound: hear it on this device
      useSpotifyLink.setState({ error: null });
    } catch (e) { uri = null; fail(e); throw e; }
    stopPolling(); timer = setInterval(() => void poll(), 2500); startTicking();
    setTimeout(() => void poll(), 800);
  },
  async pause() { playingNow = false; stopBeam(); try { await api().spotifyCommand('pause', device()); } catch (e) { fail(e); } },
  async resume() { playingNow = true; lastAt = Date.now(); const mine = uri; try { await api().spotifyCommand('resume', device()); if (uri === mine && uri !== null) void startBeam(); } catch (e) { fail(e); } },
  async seek(ms: number) { lastProgress = ms; lastAt = Date.now(); try { await api().spotifyCommand('seek', device(), ms); } catch (e) { fail(e); } },
  async volume(v: number) { try { await api().spotifyCommand('volume', device(), Math.round(v * 100)); } catch { /* some devices have fixed volume */ } },
  /** leave Spotify alone from now on (another engine takes over); pauses it if TurboMusic started it */
  async release(pause = true) { const was = uri; uri = null; stopBeam(); stopPolling(); clearInterval(tick); if (was && pause) { try { await api().spotifyCommand('pause', device()); } catch { /* already stopped */ } } },
};
