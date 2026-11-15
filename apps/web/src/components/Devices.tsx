import { useEffect, useState } from 'react';
import { Cast, Check, Monitor, Music, Radio, Smartphone, Speaker, Unplug } from 'lucide-react';
import type { DeviceInfo } from '@turbomusic/core';
import { useLibrary } from '../lib/derive.ts';
import { control, disconnect, localOnly, myId, pullFrom, pushTo, useConnect, useNotLocal } from '../lib/connect.ts';
import { usePlayer } from '../lib/player.ts';
import { usePopups } from '../lib/popups.ts';
import { api, useStore } from '../lib/store.ts';
import { chooseSpotifyDevice, useSpotifyLink } from '../lib/spotifyPlayer.ts';
import { peekSoloist, refreshSoloistInfo } from '../lib/beam.ts';
import type { SpotifyDeviceInfo } from '../lib/api.ts';
import { cn } from '../lib/cn.ts';
import { Popover } from './Popover.tsx';

/** Spotify Connect devices of the signed-in account (Soloist, the phone's Spotify app, a speaker), refreshed while the list is open. */
function useSpotifyDevices(): { list: SpotifyDeviceInfo[]; note: string | null; soloist: { deviceName: string; host: string } | null } {
  const signedIn = useSpotifyLink((s) => s.signedIn);
  const [list, setList] = useState<SpotifyDeviceInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [soloist, setSoloist] = useState<{ deviceName: string; host: string } | null>(() => { const c = peekSoloist(); return c?.host ? { deviceName: c.deviceName, host: c.host } : null; });
  useEffect(() => {
    if (!signedIn) { setList([]); setError(null); return; }
    let alive = true, t: number | undefined;
    void refreshSoloistInfo().then((c) => { if (alive && c.host) setSoloist({ deviceName: c.deviceName, host: c.host }); });
    const tick = () => { api().spotifyDevices().then((r) => { if (alive) { setList(r.devices); setError(null); } }, (e: Error) => { if (alive) { setList([]); setError(e.message === 'Failed to fetch' ? 'Cannot reach the server.' : e.message); } }).finally(() => { if (alive) t = window.setTimeout(tick, 8000); }); };
    tick();
    return () => { alive = false; if (t) clearTimeout(t); };
  }, [signedIn]);
  // say why the list is empty instead of showing nothing
  const note = !signedIn ? null // people who never set Spotify up are not told about it
    : error ? `Spotify devices could not be loaded: ${error}`
    : list.length === 0 ? 'Spotify lists no devices right now. A device only shows while it is running: start Soloist in Settings > Spotify, or open the Spotify app on a phone or computer and play something once.' : null;
  return { list, note, soloist };
}

const iconFor = (d: DeviceInfo) => (d.kind === 'android' ? Smartphone : d.kind === 'electron' ? Monitor : Cast);

