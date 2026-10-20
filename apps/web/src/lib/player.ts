import { PlayLog } from './playLog.ts';
import { create } from 'zustand';
import { advance, crossfadeFor, crossfadeShiftFor, newId, pushHistory, type PlaybackSnapshot, shuffleWithRules, startTrack, type PlaybackLogData, type QueueState, type SourceType } from '@turbomusic/core';
import { moveTrack } from './defaults.ts';
import { audioSource, cancelPrefetch, imageSource, localAudio, prefetchAudio, streamUrl } from './files.ts';
import { nativeAudio, nativeAudioAvailable, type NativeEvent, type NativeItem } from './nativeAudio.ts';
import { BEAM_ID, beamActive, beamFailed, setBeamVolume } from './beam.ts';
import { getLibrary } from './derive.ts';
import { useStore } from './store.ts';
import { addEqElement, resumeEq, setEq } from './eq.ts';
import { clampShift, fadeDelayMs, fadeGains, fadeLength, shouldPrepare } from './crossfadeMath.ts';
import { eqConfig } from './eqConfig.ts';
import { isFlat } from './eqPresets.ts';
import { refreshSpotifyStatus, spotifyCan, spotifyEngine, spotifyUriOf } from './spotifyPlayer.ts';

interface Source { type: SourceType; id: string | null }

interface PlayerState {
  queue: QueueState;
  history: string[];
  source: Source;
  playing: boolean;
  time: number;
  duration: number;
  volume: number;
  /** which engine plays the current track: the page's <audio>, the Android app's player, or a Spotify device */
  engine: 'web' | 'native' | 'spotify';
  /** shown when the current track has no audio file or failed to load */
  error: string | null;
  /** the chosen track is not making sound yet (fetching, or stalled to buffer): the play button shows a spinner */
  loading: boolean;
  play(trackId: string, list: string[], source?: Source): void;
  toggle(): void;
  /** pause without losing the position (a ranking preview does this) */
  pause(): void;
  next(): void;
  prev(): void;
  seek(t: number): void;
  setVolume(v: number): void;
  /** put at the front of the user queue ("play next") or the back ("add to queue") */
  enqueue(trackId: string, where?: 'next' | 'last'): void;
  dequeue(index: number): void;
  /** reorder the user queue */
  moveQueued(from: number, to: number): void;
  clearQueued(): void;
  /** shuffle what is queued by you / what is left of the album or list (rules keep pairs together) */
  shuffleQueued(): void;
  shuffleRest(): void;
  /** what is playing keeps playing; the "Then" part (rest of the album or list) becomes this list, or this list is added to its end */
  replaceRest(list: string[], source?: Source): void;
  appendRest(list: string[]): void;
  /** the rest of the album or list becomes part of the user queue / is dropped */
  keepRest(): void;
  clearRest(): void;
  /** the state other devices see, and the way for one of them to hand playback to this device (Connect) */
  snapshot(): PlaybackSnapshot;
  restore(snap: PlaybackSnapshot, opts?: { play?: boolean }): void;
  /** push the device's equaliser settings into the sound (creates the audio element if needed) */
  applyEq(): void;
}

/**
 * Connect (lib/connect.ts) fills these in. While this device is only the remote of another one, starting or queueing a track has to
 * happen there, not here; a hook returns true when it took the action over.
 */
export const remoteHooks: {
  play?: (trackId: string, list: string[], source: Source) => boolean;
  enqueue?: (trackId: string, where: 'next' | 'last') => boolean;
} = {};

