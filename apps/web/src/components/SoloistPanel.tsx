import { useEffect, useRef, useState } from 'react';
import { Download, Loader2, Play, Square, Trash2 } from 'lucide-react';
import type { SoloistInfo } from '../lib/api.ts';
import { api, useStore } from '../lib/store.ts';
import { forgetBeamInfo } from '../lib/beam.ts';
import { Field } from './forms.tsx';

const STATE: Record<SoloistInfo['state'], string> = { stopped: 'Stopped', starting: 'Starting…', running: 'Running', expired: 'Updating (the build expired)…', installing: 'Installing…', error: 'Problem' };

/** Soloist's own volume (Spotify's volume for that device). Set it once, around the top, and use the player bar for everyday volume: the player bar slider acts on this device at once, while this one goes through Spotify and takes a moment. */
function SoloistVolume({ name }: { name: string }) {
  const [id, setId] = useState<string | null | undefined>(undefined);
  const [v, setV] = useState(100);
  const [err, setErr] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  useEffect(() => {
    let alive = true;
    api().spotifyDevices().then((r) => { const d = r.devices.find((x) => x.name === name); if (!alive) return; setId(d?.id || null); if (d?.volume != null) setV(d.volume); }, (e: Error) => { if (alive) { setId(null); setErr(e.message); } });
    return () => { alive = false; };
  }, [name]);
  const set = (n: number) => {
    setV(n); setErr(null);
    if (timer.current) clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { if (id) api().spotifyCommand('volume', id, n).catch((e: Error) => setErr(e.message)); }, 250);
  };
  return (
    <div className="space-y-1.5">
      <div className="font-medium">Soloist’s volume</div>
      {id === undefined ? <p className="text-xs text-muted">Looking for Soloist in your Spotify devices…</p>
        : id === null ? <p className="text-xs text-muted">Spotify does not list “{name}” yet. Start Soloist (it can take a few seconds) and open this tab again.{err ? ` (${err})` : ''}</p>
        : <>
          <div className="flex items-center gap-3"><input type="range" aria-label="Soloist volume" className="bt-range bt-hit flex-1" style={{ ['--p' as string]: `${v}%` }} min={0} max={100} step={1} value={v} onChange={(e) => set(Number(e.target.value))} /><span className="w-10 text-right text-xs tabular-nums text-muted">{v}%</span></div>
          <p className="text-xs text-muted">Set this once (a high level is best) and use the volume slider in the player bar for everyday listening: that one changes the sound on this device at once. This one goes through Spotify and takes a moment to be heard.</p>
          {err && <p className="text-xs text-bad">{err}</p>}</>}
    </div>
  );
}

/**
 * Spotify Soloist, installed and run by the server: Spotify's own headless Connect client. Once it runs, a device with the name chosen here
 * appears in the player's device list (the cast button) and TurboMusic plays Spotify tracks on it, with no phone or PC app open. Three steps:
 * install (downloaded from Spotify, not from TurboMusic), the API key and a name, start.
 */
