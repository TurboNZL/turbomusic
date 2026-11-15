import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useStore } from '../lib/store.ts';
import { serverApp, serverAppSupported, serverAppUrl, useServerApp } from '../lib/serverApp.ts';
import { Section } from './Section.tsx';

/**
 * Settings > This app, Android only: run the TurboMusic server on this phone. It is a second app (TurboMusic Server, no screen) that this
 * app installs from the release, starts and stops; it keeps running in the background with a notification, so other devices can always reach it.
 */
export function ServerAppCard() {
  const { status, up, fetchState, refresh } = useServerApp();
  const { settings, updateSettings, syncNow } = useStore();
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  if (!serverAppSupported() || !status) return null;
  const url = serverAppUrl(status.port);
  const usingIt = settings.serverUrl === url && settings.token === status.token && !!status.token;
  const act = (fn: () => boolean, what: string) => { setError(null); if (!fn()) setError(`${what} Android did not allow it. Open the app once and try again; the server app must be installed from the same release as this app.`); window.setTimeout(refresh, 600); };
  const start = () => { setStarting(true); act(serverApp.start, 'The server could not be started.'); window.setTimeout(() => setStarting(false), 8000); };
  const busy = fetchState.status === 'checking' || fetchState.status === 'downloading';
  return (
    <Section title="Server on this phone">
      <p className="text-sm text-muted">Run the TurboMusic server on this phone so it can hold your library and serve your other devices, with no other app needed. It is a separate small app, <b>TurboMusic Server</b>, that stays running in the background with a notification.</p>
      {!status.installed ? <div className="space-y-2">
        {fetchState.status === 'ready'
          ? <button className="btn btn-accent" onClick={() => serverApp.install()}>Install TurboMusic Server {fetchState.version}</button>
          : <button className="btn btn-accent" disabled={busy} onClick={() => serverApp.fetch()}>{busy ? <Loader2 size={15} className="animate-spin" /> : null}{fetchState.status === 'downloading' ? `Downloading… ${fetchState.percent ?? 0}%` : fetchState.status === 'checking' ? 'Looking for it…' : 'Get the server app'}</button>}
        {fetchState.status === 'ready' && <p className="text-xs text-muted">Android asks you to confirm. After it is installed, come back here.</p>}
        {(fetchState.status === 'error' || fetchState.status === 'none') && <p role="alert" className="text-sm text-bad">{fetchState.message}</p>}
      </div> : <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className={up ? 'chip !text-good' : starting ? 'chip' : 'chip !text-warn'}>{up ? 'Running' : starting ? 'Starting…' : 'Stopped'}</span>
          {starting && !up && <Loader2 size={14} className="animate-spin text-muted" />}
          {up ? <button className="btn" onClick={() => act(serverApp.stop, 'The server could not be stopped.')}>Stop</button> : <button className="btn btn-accent" disabled={starting} onClick={start}>Start</button>}
          <span className="text-xs text-muted">server app {status.version}</span>
        </div>
        {up && !usingIt && <div className="flex flex-wrap items-center gap-2 rounded-theme bg-raised p-3 text-sm">This app is not using it yet.<button className="btn btn-accent" onClick={() => { updateSettings({ serverUrl: url, token: status.token }); void syncNow(); }}>Use it on this phone</button></div>}
        {up && usingIt && <p className="text-sm text-good">This app is using the server on this phone. Other devices on your Wi-Fi reach it at this phone’s address, port {status.port}.</p>}
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={status.autoStart} onChange={(e) => { serverApp.setOptions(e.target.checked, status.wake); refresh(); }} />Start the server whenever this app opens</label>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={status.wake} onChange={(e) => { serverApp.setOptions(status.autoStart, e.target.checked); refresh(); }} /><span>Keep the phone’s processor awake while it runs <span className="text-muted">(uses more battery; helps when the screen is off)</span></span></label>
        <p className="text-xs text-muted">Not available in this first version: downloading from YouTube (yt-dlp and ffmpeg are not packaged yet). Add music by uploading files, or use a Pi or computer for downloads.</p>
      </div>}
      {error && <div role="alert" className="rounded-theme bg-bad/15 p-3 text-sm text-bad">{error}</div>}
    </Section>
  );
}
