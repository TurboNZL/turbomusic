import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { pushHistory, startTrack, type Command, type DeviceInfo, type DeviceKind, type PlaybackSnapshot, type ServerEvent, type SourceType } from '@turbomusic/core';
import { remoteHooks, usePlayer } from './player.ts';
import { desktop } from './settings.ts';
import { guessDeviceName as guess, positionNow } from './connectPure.ts';
export { positionNow };
import { api, useStore } from './store.ts';
import { spotifyEngine } from './spotifyPlayer.ts';
import { stopBeam } from './beam.ts';
import { resyncMirror } from './spotifyMirror.ts';
import { getLibrary } from './derive.ts';
import { HeaderEventSource, type EventSourceLike } from './sse.ts';

/**
 * Connect, in the manner of Spotify Connect: every device that has this app open and a server configured appears in a list. Pick
 * one to move playback there, or to use this device as the remote for it. The server only relays (packages/server/src/connect.ts);
 * the audio always plays on one device, which loads it from its own offline copy or from the server.
 */

interface ConnectState {
  /** the event stream is open */
  live: boolean;
  devices: DeviceInfo[];
  /** per device: when its latest report arrived here. Its reported position moves on from that moment */
  receivedAt: Record<string, number>;
  /** the device this one is the remote for; null = playing here */
  remoteId: string | null;
}
export const useConnect = create<ConnectState>(() => ({ live: false, devices: [], receivedAt: {}, remoteId: null }));

export const deviceKind = (): DeviceKind => (desktop() ? 'electron' : 'web');
export const guessDeviceName = () => guess(typeof navigator === 'undefined' ? '' : navigator.userAgent, !!desktop());
export const myName = () => useStore.getState().settings.deviceName.trim() || guessDeviceName();
export const myId = () => useStore.getState().settings.deviceId;

const remoteDevice = () => { const { remoteId, devices } = useConnect.getState(); return remoteId ? devices.find((d) => d.id === remoteId) : undefined; };

/**
 * Show the effect of a command at once, before the device's own report comes back (about a quarter of a second to a second later);
 * without this the seek bar and the play button snap back to the old state and jump forward again.
 */
function predict(to: string, change: (s: PlaybackSnapshot, now: number) => PlaybackSnapshot) {
  const { devices, receivedAt } = useConnect.getState();
  const d = devices.find((x) => x.id === to);
  if (!d?.state) return;
  const now = Date.now();
  const state = change({ ...d.state, position: positionNow(d, receivedAt, now) }, now);
  useConnect.setState({ devices: devices.map((x) => (x.id === to ? { ...x, state } : x)), receivedAt: { ...receivedAt, [to]: now } });
}

/** Send to a device; if it has gone, drop out of remote mode instead of pretending. */
async function send(to: string, command: Command) {
  try { await api().connectCommand(myId(), to, command); }
  catch { if (useConnect.getState().remoteId === to) useConnect.setState({ remoteId: null }); }
}

/** Publish what this device is doing. */
let lastPub = { t: 0, at: 0 };
function publish() {
  const { live } = useConnect.getState();
  if (!live) return;
  const snap = usePlayer.getState().snapshot();
  lastPub = { t: snap.position, at: Date.now() };
  // while this device is only a remote it plays nothing; its state is the idle one
  void api().connectState(myId(), myName(), snap.trackId ? snap : null).catch(() => undefined);
}

/** The snapshot to hand over when playback moves away from where it is now (this device, or the remote being controlled). */
function currentSnapshot(): PlaybackSnapshot | null {
  const r = remoteDevice();
  if (r?.state) return { ...r.state, position: positionNow(r, useConnect.getState().receivedAt) };
  const s = usePlayer.getState().snapshot();
  return s.trackId ? s : null;
}

/**
 * What can be done with another device. They differ in who plays and whether this device stays linked afterwards:
 *  - pullFrom(id)    "Play here": what that device is playing moves to this one (same track, same position, same queue); it stops there.
 *  - pushTo(id)      "Send there": what plays here (or on the device being controlled) moves to that device and stops here;
 *                    this device stays linked as its remote until you disconnect.
 *  - pushTo(id, {keepHere}) "Play on both": that device starts the same track and this one carries on, with no link.
 *  - control(id)     use this device as the remote of that one without moving anything.
 *  - disconnect()    drop the link: the device that was being controlled keeps playing, this one is its own player again.
 * Playback is always whole: the track, the position and the queue travel together, so nothing restarts or skips.
 */
export async function pullFrom(id: string) {
  const d = useConnect.getState().devices.find((x) => x.id === id);
  if (!d?.state?.trackId) throw new Error('That device is not playing anything');
  const snap = { ...d.state, position: positionNow(d, useConnect.getState().receivedAt) };
  const wasPlaying = snap.playing;
  void send(id, { type: 'pause' });
  useConnect.setState({ remoteId: null });
  usePlayer.getState().restore(snap, { play: wasPlaying });
  publish();
}