export function SoloistPanel() {
  const configured = useStore((s) => !!s.settings.token);
  const updateSettings = useStore((s) => s.updateSettings);
  const chosen = useStore((s) => s.settings.spotifyDeviceId);
  const spotifyBeam = useStore((s) => s.settings.spotifyBeam);
  const spotifyMirror = useStore((s) => s.settings.spotifyMirror);
  const [info, setInfo] = useState<SoloistInfo | null>(null);
  const [name, setName] = useState('TurboMusic');
  const [key, setKey] = useState('');
  const [out, setOut] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  const load = async () => { const i = await api().soloist(); setInfo(i); setName((n) => (n === 'TurboMusic' || !n ? i.deviceName : n)); return i; };
  const poll = () => { timer.current = window.setTimeout(async () => { try { const i = await load(); if (['starting', 'installing', 'expired'].includes(i.state)) poll(); } catch { /* try again on the next action */ } }, 2000); };
  useEffect(() => { if (configured) void load().then((i) => { if (['starting', 'installing', 'expired'].includes(i.state)) poll(); }, (e: Error) => setError(e.message.includes('404') ? 'This server is older than the Soloist module: update it first (Settings › Update server).' : e.message)); return () => { if (timer.current) clearTimeout(timer.current); }; }, [configured]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (what: string, f: () => Promise<SoloistInfo>) => {
    setBusy(what); setError(null);
    try { setInfo(await f()); poll(); } catch (e) { setError((e as Error).message === 'Failed to fetch' ? 'Cannot reach the server.' : (e as Error).message); } finally { setBusy(null); }
  };
  // when it is running and nothing is chosen yet, pick it as this device's Spotify output as soon as Spotify lists it
  useEffect(() => {
    if (!info || info.state !== 'running' || chosen) return;
    let alive = true;
    const find = () => api().spotifyDevices().then((r) => { const d = r.devices.find((x) => x.name === info.deviceName); if (alive && d) updateSettings({ spotifyDeviceId: d.id, spotifyDeviceName: d.name }); else if (alive) setTimeout(find, 5000); }, () => undefined);
    const t = setTimeout(find, 3000);
    return () => { alive = false; clearTimeout(t); };
  }, [info?.state, info?.deviceName, chosen]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!configured) return null;
  if (!info) return error ? <div className="rounded-theme bg-bad/15 p-3 text-sm text-bad">{error}</div> : null;
  if (!info.supported) return (
    <div className="space-y-1 border-t border-line pt-4 text-sm"><div className="font-medium">Soloist</div>
      <p className="text-muted">{info.reason}</p>
      <p className="text-xs text-muted">Everywhere else, Spotify plays through the Spotify app on a computer or phone: it appears in the device list (cast button) and TurboMusic controls it.</p></div>);

  const working = !!busy || ['installing', 'expired'].includes(info.state);
  return (
    <div className="space-y-3 border-t border-line pt-4 text-sm">
      <div className="flex flex-wrap items-center gap-2"><div className="font-medium">Soloist: play Spotify inside TurboMusic</div>
        <span className={info.state === 'running' ? 'chip !text-good' : info.state === 'error' ? 'chip !text-bad' : 'chip'}>{STATE[info.state]}</span>{info.version && <span className="text-xs text-muted">{info.version}</span>}</div>
      <div className="rounded-theme border border-line px-3 py-2 text-xs"><span className="text-muted">Runs on:</span> <b>{info.host.name}</b>{info.host.model ? <span className="text-muted"> · {info.host.model}</span> : null}<span className="text-muted"> · the server this app is connected to, not this device</span></div>
      <p className="text-muted">Spotify’s own headless Spotify Connect player. It runs on your Raspberry Pi (the server), never in this app or on a desktop, and plays through the Pi’s sound output. Turn on “Send the sound to the apps” below to hear it on this device instead. It shows up in the device list as “{info.deviceName}”. It needs Spotify Premium and PipeWire or PulseAudio audio. Soloist is Spotify’s software, downloaded from Spotify’s server, under Spotify’s terms; builds expire after 90 days and TurboMusic replaces them by itself.</p>

      <ol className="space-y-3">
        <li className="space-y-1.5"><div className="font-medium">1. Install</div>
          <button className="btn" disabled={working} onClick={() => void act('Installing…', () => api().soloistInstall())}>{busy === 'Installing…' ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}{info.installed ? 'Update Soloist' : 'Download and install Soloist'}</button></li>
        <li className="space-y-1.5"><div className="font-medium">2. API key and name</div>
          <p className="text-xs text-muted">Make the key on <a className="text-accent underline" href={info.downloadsUrl.replace('/reference/downloads-and-updates', '')} target="_blank" rel="noreferrer">Spotify for Developers › Soloist</a> (a Premium account). It is kept on your server only and never shown again.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Device name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="TurboMusic" /></Field>
            <Field label={info.hasKey ? 'API key (saved; type to replace)' : 'API key'}><input className="input font-mono" type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={info.hasKey ? '••••••••' : 'paste the key'} /></Field></div>
          <button className="btn" disabled={working || (!key.trim() && name.trim() === info.deviceName)} onClick={() => void act('Saving…', async () => { const i = await api().soloistConfig({ deviceName: name.trim(), apiKey: key.trim() || undefined }); setKey(''); return i; })}>Save</button></li>
        <li className="space-y-1.5"><div className="font-medium">3. Sound</div>
          {info.audio.ok ? <p className="text-xs text-good">Found {info.audio.server === 'pipewire' ? 'PipeWire' : 'PulseAudio'} for the account that runs the server.</p>
            : <div className="rounded-theme bg-warn/15 p-3 text-xs text-warn" role="alert">{info.audio.hint}</div>}
          <Field label="Output (optional)"><input className="input font-mono" value={out ?? info.outputDevice} onChange={(e) => setOut(e.target.value)} placeholder="the system default; or a PipeWire output name or id" /></Field>
          <button className="btn" disabled={working || (out ?? info.outputDevice) === info.outputDevice} onClick={() => void act('Saving…', async () => { const i = await api().soloistConfig({ outputDevice: (out ?? '').trim() }); setOut(null); return i; })}>Save output</button></li>
        <li className="space-y-1.5"><div className="font-medium">4. Where the sound goes</div>
          <label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5" checked={info.beam.enabled} disabled={working}
            onChange={(e) => void act('Saving…', async () => { const i = await api().soloistConfig({ beam: e.target.checked }); forgetBeamInfo(); return i; })} />
            <span>Send the sound to the apps <span className="text-muted">(instead of this machine’s speakers). The server captures Soloist’s output and streams it live; the Android app, the browser and the desktop app play that stream. Needs ffmpeg and <code>pactl</code> on the server. The sound is a few seconds behind the screen, and only works while the app has the server’s Spotify device chosen.</span></span></label>
          {info.beam.enabled && info.beam.sinkMessage && <div className="rounded-theme bg-bad/15 p-2 text-xs text-bad">{info.beam.sinkMessage}</div>}
          {info.beam.enabled && info.beam.error && <div className="rounded-theme bg-bad/15 p-2 text-xs text-bad">{info.beam.error}</div>}
          {info.beam.enabled && <p className="text-xs text-muted">{info.beam.running ? `Streaming now to ${info.beam.listeners} listener${info.beam.listeners === 1 ? '' : 's'}.` : 'The stream starts when a device plays Spotify.'}</p>}
          {info.beam.enabled && <label className="flex items-center gap-2 text-muted"><input type="checkbox" checked={spotifyBeam} onChange={(e) => updateSettings({ spotifyBeam: e.target.checked })} />Hear it on this device</label>}
          {info.beam.enabled && <label className="flex items-start gap-2 text-muted"><input type="checkbox" className="mt-0.5" checked={spotifyMirror} onChange={(e) => updateSettings({ spotifyMirror: e.target.checked })} /><span>Count my plays on Spotify <span className="text-warn">(silent mirror)</span>: while a song plays from its file here and has a Spotify link, Soloist plays it silently so Spotify counts the stream for Wrapped. Works only when this device uses this Soloist. Spotify’s terms forbid artificially inflating streams and can flag an account for it: use at your own risk.</span></label>}
        </li>
        <li className="space-y-1.5"><div className="font-medium">5. Run</div>
          <div className="flex flex-wrap items-center gap-2">
            {info.running ? <button className="btn" disabled={working} onClick={() => void act('Stopping…', () => api().soloistStop())}><Square size={14} />Stop</button>
              : <button className="btn btn-accent" disabled={working || !info.installed || !info.hasKey} onClick={() => void act('Starting…', () => api().soloistStart())}><Play size={14} />Start</button>}
            <label className="flex items-center gap-1.5 text-muted"><input type="checkbox" checked={info.autoStart} onChange={(e) => void act('Saving…', () => api().soloistConfig({ autoStart: e.target.checked }))} />Start with the server</label>
            {info.installed && <button className="btn btn-ghost text-bad" disabled={working} onClick={() => confirm('Remove Soloist and its saved key from the server?') && void act('Removing…', () => api().soloistRemove())}><Trash2 size={14} />Remove</button>}
          </div></li>
      </ol>
      {busy && <div className="text-muted" role="status">{busy}</div>}
      {info.message && info.state !== 'running' && <div className={info.state === 'error' ? 'rounded-theme bg-bad/15 p-3 text-bad' : 'text-muted'}>{info.message}</div>}
      {info.running && <SoloistVolume name={info.deviceName} />}
      {info.state === 'running' && <p className="text-good">Running. Open the cast button in the player: “{info.deviceName}” is under Spotify devices.</p>}
      {info.log.length > 0 && info.state !== 'stopped' && <details className="text-xs text-muted"><summary className="cursor-pointer">Soloist’s own messages</summary><pre className="mt-1 max-h-40 overflow-auto rounded-theme bg-raised p-2">{info.log.join('\n')}</pre></details>}
      {error && <div className="rounded-theme bg-bad/15 p-3 text-bad">{error}</div>}
    </div>
  );
}
