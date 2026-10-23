import { newId } from '@turbomusic/core';
import { cleanBands } from './eqPresets.ts';

/** Per-device settings (never synced): where the server is, who we are, how it looks. */
export interface DeviceSettings {
  deviceId: string;
  /** how this device is listed in Connect; '' = guessed from the browser */
  deviceName: string;
  /** '' = same origin (dev proxy, or the server serving this app) */
  serverUrl: string;
  token: string;
  /** a Cloudflare Access service token (CF-Access-Client-Id / -Secret) for a server behind Cloudflare Access; blank when none */
  cfAccessId: string;
  cfAccessSecret: string;
  /** colour theme: a palette id, or "auto" / "system" (the turbothemes package lists them) */
  theme: string;
  /** UI style: shape, type and motion (a style id or "auto") */
  ui: string;
  /** where the pages are listed; independent of the look */
  layout: string;
  /** look for newer themes online (the turbothemes repository) and use them without an app update */
  themeUpdates: boolean;
  /** a GitHub token with read access to the themes repository, if that is private; '' = none */
  themesToken: string;
  /** Liquid Glass variant: Regular adapts to what is behind it, Clear is see-through with a dimming layer */
  glass: 'regular' | 'clear';
  /** picture behind the page; the picture itself is kept apart (turbothemes keeps it in localStorage) */
  wallpaper: boolean;
  wallpaperDarkness: number;
  wallpaperCustom: boolean;
  /** the Storage limiter: off by default. When on, locally cached audio stops at `storageLimitMb` */
  storageLimitOn: boolean;
  /** the size of that cap, in MB */
  storageLimitMb: number;
  /** when the limit is reached, drop the least recently played offline tracks instead of stopping */
  evictOldest: boolean;
  /** equaliser in the player (lib/eq.ts): on/off, bass shelf in dB, ten band gains in dB (lib/eqPresets.ts), overall level in dB */
  eqOn: boolean;
  eqBass: number;
  eqBands: number[];
  eqPreamp: number;
  /** crossfade between tracks, in seconds (0 = off); a playback rule can set its own for one pair of tracks */
  crossfade: number;
  /** Spotify Connect device this app sends tracks to (id from the account's device list; '' = none) and its name for display */
  spotifyDeviceId: string;
  spotifyDeviceName: string;
  /** play tracks that have a Spotify link but no audio file through Spotify */
  spotifyAuto: boolean;
  /** be a Spotify device in this app (Spotify's Web Playback SDK plays the audio in the page); needs Widevine and a secure page */
  spotifySdk: boolean;
  /** when the Spotify device is the server's Soloist and it beams its sound (server/src/beam.ts), play that stream on this device */
  spotifyBeam: boolean;
  /** silently play the song on the server's Soloist while it plays from a file here, so Spotify counts the stream (lib/spotifyMirror.ts) */
  spotifyMirror: boolean;
  /** vibration feedback on presses (the Android app and phones that support it) */
  haptics: boolean;
}

const KEY = 'turbomusic.settings';

/** What the Electron desktop app (apps/electron) puts on `window`. Absent in a browser. */
export interface TurboMusicDesktop {
  token: string; version: string; dataDir: string; platform: string; desktopEnv?: string; port: number;
  /** "app" = the window-only edition: no library folder here, the library is on a server (Settings > Server) */
  edition?: 'full' | 'app';
  /** this app runs its own library server (the server module is installed) */
  serverModule?: boolean;
  setServerModule?(on: boolean): Promise<boolean>;
  /** the window's title bar is drawn by the page (a setting of the app, applied at start) */
  customFrame?: boolean;
  windowControl?(action: 'minimize' | 'maximize' | 'close'): void;
  setCustomFrame?(on: boolean): Promise<void>;
  onWindowState?(cb: (maximized: boolean) => void): () => void;
  /** the Cloudflare Access service token for the library server: the main process adds it to every request to that address */
  setAccess?(serverUrl: string, id: string, secret: string): void;
  chooseLibraryFolder(): Promise<string | null>;
  showLibraryFolder(): Promise<void>;
  /** Discord Rich Presence (the app's main process talks to the local Discord client) */
  setPresence(p: { title: string; artist: string; album: string; duration: number; position: number; playing: boolean } | null): void;
  /** what Chromium got for painting: hardware (GPU) or software */
  getGpu?(): Promise<unknown>;
  setGpu?(mode: string): Promise<void>;
  gpuReport?(): Promise<string>;
  openGpuPage?(): void;
  getGraphics?(): Promise<{ hardware: boolean; summary: string; detail: string }>;
  /** moving an installed app from the settings folder of its first name to the current one (the next start does the renaming) */
  migration?: {
    info(): Promise<MigrationInfo>;
    run(): Promise<boolean>;
    dismiss(): Promise<void>;
  };
  getDiscord(): Promise<DiscordInfo>;
  setDiscord(patch: { discordEnabled?: boolean; discordClientId?: string }): Promise<DiscordInfo>;
  updates: import('./native.ts').NativeUpdates;
}
export interface MigrationInfo {
  supported: boolean;
  plan: { needed: boolean; from: string; to: string; blocked?: string; repoint: { file: string; key: string; from: string; to: string }[]; untouched: { file: string; key: string; value: string }[] } | null;
  last: { ok: boolean; at: number; from: string; to: string; done: string[]; error?: string; rolledBack?: boolean } | null;
}
export type DiscordInfo = { discordEnabled: boolean; discordClientId: string; builtIn?: boolean; status: 'off' | 'no-id' | 'connecting' | 'connected'; detail?: string; sockets?: string[] };
export const desktop = (): TurboMusicDesktop | undefined => (typeof window === 'undefined' ? undefined : (window as unknown as { turbomusicDesktop?: TurboMusicDesktop }).turbomusicDesktop);

export function loadSettings(): DeviceSettings {
  let saved: Partial<DeviceSettings> = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) ?? '{}'); } catch { /* storage blocked */ }
  const s: DeviceSettings = {
    deviceId: newId(), deviceName: '', serverUrl: '', token: '', cfAccessId: '', cfAccessSecret: '', theme: 'auto', ui: 'auto', layout: 'side', themeUpdates: true, themesToken: '', glass: 'regular', wallpaper: false, wallpaperDarkness: 0.45, wallpaperCustom: false, storageLimitOn: false, storageLimitMb: 2048, evictOldest: false, eqOn: false, eqBass: 4, eqBands: cleanBands([]), eqPreamp: 0, crossfade: 0, haptics: true, spotifyDeviceId: '', spotifyDeviceName: '', spotifyAuto: true, spotifySdk: false, spotifyBeam: true, spotifyMirror: false, ...saved,
  };
  s.eqBands = cleanBands(s.eqBands);
  s.eqPreamp = Math.min(12, Math.max(-12, Number(s.eqPreamp) || 0));
  s.crossfade = Math.min(12, Math.max(0, Number(s.crossfade) || 0));
  // the first version's look was called "dyad" for a few builds
  if (s.ui === 'dyad') s.ui = 'toolbar';
  // before layouts existed, the first-version look also meant its toolbar arrangement
  if (!saved.layout && s.ui === 'toolbar') s.layout = 'toolbar';
  if (typeof s.layout !== 'string' || !s.layout) s.layout = 'side'; // an id the themes no longer have falls back to the default layout when applied
  if (s.theme === 'dyad') s.theme = 'zinc';
  // a fresh desktop app is already connected to its own server: no address or token to type
  if (!s.token && desktop()?.token) s.token = desktop()!.token;
  saveSettings(s);
  return s;
}

export function saveSettings(s: DeviceSettings) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage blocked */ }
}
