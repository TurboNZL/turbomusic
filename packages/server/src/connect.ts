/**
 * "Connect": every open client announces itself and what it is playing; any client can see the others and send one of
 * them commands (play, pause, next, seek, volume) or move playback to it. The server only relays; it keeps nothing on disk.
 *
 * A device is online while it holds an event stream (SSE). It posts its state whenever that changes; every stream
 * receives the device list. A command goes to the target's streams.
 */
import { DEVICE_KINDS, type Command, type DeviceInfo, type DeviceKind, type PlaybackSnapshot, type ServerEvent } from '@turbomusic/core';
export { parseCommand, parseSnapshot } from '@turbomusic/core';
export type { Command, DeviceInfo, DeviceKind, PlaybackSnapshot, ServerEvent } from '@turbomusic/core';

type Sink = (event: ServerEvent) => void;
const str = (v: unknown, max = 80) => (typeof v === 'string' ? v.slice(0, max) : '');

export class ConnectHub {
  private devices = new Map<string, DeviceInfo>();
  private sinks = new Map<string, Set<Sink>>();
  private gone = new Map<string, ReturnType<typeof setTimeout>>();
  private graceMs: number;
  constructor(graceMs = 10_000) { this.graceMs = graceMs; }

  list(): DeviceInfo[] {
    return [...this.devices.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }

  /**
   * What is playing anywhere, for the OBS widget and the KDE panel: the device that is playing (the one that reported last when several
   * are), else the one that stopped most recently. `position` is moved on by the time since that device last reported.
   */
  nowPlaying(now = Date.now()): { playing: boolean; deviceId: string; trackId: string; meta: PlaybackSnapshot['meta'] | null; position: number; duration: number; device: string; updatedAt: number } | null {
    const live = [...this.devices.values()].filter((d) => d.state?.trackId);
    const pick = live.filter((d) => d.state!.playing).sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? live.sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (!pick?.state) return null;
    const st = pick.state;
    const position = st.playing ? Math.min(st.duration || Infinity, st.position + (now - pick.updatedAt) / 1000) : st.position;
    return { playing: st.playing, deviceId: pick.id, trackId: st.trackId!, meta: st.meta ?? null, position, duration: st.duration, device: pick.name, updatedAt: pick.updatedAt };
  }

  /** A device opens its event stream. Returns the function that closes it. */
  connect(info: { id: string; name: string; kind: string }, sink: Sink): () => void {
    const id = str(info.id, 64);
    if (!id) throw new Error('device id missing');
    clearTimeout(this.gone.get(id)); this.gone.delete(id);
    const prev = this.devices.get(id);
    this.devices.set(id, { id, name: str(info.name) || 'Unnamed device', kind: (DEVICE_KINDS as string[]).includes(info.kind) ? (info.kind as DeviceKind) : 'web', state: prev?.state ?? null, updatedAt: Date.now() });
    const set = this.sinks.get(id) ?? new Set<Sink>();
    set.add(sink); this.sinks.set(id, set);
    this.broadcast();
    return () => {
      set.delete(sink);
      if (set.size) return;
      // a reload or a brief network drop reconnects within the grace period without the device vanishing from the list
      this.gone.set(id, setTimeout(() => { this.sinks.delete(id); this.devices.delete(id); this.gone.delete(id); this.broadcast(); }, this.graceMs));
    };
  }

  /** The device's own report of what it is doing. Only a connected device may report. */
  report(id: string, state: PlaybackSnapshot | null, name?: string): boolean {
    const d = this.devices.get(id);
    if (!d) return false;
    d.state = state; d.updatedAt = Date.now();
    if (name) d.name = str(name) || d.name;
    this.broadcast();
    return true;
  }

  /** Send a command to `to`. Returns false when that device is not connected. */
  command(from: string, to: string, command: Command): boolean {
    const set = this.sinks.get(to);
    if (!set?.size || !this.devices.has(to)) return false;
    for (const s of set) s({ type: 'command', from, command });
    return true;
  }

  private broadcast() {
    const event: ServerEvent = { type: 'devices', devices: this.list() };
    for (const set of this.sinks.values()) for (const s of set) s(event);
  }

  close() { for (const t of this.gone.values()) clearTimeout(t); this.gone.clear(); }
}