export async function pushTo(id: string, opts: { keepHere?: boolean } = {}) {
  if (id === myId()) return pullFromRemoteOrNothing();
  const from = remoteDevice();
  const snap = currentSnapshot();
  if (!snap) { useConnect.setState({ remoteId: id }); return; } // nothing to send: just take the remote
  if (!opts.keepHere) { if (from && from.id !== id) void send(from.id, { type: 'pause' }); else if (!from) usePlayer.getState().pause(); }
  await send(id, { type: 'transfer', snapshot: { ...snap, playing: opts.keepHere ? snap.playing : true } });
  useConnect.setState({ remoteId: opts.keepHere ? useConnect.getState().remoteId : id });
}

export function control(id: string) { useConnect.setState({ remoteId: id === myId() ? null : id }); }

/** Stop being the remote of another device. It keeps playing; nothing is sent to it. */
export function disconnect() { useConnect.setState({ remoteId: null }); publish(); }

/**
 * "Play on this device only": drop everything that is not local. Stops controlling another TurboMusic device (it keeps playing), pauses
 * Spotify and stops the stream of the server's Soloist, and forgets the chosen Spotify device so that the next local track starts at once,
 * without anything still tied to Spotify. A Spotify-only track needs a Spotify device chosen again to play.
 */
export async function localOnly() {
  useConnect.setState({ remoteId: null });
  const st = useStore.getState();
  // a track Spotify was playing continues from the same spot on this device when it has a file here by now (a download may have finished meanwhile)
  const p = usePlayer.getState();
  const snap = p.engine === 'spotify' && p.queue.currentId ? p.snapshot() : null;
  stopBeam();
  await spotifyEngine.release(true);
  if (st.settings.spotifyDeviceId) st.updateSettings({ spotifyDeviceId: '', spotifyDeviceName: '' });
  if (snap?.trackId && getLibrary().trackById.get(snap.trackId)?.file) p.restore(snap, { play: snap.playing });
  resyncMirror(); // the silent mirror is controlled only by its switch in Settings
  publish();
}

/** Is anything that is not local connected: another device being controlled, a Spotify device chosen, Spotify or the stream playing? */
export function useNotLocal(): boolean {
  const remoteId = useConnect((s) => s.remoteId);
  const chosen = useStore((s) => !!s.settings.spotifyDeviceId);
  const engine = usePlayer((s) => s.engine);
  return !!remoteId || chosen || engine === 'spotify';
}

/** Play or pause whatever the player bar shows: this device's player, or the device being controlled. The space bar and the media keys use it. */
export function togglePlayback() {
  const r = remoteDevice();
  if (!r) { usePlayer.getState().toggle(); return; }
  predict(r.id, (s) => ({ ...s, playing: !s.playing }));
  void send(r.id, { type: 'toggle' });
}

// While this device only controls another one, playing or queueing a track happens on that device.
remoteHooks.play = (trackId, list, source) => {
  const r = remoteDevice();
  if (!r) return false;
  const before = r.state;
  const queue = startTrack(before?.queue ?? { user: [], active: [], currentId: null }, trackId, list, getLibrary().rules, source.type as SourceType);
  const snapshot: PlaybackSnapshot = {
    trackId: queue.currentId, queue, source, history: pushHistory(before?.history ?? [], before?.trackId ?? null),
    position: 0, duration: 0, playing: true, volume: before?.volume ?? usePlayer.getState().volume,
  };
  predict(r.id, (s) => ({ ...snapshot, duration: 0, volume: s.volume }));
  void send(r.id, { type: 'transfer', snapshot });
  return true;
};
remoteHooks.enqueue = (trackId, where) => {
  const r = remoteDevice();
  if (!r) return false;
  predict(r.id, (s) => ({ ...s, queue: { ...s.queue, user: where === 'next' ? [trackId, ...s.queue.user] : [...s.queue.user, trackId] } }));
  void send(r.id, { type: 'enqueue', trackId, where });
  return true;
};

/** "This device" while controlling another: bring its playback here. */
async function pullFromRemoteOrNothing() { const r = remoteDevice(); if (r) await pullFrom(r.id); }

