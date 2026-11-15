import { useEffect, useState } from 'react';
import { isAndroidApp } from './native.ts';

/**
 * The TurboMusic Server app (app.turbomusic.server, a second Android app with no screen): the server running on this phone in its own
 * foreground service, started and stopped by this app (apps/android ServerApp.kt). It replaces the Termux route.
 */
interface Bridge {
  serverAppStatus(): string; serverAppFetch(): void; serverAppFetchState(): string; serverAppInstall(): void;
  serverAppStart(): boolean; serverAppStop(): boolean; serverAppSetOptions(autoStart: boolean, wake: boolean): void;
}
const bridge = (): Bridge | null => {
  const b = typeof window === 'undefined' ? undefined : (window as unknown as { TurboMusicAndroid?: Partial<Bridge> }).TurboMusicAndroid;
  return b && typeof b.serverAppStatus === 'function' ? (b as Bridge) : null; // an older app has no such methods
};

export interface ServerAppStatus { installed: boolean; version: string | null; port: number; token: string; autoStart: boolean; wake: boolean }
export interface ServerAppFetch { status: 'idle' | 'checking' | 'downloading' | 'ready' | 'none' | 'error'; version?: string; percent?: number; message?: string }

export const serverAppSupported = () => isAndroidApp() && !!bridge();
export const serverAppStatus = (): ServerAppStatus | null => { try { return JSON.parse(bridge()!.serverAppStatus()) as ServerAppStatus; } catch { return null; } };
export const serverAppFetchState = (): ServerAppFetch => { try { return JSON.parse(bridge()!.serverAppFetchState()) as ServerAppFetch; } catch { return { status: 'idle' }; } };
export const serverApp = {
  fetch: () => bridge()?.serverAppFetch(),
  install: () => bridge()?.serverAppInstall(),
  start: () => bridge()?.serverAppStart() ?? false,
  stop: () => bridge()?.serverAppStop() ?? false,
  setOptions: (autoStart: boolean, wake: boolean) => bridge()?.serverAppSetOptions(autoStart, wake),
};
export const serverAppUrl = (port: number) => `http://127.0.0.1:${port}`;

export async function serverAppUp(port: number, ms = 1500): Promise<boolean> {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
  try { return (await fetch(`${serverAppUrl(port)}/api/health`, { signal: c.signal })).ok; } catch { return false; } finally { clearTimeout(t); }
}

/** polls the bridge and the server while a component is mounted */
export function useServerApp(everyMs = 1500) {
  const [status, setStatus] = useState<ServerAppStatus | null>(() => (serverAppSupported() ? serverAppStatus() : null));
  const [fetchState, setFetchState] = useState<ServerAppFetch>({ status: 'idle' });
  const [up, setUp] = useState(false);
  useEffect(() => {
    if (!serverAppSupported()) return;
    let live = true;
    const tick = async () => {
      const s = serverAppStatus();
      if (live) { setStatus(s); setFetchState(serverAppFetchState()); }
      if (s?.installed) { const u = await serverAppUp(s.port); if (live) setUp(u); } else if (live) setUp(false);
    };
    void tick();
    const t = setInterval(() => void tick(), everyMs);
    return () => { live = false; clearInterval(t); };
  }, [everyMs]);
  return { status, up, fetchState, refresh: () => setStatus(serverAppStatus()) };
}

/** App start: when the server app is installed and should start with this app, start it unless it already answers. */
export function startServerAppIfWanted(): void {
  if (!serverAppSupported()) return;
  const s = serverAppStatus();
  if (!s?.installed || !s.autoStart) return;
  void serverAppUp(s.port).then((up) => { if (!up) serverApp.start(); });
}
