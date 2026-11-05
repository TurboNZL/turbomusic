import { useEffect, useState } from 'react';
import { Download, FileSpreadsheet, FileJson, FolderTree, Loader2, RefreshCw } from 'lucide-react';
import { api, useStore } from '../lib/store.ts';
import type { MirrorInfo } from '../lib/api.ts';
import { Field } from './forms.tsx';

const MODES = [
  { id: 'symlink', label: 'Links (no extra space)', hint: 'Each file is a shortcut to the real one. Best on Linux and macOS; some Windows setups need permission for links.' },
  { id: 'hardlink', label: 'Hard links (no extra space)', hint: 'Needs the folder to be on the same drive as the library. Survives the library moving.' },
  { id: 'copy', label: 'Copies (uses double the space)', hint: 'Plain independent files. Works everywhere, for example a drive that cannot do links.' },
] as const;

/**
 * Your music as files you can browse. TurboMusic keeps audio under its content hash; this makes a folder of Artist/Album/Title files that follows
 * the library (a mirror), and downloads that take the library with you if you ever move to something else.
 */
export function LibraryFilesCard() {
  const configured = useStore((s) => !!s.settings.token);
  const [m, setM] = useState<MirrorInfo | null>(null);
  const [dir, setDir] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = () => api().mirrorStatus().then((s) => { setM(s); setDir(s.dir ?? ''); }).catch((e: Error) => setErr(e.message));
  useEffect(() => { if (configured) void load(); }, [configured]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!configured) return <p className="text-sm text-muted">Connect to a server first (Settings › Server): the library files live there.</p>;

  const change = async (what: string, body: Parameters<ReturnType<typeof api>['mirrorSet']>[0]) => {
    setBusy(what); setErr(null);
    try { const s = await api().mirrorSet(body); setM(s); setDir(s.dir ?? ''); } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  };
  const go = (url: string) => { window.location.href = url; };
  return (
    <div className="space-y-5 text-sm">
      <div className="space-y-2">
        <h3 className="flex items-center gap-2 font-medium"><FolderTree size={16} />Browsable library</h3>
        <p className="text-muted">The library keeps songs under hash names, so you cannot find “Nova Sky / First / 01 One.mp3” by looking in the folder. Turn this on and the server also keeps a folder that looks like that: <b>Music/Artist/Album/01 Title.mp3</b>, plus <b>Playlists/*.m3u8</b>. It updates a few seconds after you change anything, and TurboMusic only ever deletes files it made there itself.</p>
        {m ? (<>
          <label className="flex items-center gap-2"><input type="checkbox" checked={m.enabled} disabled={!!busy} onChange={(e) => void change('toggle', { enabled: e.target.checked })} />Keep a browsable copy of the library</label>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="How files are placed" hint={MODES.find((x) => x.id === m.mode)?.hint}>
              <select className="input" value={m.mode} disabled={!!busy} onChange={(e) => void change('mode', { mode: e.target.value })}>{MODES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></Field>
            <Field label="Folder on the server" hint={`Empty = ${m.defaultDir}. A folder of your own must be empty.`}>
              <div className="flex gap-2"><input className="input font-mono" value={dir} placeholder={m.defaultDir} onChange={(e) => setDir(e.target.value)} />
                <button className="btn" disabled={!!busy || dir === (m.dir ?? '')} onClick={() => void change('dir', { dir: dir.trim() || null })}>Use</button></div></Field>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn" disabled={!!busy || m.running} onClick={() => void change('now', { now: true })}>{busy === 'now' ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}Refresh now</button>
            <span className="text-xs text-muted">{m.enabled ? <>Folder: <code>{m.effectiveDir}</code>. </> : 'Off. '}{m.last ? `Last run ${new Date(m.last.at).toLocaleString()}: ${m.last.linked} added, ${m.last.removed} removed${m.last.skipped ? `, ${m.last.skipped} missing on disk` : ''}.` : ''}</span>
          </div>
          {m.error && <div className="rounded-theme bg-bad/15 p-2 text-bad">{m.error}</div>}
        </>) : <div className="text-muted">{err ?? 'Loading…'}</div>}
      </div>

      <div className="space-y-2">
        <h3 className="flex items-center gap-2 font-medium"><Download size={16} />Take your library with you</h3>
        <p className="text-muted">Ways out that do not need TurboMusic to read them. Pick the one that fits where you are going.</p>
        <ul className="space-y-2">
          <li className="rounded-theme border border-line p-3"><div className="font-medium">Music folder (with audio)</div><p className="text-xs text-muted">One archive (.tar) with Music/Artist/Album/NN Title.ext, album covers, Playlists/*.m3u8, tracks.csv and library.json. Opens in any file manager and imports into Plex, Jellyfin, Navidrome, a phone. Big: it holds all your audio.</p>
            <button className="btn mt-1.5" onClick={() => go(api().libraryExportUrl(true))}><FolderTree size={15} />Download with audio</button></li>
          <li className="rounded-theme border border-line p-3"><div className="font-medium">Lists only (small)</div><p className="text-xs text-muted">The same archive without the audio: playlists, the spreadsheet and the data. Good for moving playlists and ratings to another service.</p>
            <button className="btn mt-1.5" onClick={() => go(api().libraryExportUrl(false))}><Download size={15} />Download without audio</button></li>
          <li className="rounded-theme border border-line p-3"><div className="font-medium">Spreadsheet</div><p className="text-xs text-muted">Every song as a row: title, artist, album, rating, comparisons, genres, links.</p>
            <button className="btn mt-1.5" onClick={() => go(api().dataExportUrl('csv'))}><FileSpreadsheet size={15} />Download tracks.csv</button></li>
          <li className="rounded-theme border border-line p-3"><div className="font-medium">Everything as one JSON file</div><p className="text-xs text-muted">Every record: artists, albums, releases, tracks, playlists, notes, votes, plays. The complete copy of the data in a plain, documented format.</p>
            <button className="btn mt-1.5" onClick={() => go(api().dataExportUrl('json'))}><FileJson size={15} />Download library.json</button></li>
        </ul>
        <p className="text-xs text-muted">The database file and the hash-named files (for restoring TurboMusic itself) are under “Backup: export and import” above.</p>
      </div>
      {err && m && <div className="rounded-theme bg-bad/15 p-2 text-bad">{err}</div>}
    </div>
  );
}