/** The devices that have this app open, to move playback to one of them or to remote-control it. */
export function DeviceList({ onPick }: { onPick?: () => void }) {
  const lib = useLibrary();
  const configured = useStore((s) => !!s.settings.token);
  const { devices, live, remoteId } = useConnect();
  const playingHere = usePlayer((s) => s.playing);
  const hereTrack = usePlayer((s) => s.queue.currentId);
  const me = myId();
  const [err, setErr] = useState<string | null>(null);
  const { list: spotify, note: spotifyNote, soloist } = useSpotifyDevices();
  const engine = usePlayer((s) => s.engine);
  const chosen = useStore((s) => s.settings.spotifyDeviceId);
  const chosenName = useStore((s) => s.settings.spotifyDeviceName);
  const notLocal = useNotLocal();
  if (!configured) return <p className="p-3 text-sm text-muted">Connect needs your server. Add its address and token in Settings.</p>;
  if (!live) return <p className="p-3 text-sm text-muted">Connecting to the server…</p>;
  const mineDevice = devices.find((d) => d.id === me);
  const others = devices.filter((d) => d.id !== me).sort((a, b) => a.name.localeCompare(b.name));
  // something to send: this device has a track, or it is the remote of one that does
  const remote = remoteId ? devices.find((d) => d.id === remoteId) : undefined;
  const canSend = remote ? !!remote.state?.trackId : !!hereTrack;
  const run = (f: () => Promise<void> | void, close = true) => { setErr(null); void Promise.resolve().then(f).then(() => close && onPick?.()).catch((e: Error) => setErr(e.message)); };
  const Act = ({ label, title, onClick, primary }: { label: string; title: string; onClick: () => void; primary?: boolean }) => (
    <button type="button" title={title} onClick={onClick} className={cn('rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors', primary ? 'border-accent/60 bg-accent/15 text-accent hover:bg-accent/25' : 'border-line text-muted hover:border-fg/40 hover:text-fg')}>{label}</button>
  );
  const Head = ({ children, first }: { children: string; first?: boolean }) => <div className={cn('px-3 pb-0.5 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted', !first && 'mt-1 border-t border-line/60')}>{children}</div>;
  // where the sound comes out right now, in one line
  const spotifyActive = engine === 'spotify' && !remoteId;
  const where = remote ? `Controlling ${remote.name}` : spotifyActive ? `Spotify on ${chosenName || 'a Spotify device'}` : 'This device';
  const row = (d: DeviceInfo) => {
    const mine = d.id === me;
    const track = (mine ? hereTrack : d.state?.trackId) ? lib.trackById.get((mine ? hereTrack : d.state?.trackId)!) : undefined;
    const Icon = iconFor(d);
    const playing = mine ? playingHere : d.state?.playing;
    const linked = d.id === remoteId;
    const active = mine ? !remoteId && !spotifyActive : linked;
    return (
      <div key={d.id} role="group" aria-label={d.name} data-selected={active || undefined} className="px-3 py-2 text-sm">
        <div className="flex items-center gap-3">
          <Icon size={18} className={cn('shrink-0', active ? 'text-accent' : 'text-muted')} />
          <span className="min-w-0 flex-1">
            <span className={cn('flex items-center gap-1.5 font-medium', active && 'text-accent')}><span className="truncate">{mine ? `${d.name} (this device)` : d.name}</span>{playing && <Radio size={12} className="shrink-0 animate-pulse" aria-label="Playing" />}</span>
            <span className="block truncate text-xs text-muted">{linked ? 'Controlled from here · ' : ''}{track ? `${track.title} · ${track.artistName}` : 'Nothing playing'}</span>
          </span>
          {active && <Check size={16} className="shrink-0 text-accent" />}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1.5 pl-[30px]">
          {mine ? (remote && <>
            <Act primary label="Play here" title="Bring what that device is playing to this one" onClick={() => run(() => pullFrom(remote.id))} />
            <Act label="Disconnect" title="Stop controlling it; it keeps playing" onClick={() => run(() => disconnect())} />
          </>) : <>
            {d.state?.trackId && <Act primary label="Play here" title="Move what this device is playing to the one you are using now" onClick={() => run(() => pullFrom(d.id))} />}
            {canSend && !linked && <Act primary={!d.state?.trackId} label="Send there" title="Move what is playing here to that device" onClick={() => run(() => pushTo(d.id))} />}
            {canSend && <Act label="Play on both" title="Start the same track there and keep playing here too" onClick={() => run(() => pushTo(d.id, { keepHere: true }))} />}
            {!linked && <Act label="Control" title="Use this device as its remote, without moving anything" onClick={() => run(() => control(d.id))} />}
            {linked && <Act label="Disconnect" title="Stop controlling it; it keeps playing" onClick={() => run(() => disconnect())} />}
          </>}
        </div>
      </div>);
  };
  return (
    <div className="py-1">
      <div className="flex items-center gap-2 px-3 pb-1 pt-1 text-xs text-muted" role="status"><Radio size={12} className={cn('shrink-0', (remote?.state?.playing ?? playingHere) && 'animate-pulse text-accent')} />Sound is coming from: <b className="truncate text-fg">{where}</b></div>
      <Head first>This device</Head>
      {mineDevice ? row(mineDevice) : <p className="px-3 py-2 text-xs text-muted">Registering this device…</p>}
      <Head>Other TurboMusic devices</Head>
      {others.length ? others.map(row) : <p className="px-3 py-2 text-xs text-muted">None yet. Open TurboMusic on another device that uses this server and it appears here, so you can play on it from here or move what is playing between them.</p>}
      {spotify.length > 0 && <>
        <Head>Spotify devices</Head>
        {spotify.map((d) => {
          const selected = !!d.id && chosen === d.id;
          const playing = selected && spotifyActive;
          const isSoloist = !!soloist && d.name === soloist.deviceName;
          return (
            <button key={d.id || d.name} type="button" disabled={d.restricted} data-selected={selected || undefined} className={cn('flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-raised/60', d.restricted && 'cursor-not-allowed opacity-60 hover:bg-transparent')} aria-label={`Spotify device ${d.name}`}
              title={d.restricted ? 'Spotify does not let other apps control this device (it reports it as restricted)' : selected ? 'Spotify tracks play here' : 'Play Spotify tracks on this device'} onClick={() => run(() => chooseSpotifyDevice(d), false)}>
              {d.type.toLowerCase() === 'speaker' ? <Speaker size={18} className={cn('shrink-0', selected ? 'text-accent' : 'text-muted')} /> : <Music size={18} className={cn('shrink-0', selected ? 'text-accent' : 'text-muted')} />}
              <span className="min-w-0 flex-1"><span className={cn('flex items-center gap-1.5 font-medium', selected && 'text-accent')}><span className="truncate">{d.name}</span>{playing && <Radio size={12} className="shrink-0 animate-pulse" aria-label="Playing" />}</span>
                <span className="block truncate text-xs text-muted">{isSoloist ? `Soloist on ${soloist!.host}` : `Spotify · ${d.type}`}{d.restricted ? ' · restricted by Spotify' : ''}{d.active ? ' · active' : ''}{playing ? ' · playing from TurboMusic' : selected ? ' · where Spotify tracks play' : ''}</span></span>
              {selected && <Check size={16} className="shrink-0 text-accent" />}
            </button>);
        })}
      </>}
      {!spotify.length && spotifyNote && <p className="border-t border-line/60 px-3 py-2 text-xs text-muted" role="status">{spotifyNote}</p>}
      {notLocal && <div className="mt-1 space-y-1.5 border-t border-line/60 px-3 pb-1 pt-2.5">
        {remote && <button type="button" className="btn w-full justify-center" onClick={() => run(() => localOnly({ pauseRemote: true }))} title="Stop controlling the other device and pause it, then play on this one"><Unplug size={15} />Play here and pause {remote.name}</button>}
        <button type="button" className="btn w-full justify-center" onClick={() => run(() => localOnly())} title="Stop controlling other devices, pause Spotify and stop its stream, so the next track starts here at once"><Unplug size={15} />Play on this device only</button>
        <p className="text-[11px] leading-snug text-muted">Disconnects from other TurboMusic devices and from Spotify, so local tracks start straight away. The other device keeps playing unless you use the button above.</p>
      </div>}
      {err && <p className="px-3 pb-2 text-xs text-bad">{err}</p>}
    </div>
  );
}