/** What the player bar shows and which commands its buttons send: this device's player, or the remote one's. */
export function usePlaybackView() {
  const p = usePlayer();
  const { remoteId, devices, receivedAt } = useConnect();
  const remote = remoteId ? devices.find((d) => d.id === remoteId) : undefined;
  const playing = remote?.state?.playing ?? false;
  const [, tick] = useState(0);
  useEffect(() => { if (!remote || !playing) return; const t = setInterval(() => tick((n) => n + 1), 500); return () => clearInterval(t); }, [remote, playing]);
  if (!remote) return { remote: undefined as DeviceInfo | undefined, loading: p.loading, trackId: p.queue.currentId, playing: p.playing, time: p.time, duration: p.duration, volume: p.volume,
    toggle: p.toggle, next: p.next, prev: p.prev, seek: p.seek, setVolume: p.setVolume };
  const s = remote.state;
  const cmd = (c: Command) => () => void send(remote.id, c);
  return {
    remote, loading: false, trackId: s?.trackId ?? null, playing, time: positionNow(remote, receivedAt), duration: s?.duration ?? 0, volume: s?.volume ?? 0.8,
    toggle: togglePlayback, next: cmd({ type: 'next' }), prev: cmd({ type: 'prev' }),
    seek: (t: number) => { predict(remote.id, (x) => ({ ...x, position: t })); void send(remote.id, { type: 'seek', time: t }); },
    setVolume: (v: number) => { predict(remote.id, (x) => ({ ...x, volume: v })); void send(remote.id, { type: 'volume', value: v }); },
  };
}

function onCommand(c: Command) {
  const p = usePlayer.getState();
  switch (c.type) {
    case 'play': if (!p.playing) p.toggle(); break;
    case 'pause': p.pause(); break;
    case 'toggle': p.toggle(); break;
    case 'next': p.next(); break;
    case 'prev': p.prev(); break;
    case 'seek': p.seek(c.time); break;
    case 'volume': p.setVolume(c.value); break;
    case 'enqueue': p.enqueue(c.trackId, c.where); break;
    case 'transfer': useConnect.setState({ remoteId: null }); p.restore(c.snapshot, { play: true }); break;
    case 'report': break;
  }
  setTimeout(publish, 150);
}

let source: EventSourceLike | null = null;
let retry: ReturnType<typeof setTimeout> | undefined;
let heartbeat: ReturnType<typeof setInterval> | undefined;
let key = '';

function open() {
  const st = useStore.getState().settings;
  const next = `${st.serverUrl}|${st.token}|${st.cfAccessId}|${st.cfAccessSecret}|${st.deviceId}|${st.deviceName}`;
  if (!st.token) { stop(); return; }
  if (source && next === key) return;
  stop();
  key = next;
  const streamUrl = api().connectStreamUrl(myId(), myName(), deviceKind());
  const es: EventSourceLike = (source = api().needsHeaderFetch ? new HeaderEventSource(streamUrl, api().access) : new EventSource(streamUrl) as EventSourceLike);
  es.onopen = () => { useConnect.setState({ live: true }); publish(); };
  es.addEventListener('connect', (e) => {
    const ev = JSON.parse((e as MessageEvent).data) as ServerEvent;
    if (ev.type === 'devices') {
      const { remoteId, devices: before, receivedAt: was } = useConnect.getState();
      // a device's report is new when its updatedAt moved; other devices' reports must not reset its clock
      const receivedAt = Object.fromEntries(ev.devices.map((d) => [d.id, before.find((b) => b.id === d.id)?.updatedAt === d.updatedAt && was[d.id] ? was[d.id] : Date.now()]));
      useConnect.setState({ devices: ev.devices, receivedAt, remoteId: remoteId && ev.devices.some((d) => d.id === remoteId) ? remoteId : null });
    } else onCommand(ev.command);
  });
  es.onerror = () => {
    useConnect.setState({ live: false });
    // the browser retries by itself unless the server answered with an error (wrong token, restart): then start over after a pause
    if (es.readyState === 2 /* CLOSED */) { source = null; key = ''; clearTimeout(retry); retry = setTimeout(open, 5000); }
  };
  clearInterval(heartbeat);
  heartbeat = setInterval(() => { if (usePlayer.getState().playing) publish(); }, 4000);
}

function stop() {
  source?.close(); source = null; key = '';
  clearTimeout(retry); clearInterval(heartbeat);
  useConnect.setState({ live: false, devices: [], remoteId: null });
}

/** Start Connect for this device and keep it in step with the player and the settings. Call once at start-up. */
export function startConnect() {
  open();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const soon = () => { clearTimeout(timer); timer = setTimeout(publish, 300); };
  usePlayer.subscribe((s, prev) => {
    if (s.queue.currentId !== prev.queue.currentId || s.playing !== prev.playing || s.volume !== prev.volume
      || s.queue.user.length !== prev.queue.user.length || s.queue.active.length !== prev.queue.active.length) soon();
    else if (s.time !== prev.time) { // a jump (seeking) is news; the normal ticking is not
      const expected = lastPub.t + (s.playing ? (Date.now() - lastPub.at) / 1000 : 0);
      if (Math.abs(s.time - expected) > 2) soon();
    }
  });
  useStore.subscribe((s, prev) => { if (s.settings.cfAccessId !== prev.settings.cfAccessId || s.settings.cfAccessSecret !== prev.settings.cfAccessSecret || s.settings.token !== prev.settings.token || s.settings.serverUrl !== prev.settings.serverUrl || s.settings.deviceName !== prev.settings.deviceName) open(); });
}