let audio: HTMLAudioElement | null = null;
/** crossfade (see lib/crossfadeMath.ts): the second <audio> element, the next track loaded into it, and the fade in progress */
let spare: HTMLAudioElement | null = null;
let prep: { id: string; el: HTMLAudioElement; url: string; local: boolean } | null = null;
let prepSeq = 0;
let prepFailed: string | null = null;
let fading = false; // a fade is being started (the spare is being asked to play)
let fade: { out: HTMLAudioElement; outUrl: string | null; timer: ReturnType<typeof setInterval> } | null = null;
let loadSeq = 0;
let objectUrl: string | null = null;
/** where to jump to once the next track's metadata is known (a hand-over from another device) */
let pendingSeek: number | null = null;
let artUrl: string | null = null;
/** true while the Android app's own player (lib/nativeAudio.ts) plays the current track instead of the <audio> element */
let native = false;
/** files the app's player could not play: those go through the page's own <audio> instead */
const nativeBad = new Set<string>();
const NATIVE_AHEAD = 12;
let refreshNative: () => void = () => {};
let preloadSoon: () => void = () => {};
/** true when the playing file is (nearly) fully in the browser's buffer, or at least 90 s ahead of the playhead is */
function currentTrackBuffered(a: HTMLAudioElement): boolean {
  const d = a.duration;
  if (!Number.isFinite(d) || d <= 0) return false;
  for (let i = 0; i < a.buffered.length; i++) {
    if (a.buffered.start(i) <= a.currentTime + 0.5 && a.buffered.end(i) >= Math.min(d - 1, a.currentTime + 90)) return true;
  }
  return false;
}
const lib = getLibrary;
const playLog = new PlayLog();
const rules = () => lib().rules;