/** Opens above the player bar. */
export function DevicesPopover({ anchor }: { anchor: HTMLElement | null }) {
  const open = usePopups((s) => s.devicesOpen);
  return (
    <Popover open={open} anchor={anchor} onClose={usePopups.getState().closeDevices} align="right" label="Devices" className="w-80 max-w-[calc(100vw-1.5rem)]">
      <div className="border-b border-line/60 px-3 py-2 text-sm font-semibold">Play on a device</div>
      <div className="max-h-[55vh] overflow-y-auto"><DeviceList onPick={usePopups.getState().closeDevices} /></div>
    </Popover>
  );
}

/** The top-bar button: reachable even when the player bar is hidden (nothing is playing here but another device is). */
export function DevicesMenu() {
  const [open, setOpen] = useState(false);
  const count = useConnect((s) => s.devices.length);
  const remote = useConnect((s) => s.remoteId);
  const configured = useStore((s) => !!s.settings.token);
  if (!configured) return null;
  return (
    <div className="relative">
      <button type="button" className={cn('btn btn-ghost !p-2', remote && 'text-accent')} aria-haspopup="menu" aria-expanded={open} title="Play on a device" aria-label="Play on a device" onClick={() => setOpen(!open)}>
        <Cast size={16} />{count > 1 && <span className="text-xs tabular-nums">{count}</span>}</button>
      {open && <>
        <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
        <div role="menu" className="bt-menu absolute right-0 z-30 mt-2 w-72 origin-top-right overflow-hidden"><DeviceList onPick={() => setOpen(false)} /></div></>}
    </div>
  );
}
