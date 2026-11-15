/* Connect (Spotify-Connect-style remote control). The wire types and validators are shared by the server and the clients. */
export interface PlaybackSnapshot {
  trackId: string | null;
  /** the player's queue as the core library models it: what you queued, and what is left of the album or list */
  queue: { user: string[]; active: string[]; currentId: string | null };
  source: { type: string; id: string | null };
  history: string[];
  /** seconds into the track when the snapshot was taken */
  position: number;
  duration: number;
  playing: boolean;
  volume: number;
  /** what to show for the track (title, artist, album, cover file hash) so a widget can draw it without the library; added by newer clients */
  meta?: TrackMeta;
}
export interface TrackMeta { title: string; artist: string; album: string; cover: string | null }

export type DeviceKind = 'web' | 'electron' | 'android';
export interface DeviceInfo { id: string; name: string; kind: DeviceKind; state: PlaybackSnapshot | null; updatedAt: number }

export type Command =
  | { type: 'play' } | { type: 'pause' } | { type: 'toggle' } | { type: 'next' } | { type: 'prev' }
  | { type: 'seek'; time: number } | { type: 'volume'; value: number }
  /** put a track in the receiving device's queue: right after the current one, or at the end of what you queued */
  | { type: 'enqueue'; trackId: string; where: 'next' | 'last' }
  /** start playing this snapshot on the receiving device */
  | { type: 'transfer'; snapshot: PlaybackSnapshot }
  /** ask the receiving device to publish its state right now */
  | { type: 'report' };

export type ServerEvent =
  | { type: 'devices'; devices: DeviceInfo[] }
  | { type: 'command'; from: string; command: Command };

export const DEVICE_KINDS: DeviceKind[] = ['web', 'electron', 'android'];
const str = (v: unknown, max = 80) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 5000) : []);

/** Validate untrusted JSON into a snapshot (null when it is not one). */
export function parseSnapshot(raw: unknown): PlaybackSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, any>;
  const q = o.queue ?? {};
  return {
    trackId: typeof o.trackId === 'string' ? o.trackId : null,
    queue: { user: ids(q.user), active: ids(q.active), currentId: typeof q.currentId === 'string' ? q.currentId : null },
    source: { type: str(o.source?.type, 20) || 'track', id: typeof o.source?.id === 'string' ? o.source.id : null },
    history: ids(o.history).slice(-50),
    position: Math.max(0, num(o.position)), duration: Math.max(0, num(o.duration)),
    playing: o.playing === true, volume: Math.min(1, Math.max(0, num(o.volume, 0.8))),
    ...(o.meta && typeof o.meta === 'object' ? { meta: { title: str(o.meta.title, 300), artist: str(o.meta.artist, 300), album: str(o.meta.album, 300), cover: typeof o.meta.cover === 'string' && /^[0-9a-f]{64}$/.test(o.meta.cover) ? o.meta.cover : null } } : {}),
  };
}

export function parseCommand(raw: unknown): Command | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, any>;
  switch (o.type) {
    case 'play': case 'pause': case 'toggle': case 'next': case 'prev': case 'report': return { type: o.type };
    case 'seek': return Number.isFinite(o.time) ? { type: 'seek', time: Math.max(0, o.time) } : null;
    case 'volume': return Number.isFinite(o.value) ? { type: 'volume', value: Math.min(1, Math.max(0, o.value)) } : null;
    case 'enqueue': return typeof o.trackId === 'string' && o.trackId ? { type: 'enqueue', trackId: o.trackId.slice(0, 80), where: o.where === 'next' ? 'next' : 'last' } : null;
    case 'transfer': { const s = parseSnapshot(o.snapshot); return s ? { type: 'transfer', snapshot: s } : null; }
    default: return null;
  }
}