export const usePlayer = create<PlayerState>((set, get) => {
  /** One player element. The player owns two (the playing one and a spare for crossfading); only the live one reports to the state. */
  const makeDeck = () => {
    const a = new Audio();
    a.preload = 'auto';
    a.crossOrigin = 'anonymous'; // the equaliser reads the sound; the server answers with CORS headers
    const live = () => a === audio;
    addEqElement(a);
    a.addEventListener('play', resumeEq);
    a.addEventListener('playing', () => { if (!live()) return; playLog.started(); set({ loading: false }); preloadSoon(); });
    a.addEventListener('waiting', () => { if (live() && !native && a.getAttribute('src')) set({ loading: true }); });
    a.addEventListener('loadeddata', () => { if (!live() || !a.paused) return; set({ loading: false }); });
    a.addEventListener('timeupdate', () => { if (!live() || native) return; set({ time: a.currentTime }); tickCrossfade(); });
    a.addEventListener('progress', () => { if (live()) preloadSoon(); });
    a.addEventListener('durationchange', () => live() && !native && set({ duration: Number.isFinite(a.duration) ? a.duration : 0 }));
    a.addEventListener('play', () => { if (live() && !native) set({ playing: true }); });
    a.addEventListener('pause', () => { if (live() && !native && a.getAttribute('src')) set({ playing: false }); }); // a pause that clears the source is a track change
    a.addEventListener('ended', () => { if (!live() || native) return; logPlay(false); get().next(); });
    a.addEventListener('error', () => {
      if (!live() || !a.getAttribute('src')) return;
      const code = a.error?.code;
      set({ error: `Could not load this track${code ? ` (media error ${code})` : ''}`, playing: false, loading: false });
    });
    a.volume = get().volume;
    return a;
  };
  const el = () => {
    if (audio) return audio;
    audio = makeDeck();
    setEq(audio, eqConfig(useStore.getState().settings));
    return audio;
  };

  // ---- crossfade -------------------------------------------------------------------------------------------------------------------
  // Only for tracks the page itself plays (not the Android app's own player, not Spotify), and only for changes that happen by themselves
  // (a track running out). Next/Previous/choosing a track still cut at once. A track's rule can set its own length (core `crossfadeFor`).

  /** Stop the outgoing track at once; the one that was fading in takes the full volume. */
  function endFade() {
    if (!fade) return;
    const f = fade; fade = null; clearInterval(f.timer);
    f.out.pause(); f.out.removeAttribute('src'); f.out.load();
    if (f.outUrl) URL.revokeObjectURL(f.outUrl);
    spare = f.out;
    if (audio) audio.volume = get().volume;
  }
  /** Forget the next track that was loaded into the spare. */
  function dropPrep() {
    prepSeq++;
    if (!prep) return;
    const p = prep; prep = null;
    p.el.pause(); p.el.removeAttribute('src'); p.el.load();
    if (p.local) URL.revokeObjectURL(p.url);
  }
  /** What will play after the current track and how long the change should fade; null = a plain change. */
  function crossfadePlan(): { nextId: string; wanted: number; shift: number } | null {
    const q = get().queue;
    if (!q.currentId || native || spotifyEngine.active() || nativeAudioAvailable()) return null;
    const next = advance(q, rules(), get().source.type).currentId;
    if (!next || next === q.currentId || !lib().trackById.get(next)?.file) return null; // no next track, or one only Spotify / nothing can play: the normal path decides
    const wanted = crossfadeFor(rules(), q.currentId, next, useStore.getState().settings.crossfade, get().source.type);
    return wanted > 0 ? { nextId: next, wanted, shift: crossfadeShiftFor(rules(), q.currentId, next, get().source.type) } : null;
  }
  async function prepare(id: string) {
    dropPrep();
    const file = lib().trackById.get(id)?.file;
    if (!file) return;
    const seq = prepSeq, loads = loadSeq;
    try {
      const { url, local } = await audioSource(file);
      if (seq !== prepSeq || loads !== loadSeq || fade) { if (local) URL.revokeObjectURL(url); return; }
      const b = spare ??= makeDeck();
      b.volume = 0; b.src = url; b.load();
      prep = { id, el: b, url, local };
    } catch { prepFailed = id; }
  }
  async function startFade(nextId: string, wanted: number, shift: number) {
    const out = audio, p = prep;
    if (!out || !p || p.id !== nextId || fading || fade || !Number.isFinite(out.duration)) return;
    const len = fadeLength(wanted, out.duration, out.duration - out.currentTime - clampShift(shift, out.duration)); // the fade has to fit before the shifted end
    if (!len) return;
    fading = true;
    const loads = loadSeq;
    try {
      p.el.volume = 0;
      await p.el.play();
    } catch { prepFailed = nextId; dropPrep(); fading = false; return; } // the browser would not start it (autoplay rules): a plain change instead
    fading = false;
    const q = get().queue, nq = advance(q, rules(), get().source.type);
    if (loads !== loadSeq || audio !== out || prep !== p || nq.currentId !== nextId) { if (prep === p) dropPrep(); return; } // the user did something meanwhile
    // the change itself, as next() makes it when a track ends
    logPlay(false);
    set({ history: pushHistory(get().history, q.currentId) });
    playLog.begin(nextId);
    const outUrl = objectUrl;
    objectUrl = p.local ? p.url : null;
    prep = null; spare = null;
    audio = p.el;
    set({ queue: nq, time: 0, duration: Number.isFinite(p.el.duration) ? p.el.duration : 0, error: null, loading: false, playing: true });
    playLog.started(nextId);
    updateMediaSession(nextId);
    const t0 = performance.now(), inc = p.el;
    const timer = setInterval(() => {
      const progress = (performance.now() - t0) / (len * 1000), g = fadeGains(progress), v = get().volume;
      out.volume = Math.min(1, Math.max(0, g.out * v)); inc.volume = Math.min(1, Math.max(0, g.in * v));
      if (progress >= 1) endFade();
    }, 40);
    fade = { out, outUrl, timer };
  }
  /** Called as the playing track reports its time: load the next track a few seconds ahead, then start the fade. */
  function tickCrossfade() {
    const a = audio;
    if (!a || fade || fading || a.paused || !get().playing || !Number.isFinite(a.duration) || a.duration <= 0) return;
    const plan = crossfadePlan();
    if (!plan) { if (prep) dropPrep(); return; }
    const remaining = a.duration - a.currentTime, shift = clampShift(plan.shift, a.duration);
    if (!shouldPrepare(plan.wanted, remaining, shift) || prepFailed === plan.nextId) return;
    if (!prep || prep.id !== plan.nextId) { void prepare(plan.nextId); return; }
    if (prep.el.readyState < 3) return;
    // a timer lands the start on the exact moment instead of the next report (up to a quarter of a second late)
    const delay = fadeDelayMs(plan.wanted, remaining, shift, a.playbackRate || 1);
    if (delay === null) return;
    if (delay <= 20) { clearFadeTimer(); void startFade(plan.nextId, plan.wanted, shift); return; }
    clearFadeTimer(); fadeTimerFor = a;
    const nextId = plan.nextId, wanted = plan.wanted;
    fadeTimer = setTimeout(() => { // re-checked now: a seek or pause since scheduling moves the moment
      fadeTimer = undefined;
      const d = fadeDelayMs(wanted, a.duration - a.currentTime, shift, a.playbackRate || 1);
      if (audio === a && !a.paused && !fade && !fading && d !== null && d <= 80) void startFade(nextId, wanted, shift);
    }, delay);
  }
  let fadeTimer: ReturnType<typeof setTimeout> | undefined, fadeTimerFor: HTMLAudioElement | null = null;
  function clearFadeTimer() { if (fadeTimer) clearTimeout(fadeTimer); fadeTimer = undefined; fadeTimerFor = null; }

  /** playbackLogs are append-only; skips are logged too so stats can tell them apart */
  const position = () => (spotifyEngine.active() || native ? get().time : audio?.currentTime ?? get().time);

  function logPlay(isSkip: boolean) {
    const id = get().queue.currentId;
    if (!id || (!audio && !native && !spotifyEngine.active())) return;
    const dur = position();
    if (!playLog.claim(id, dur)) return; // once per play, and only for what was heard (lib/playLog.ts)
    const s = get().source;
    const data: PlaybackLogData = { trackId: id, timestamp: Date.now(), duration: dur, sourceType: s.type, sourceId: s.id, isSkip };
    useStore.getState().put('playbackLogs', data);
  }

  /** Can the Android app's own player play this track? (needs the server's address, and no copy that only this page holds) */
  function nativeCan(file: string | null | undefined): boolean {
    if (!file || !nativeAudioAvailable() || nativeBad.has(file)) return false;
    if (useStore.getState().audioCache[file]) return false;
    return /^https?:/i.test(streamUrl(file));
  }

  function nativeItem(id: string): NativeItem | null {
    const t = lib().trackById.get(id);
    if (!t?.file || !nativeCan(t.file)) return null;
    return { id, key: t.file, url: streamUrl(t.file), title: t.title, artist: t.artistName, album: t.albumTitle ?? '', art: t.cover ? streamUrl(t.cover) : undefined };
  }

  /** The playing track with the one before it and the next few, in the order the queue and its rules will play them. */
  function nativeWindow(): NativeItem[] | null {
    const q = get().queue;
    if (!q.currentId) return null;
    const cur = nativeItem(q.currentId);
    if (!cur) return null;
    const out: NativeItem[] = [];
    const before = get().history[get().history.length - 1];
    const prev = before ? nativeItem(before) : null;
    if (prev) out.push(prev);
    out.push(cur);
    let sim = q;
    for (let i = 0; i < NATIVE_AHEAD; i++) {
      sim = advance(sim, rules(), get().source.type);
      if (!sim.currentId) break;
      const t = lib().trackById.get(sim.currentId);
      if (!t?.file) { if (spotifyCan(t)) break; continue; } // the page skips tracks without audio too; one it plays through Spotify ends the window
      const item = nativeItem(sim.currentId);
      if (!item) break; // a track only this page can play: the page takes over when the app's player gets there
      out.push(item);
    }
    return out;
  }

  function syncNative(hard: boolean, play = true, positionMs = 0) {
    const items = nativeWindow();
    const currentId = get().queue.currentId;
    if (!items || !currentId) return;
    nativeAudio.sync({ currentId, positionMs, play, hard, items });
  }

  /** Stop whichever engine is not the one about to play, so two never sound at once. */
  function useEngine(which: 'native' | 'web') {
    if (which === 'native') {
      if (audio && !audio.paused) audio.pause();
      if (audio && audio.getAttribute('src')) { audio.removeAttribute('src'); audio.load(); }
      if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
    } else if (native) nativeAudio.stop();
    native = which === 'native';
    set({ engine: which });
  }

  function load(trackId: string | null, autoStart = true) {
    const seq = ++loadSeq; // a newer load supersedes one still resolving its source
    endFade(); dropPrep(); prepFailed = null;
    if (!trackId) {
      playLog.clear();
      cancelPrefetch();
      void spotifyEngine.release(true);
      if (native) nativeAudio.stop();
      native = false;
      if (audio) { audio.pause(); audio.removeAttribute('src'); }
      set({ time: 0, duration: 0, playing: false, error: null, loading: false });
      return true;
    }
    const track = lib().trackById.get(trackId);
    if (track && (track.file || spotifyCan(track))) playLog.begin(trackId);
    if (track && !track.file && spotifyCan(track)) {
      // no audio file, but Spotify can play it: tell the chosen Spotify device what to play (lib/spotifyPlayer.ts)
      if (native) { nativeAudio.stop(); native = false; }
      if (audio) { audio.pause(); audio.removeAttribute('src'); }
      const at = pendingSeek ?? 0; pendingSeek = null;
      set({ error: null, time: at, duration: 0, playing: autoStart, loading: false });
      set({ engine: 'spotify' });
      spotifyEngine.setListener(onSpotify);
      spotifyEngine.play(spotifyUriOf(track)!, Math.round(at * 1000), autoStart).catch((e: Error) => { if (seq === loadSeq) set({ error: `Spotify: ${e.message}`, playing: false }); });
      updateMediaSession(trackId);
      return true;
    }
    if (!track?.file) return false;
    if (spotifyEngine.active()) void spotifyEngine.release(true);
    set({ error: null, time: 0, loading: autoStart });
    // the old track must stop NOW: resolving the new source can take a while (a slow link), and it would keep playing meanwhile
    if (audio && !native) { audio.pause(); audio.removeAttribute('src'); audio.load(); }
    const file = track.file;
    void (async () => {
      // the app's own player streams from the server; a copy kept on this device (or not uploaded yet) is played by the page
      if (nativeCan(file) && !(await localAudio(file).then((u) => { if (u) URL.revokeObjectURL(u); return !!u; }))) {
        if (seq !== loadSeq) return;
        useEngine('native');
        const at = pendingSeek ?? 0; pendingSeek = null;
        set({ time: at, playing: autoStart });
        syncNative(true, autoStart, Math.round(at * 1000));
        return;
      }
      useEngine('web');
      const a = el();
      const { url, local } = await audioSource(file);
      if (seq !== loadSeq) { if (local) URL.revokeObjectURL(url); return; }
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = local ? url : null;
      a.src = url;
      if (pendingSeek != null) {
        const at = pendingSeek; pendingSeek = null;
        a.addEventListener('loadedmetadata', () => { a.currentTime = Math.min(at, Number.isFinite(a.duration) ? a.duration : at); set({ time: a.currentTime }); }, { once: true });
      }
      if (autoStart) void a.play().catch((e: Error) => set(e?.name === 'NotAllowedError' ? { playing: false, loading: false, error: 'Press play: this browser blocked starting by itself.' } : { playing: false, loading: false }));
    })().catch((e: Error) => { if (seq === loadSeq) set({ error: `Could not load this track (${e.message})`, playing: false, loading: false }); });
    updateMediaSession(trackId);
    return true;
  }

  /** What the Spotify device reports about the track TurboMusic sent it. */
  function onSpotify(r: { playing: boolean; timeMs: number; durationMs: number; ended: boolean }) {
    if (r.ended) {
      logPlay(false);
      const q = get().queue;
      set({ history: pushHistory(get().history, q.currentId) });
      go(advance(q, rules(), get().source.type));
      return;
    }
    if (r.playing && r.timeMs > 0) playLog.started(get().queue.currentId ?? undefined);
    set({ playing: r.playing, time: r.timeMs / 1000, ...(r.durationMs ? { duration: r.durationMs / 1000 } : {}) });
  }

  /** The app's player moved to another track by itself (the track ended, or Next/Previous in the notification, a headset or the car). Follow it. */
  function followNative(id: string, ids: string[], reason: string) {
    const trackId = id.startsWith('t/') ? id.split('/')[1] : id; // Android Auto's own ids
    const q = get().queue;
    if (!trackId || q.currentId === trackId) return;
    const source = get().source.type;
    let sim = q, history = get().history, steps = 0;
    while (sim.currentId !== trackId && steps++ < 30) {
      const left = sim.currentId;
      sim = advance(sim, rules(), source);
      history = pushHistory(history, left);
      if (!sim.currentId) break;
    }
    if (sim.currentId === trackId) {
      logPlay(reason !== 'auto');
      set({ queue: sim, history, time: 0, error: null });
      playLog.begin(trackId); playLog.started(trackId); // the app's player is already playing it
    } else if (get().history[get().history.length - 1] === trackId) {
      logPlay(true);
      set({ history: get().history.slice(0, -1), time: 0, error: null, queue: { ...q, currentId: trackId, user: q.currentId ? [q.currentId, ...q.user] : q.user } });
      playLog.begin(trackId); playLog.started(trackId);
    } else {
      // chosen somewhere else (Android Auto): carry on with what the app's player has queued
      const rest = ids.map((x) => (x.startsWith('t/') ? x.split('/')[1] : x));
      const at = rest.indexOf(trackId);
      if (get().queue.currentId) logPlay(true);
      set({ queue: { currentId: trackId, user: [], active: at >= 0 ? rest.slice(at + 1) : [] }, history: pushHistory(get().history, q.currentId), time: 0, error: null });
      playLog.begin(trackId); playLog.started(trackId);
    }
    updateMediaSession(trackId);
  }

  function onNative(e: NativeEvent) {
    // the live stream of the server's Soloist (lib/beam.ts) shares the app's player: its events are not about the queue
    if ('id' in e && e.id === BEAM_ID) { if (e.t === 'error') beamFailed(e.message); return; }
    if (e.t === 'state') {
      if (!native) {
        // a page that was recreated while the app kept playing: show what is playing
        if (e.id && !get().queue.currentId && e.playing) { native = true; followNative(e.id, [e.id], 'adopt'); } else return;
      }
      if (e.playing && e.pos > 0) playLog.started(e.id);
      set({ playing: e.playing, time: e.pos / 1000, duration: e.dur / 1000, ...(e.playing ? { loading: false } : {}) });
    } else if (e.t === 'index') {
      if (native || !get().queue.currentId) { native = true; followNative(e.id, e.ids, e.reason); }
    } else if (e.t === 'next') {
      if (get().queue.currentId) get().next();
    } else if (e.t === 'prev') {
      if (get().queue.currentId) get().prev();
    } else if (e.t === 'ended') {
      if (!native) return;
      logPlay(false);
      get().next();
    } else if (e.t === 'error') {
      const file = e.id ? lib().trackById.get(e.id)?.file : null;
      if (native && file && e.id === get().queue.currentId && !nativeBad.has(file)) {
        // the app's player could not play it: try the page's own way once
        nativeBad.add(file);
        const at = get().time;
        pendingSeek = at > 1 ? at : null;
        load(e.id!, true);
      } else if (native) set({ error: `Could not load this track (${e.message})`, playing: false, loading: false });
    }
  }

  function updateMediaSession(trackId: string) {
    if (!('mediaSession' in navigator)) return;
    const t = lib().trackById.get(trackId);
    if (!t) return;
    const meta = new MediaMetadata({ title: t.title, artist: t.artistName, album: t.albumTitle ?? '' });
    navigator.mediaSession.metadata = meta;
    // the lock screen / notification cover: 540 px is the size covers are stored at
    if (t.cover) void imageSource(t.cover).then(({ url, local }) => {
      if (lib().trackById.get(trackId) !== t || get().queue.currentId !== trackId) { if (local) URL.revokeObjectURL(url); return; }
      if (artUrl) URL.revokeObjectURL(artUrl);
      artUrl = local ? url : null;
      meta.artwork = [{ src: url, sizes: '540x540', type: 'image/jpeg' }];
    });
    navigator.mediaSession.setActionHandler('nexttrack', () => get().next());
    navigator.mediaSession.setActionHandler('previoustrack', () => get().prev());
    navigator.mediaSession.setActionHandler('play', () => { if (spotifyEngine.active()) get().toggle(); else void el().play(); });
    navigator.mediaSession.setActionHandler('pause', () => { if (spotifyEngine.active()) get().pause(); else el().pause(); });
  }

  /** Move to `q.currentId`, skipping tracks that have no audio yet. */
  function go(q: QueueState, guard = 0): void {
    if (!q.currentId) { set({ queue: q }); load(null); return; }
    if (load(q.currentId)) { set({ queue: q }); return; }
    if (guard > 100) { set({ queue: q, error: 'No playable tracks in the queue', playing: false }); return; }
    go(advance(q, rules(), get().source.type), guard + 1);
  }

  /**
   * Fetch the track that will play after this one while this one plays, so the change is instant even over a slow link
   * (a tunnel, mobile data). Follows the queue's own rules by simulating `advance`; tracks the page cannot play from a file are skipped.
   */
  function preloadNextTrack() {
    if (native || spotifyEngine.active() || !get().queue.currentId) return;
    // only once this track has (nearly) all arrived: two downloads at once would slow the one the user is listening to
    if (audio && audio.getAttribute('src') && !currentTrackBuffered(audio)) return;
    let sim = get().queue;
    for (let i = 0; i < 6; i++) {
      sim = advance(sim, rules(), get().source.type);
      if (!sim.currentId) return;
      const t = lib().trackById.get(sim.currentId);
      if (t?.file) { prefetchAudio(t.file); return; }
    }
  }
  let preloadTimer: ReturnType<typeof setTimeout> | undefined;
  preloadSoon = () => { if (preloadTimer) return; preloadTimer = setTimeout(() => { preloadTimer = undefined; preloadNextTrack(); }, 600); };

  // what the app's own player is told when the queue changes underneath it (queued, removed, reshuffled): the neighbours are replaced, the sound is not interrupted
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  refreshNative = () => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => { if (native) syncNative(false, get().playing, Math.round(get().time * 1000)); }, 80);
  };
  if (typeof window !== 'undefined') nativeAudio.on(onNative);

  return {
    queue: { user: [], active: [], currentId: null }, history: [], source: { type: 'track', id: null },
    playing: false, time: 0, duration: 0, volume: Number(localStorage.getItem('turbomusic.volume') ?? 0.8), engine: 'web', error: null, loading: false,

    play(trackId, list, source = { type: 'track', id: null }) {
      const track = lib().trackById.get(trackId);
      if (!track || (!track.file && !spotifyCan(track))) { set({ error: 'This track has no audio file yet', source }); return; }
      if (remoteHooks.play?.(trackId, list, source)) return;
      const ordered = list;
      const prev = get().queue.currentId;
      if (prev) logPlay(true);
      set({ source, history: pushHistory(get().history, prev) });
      go(startTrack(get().queue, trackId, ordered, rules(), source.type));
    },

    toggle() {
      if (!get().queue.currentId) return;
      if (get().playing) endFade();
      if (spotifyEngine.active()) { if (get().playing) { void spotifyEngine.pause(); set({ playing: false }); } else { void spotifyEngine.resume(); set({ playing: true }); } return; }
      if (native) { if (get().playing) { nativeAudio.pause(); set({ playing: false }); } else { nativeAudio.play(); set({ playing: true }); } return; }
      const a = el();
      if (a.paused) void a.play(); else a.pause();
    },

    pause() { endFade(); if (spotifyEngine.active()) { void spotifyEngine.pause(); set({ playing: false }); } else if (native) { nativeAudio.pause(); set({ playing: false }); } else if (audio) audio.pause(); },

    next() {
      const q = get().queue;
      if (native || spotifyEngine.active() || (audio && !audio.ended)) logPlay(true);
      set({ history: pushHistory(get().history, q.currentId) });
      go(advance(q, rules(), get().source.type));
    },

    prev() {
      endFade();
      const h = get().history;
      if (position() > 3 || !h.length) { if (spotifyEngine.active()) { void spotifyEngine.seek(0); set({ time: 0 }); } else if (native) { nativeAudio.seek(0); set({ time: 0 }); } else el().currentTime = 0; return; }
      const id = h[h.length - 1];
      const q = get().queue;
      set({ history: h.slice(0, -1) });
      go({ ...q, currentId: id, user: q.currentId ? [q.currentId, ...q.user] : q.user });
    },

    seek(t) { if (spotifyEngine.active()) void spotifyEngine.seek(t * 1000); else if (native) nativeAudio.seek(t); else el().currentTime = t; set({ time: t }); },
    setVolume(v) { setBeamVolume(v); if (!fade) el().volume = v; /* while fading, the fade sets both volumes from this one */ if (spotifyEngine.active() && !beamActive()) void spotifyEngine.volume(v); /* a beamed stream is turned down here at once; Soloist's own volume is set in Settings > Spotify */ nativeAudio.volume(v); try { localStorage.setItem('turbomusic.volume', String(v)); } catch { /* ignore */ } set({ volume: v }); },
    enqueue(trackId, where = 'last') {
      if (remoteHooks.enqueue?.(trackId, where)) return;
      const q = get().queue;
      set({ queue: { ...q, user: where === 'next' ? [trackId, ...q.user] : [...q.user, trackId] } });
    },
    dequeue(index) {
      const q = get().queue;
      set({ queue: { ...q, user: q.user.filter((_, i) => i !== index) } });
    },
    moveQueued(from, to) {
      const q = get().queue;
      set({ queue: { ...q, user: moveTrack(q.user, from, to) } });
    },
    clearQueued() { set({ queue: { ...get().queue, user: [] } }); },
    shuffleQueued() { const q = get().queue; set({ queue: { ...q, user: shuffleWithRules(q.user, rules()) } }); },
    shuffleRest() { const q = get().queue; set({ queue: { ...q, active: shuffleWithRules(q.active, rules()) } }); },
    keepRest() { const q = get().queue; set({ queue: { ...q, user: [...q.user, ...q.active], active: [] } }); },
    clearRest() { set({ queue: { ...get().queue, active: [] } }); },
    replaceRest(list, source) {
      const q = get().queue;
      if (!q.currentId) { if (list.length) get().play(list[0], list, source); return; } // nothing is playing: this is just a normal play
      set({ source: source ?? get().source, queue: { ...q, active: list.filter((id) => id !== q.currentId) } });
    },
    appendRest(list) {
      const q = get().queue;
      if (!q.currentId) { if (list.length) get().play(list[0], list); return; }
      set({ queue: { ...q, active: [...q.active, ...list.filter((id) => id !== q.currentId)] } });
    },
    snapshot() {
      const s = get();
      return {
        trackId: s.queue.currentId, queue: s.queue, source: s.source, history: s.history.slice(-50),
        position: position(), duration: s.duration, playing: s.playing, volume: s.volume,
      };
    },

    restore(snap, opts) {
      const want = opts?.play ?? snap.playing;
      set({ source: snap.source as Source, history: snap.history, volume: snap.volume, queue: snap.queue });
      if (audio) audio.volume = snap.volume;
      if (!snap.queue.currentId) { load(null); return; }
      pendingSeek = snap.position;
      if (!load(snap.queue.currentId, want)) { pendingSeek = null; set({ error: 'This device has no audio for that track yet' }); }
      else set({ time: snap.position });
    },

    applyEq() { setEq(el(), eqConfig(useStore.getState().settings)); },
  };
});

