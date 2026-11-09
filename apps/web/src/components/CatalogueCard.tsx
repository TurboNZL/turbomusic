import { useEffect, useState } from 'react';
import { Database, HardDrive, Library as LibraryIcon } from 'lucide-react';
import { useLibrary } from '../lib/derive.ts';
import { api, useStore } from '../lib/store.ts';
import { cacheBytes } from '../lib/files.ts';
import { fmtBytes } from '../lib/cn.ts';

/** How big the catalogue is: what it holds, and how much room the library's files take on the server and on this device. */
export function CatalogueCard() {
  const lib = useLibrary();
  const configured = useStore((s) => !!s.settings.token);
  const [server, setServer] = useState<{ files: { count: number; bytes: number }; disk: { free?: number; total?: number } } | null | 'error'>(null);
  const audioCache = useStore((s) => s.audioCache);
  const local = cacheBytes(audioCache);
  useEffect(() => {
    let live = true;
    if (configured) api().status().then((s) => live && setServer(s as never)).catch(() => live && setServer('error'));
    return () => { live = false; };
  }, [configured]);
  const withAudio = lib.tracks.filter((t) => t.file).length;
  const stats: [string, number][] = [['songs', lib.tracks.length], ['albums', lib.albums.length], ['artists', lib.artists.length], ['releases', lib.releases.length], ['playlists', lib.playlists.length], ['eras', lib.eras.length]];
  const s = server && server !== 'error' ? server : null;
  const perSong = s && withAudio ? s.files.bytes / withAudio : null;
  return (
    <section className="card space-y-3 p-4">
      <div className="flex items-center gap-2"><LibraryIcon size={18} className="text-accent" /><h2 className="font-semibold">Catalogue size</h2></div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">{stats.map(([label, n]) => (
        <div key={label} className="rounded-theme bg-raised/60 px-3 py-2"><div className="text-xl font-bold tabular-nums">{n.toLocaleString()}</div><div className="text-[11px] uppercase tracking-wider text-muted">{label}</div></div>))}</div>
      <div className="grid gap-2 text-sm sm:grid-cols-3">
        <div className="flex items-center gap-2"><Database size={16} className="shrink-0 text-muted" /><span><b className="tabular-nums">{s ? fmtBytes(s.files.bytes) : configured ? (server === 'error' ? 'unavailable' : '…') : '—'}</b> <span className="text-muted">on the server ({s ? `${s.files.count.toLocaleString()} files` : 'audio and pictures'})</span></span></div>
        <div className="flex items-center gap-2"><HardDrive size={16} className="shrink-0 text-muted" /><span><b className="tabular-nums">{fmtBytes(local)}</b> <span className="text-muted">kept on this device</span></span></div>
        <div className="flex items-center gap-2 text-muted"><span>{withAudio.toLocaleString()} of {lib.tracks.length.toLocaleString()} songs have audio{perSong ? ` · about ${fmtBytes(perSong)} each` : ''}</span></div>
      </div>
      {s?.disk && typeof s.disk.total === 'number' && typeof s.disk.free === 'number' && s.disk.total > 0 && (
        <div><div className="h-1.5 overflow-hidden rounded-full bg-raised"><div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, ((s.disk.total - s.disk.free) / s.disk.total) * 100)}%` }} /></div>
          <div className="mt-1 text-xs text-muted">The server's drive: {fmtBytes(s.disk.total - s.disk.free)} used, {fmtBytes(s.disk.free)} free of {fmtBytes(s.disk.total)}</div></div>)}
      {!configured && <p className="text-xs text-muted">Connect a server (Settings) to see how much space the library takes there.</p>}
    </section>
  );
}