// the queue changed while the app's player is playing: tell it about its neighbours
usePlayer.subscribe((s, prev) => {
  if (native && (s.queue !== prev.queue || s.history !== prev.history)) refreshNative();
  if (s.queue !== prev.queue && s.playing) preloadSoon(); // the user queue changed: the next track may be a different one now
});

// the equaliser is device-wide: apply it as soon as it changes (the page's own graph and, in the Android app, the phone's equaliser)
let lastEq = '';
const pushEq = (settings: ReturnType<typeof useStore.getState>['settings']) => {
  const cfg = eqConfig(settings);
  const key = JSON.stringify(cfg);
  if (key === lastEq) return;
  lastEq = key;
  nativeAudio.setEq(cfg);
  if (audio || !isFlat(cfg)) usePlayer.getState().applyEq();
};
useStore.subscribe((s) => pushEq(s.settings));
pushEq(useStore.getState().settings);

// whether Spotify can play for this device: asked once the server is known, and again when it changes
if (typeof window !== 'undefined') {
  setTimeout(() => void refreshSpotifyStatus(), 1500);
  let last = '';
  useStore.subscribe((st) => { const k = `${st.settings.serverUrl}|${st.settings.token}`; if (k !== last) { last = k; void refreshSpotifyStatus(); } });
}
