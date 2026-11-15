import { useRef, useState } from 'react';
import { ThemedSelect } from './ThemedSelect.tsx';
import { Download, FileUp, Upload } from 'lucide-react';
import { Modal } from './forms.tsx';
import { useStore } from '../lib/store.ts';
import { useLibraryLive } from '../lib/derive.ts';
import { buildListens } from '../lib/listens.ts';
import { exportFiles, exportSpotifyFormat, historyRecords, type ExportPlay, type HistoryImport, type SpotifyHistoryEntry } from '../lib/spotify.ts';
import { readZip } from '../lib/zipRead.ts';
import { writeZip } from '../lib/zipWrite.ts';

/** Reads Spotify history out of .json files and .zip archives (the zip you get from Spotify's "Download your data"). */
export async function readHistoryFiles(files: File[]): Promise<{ entries: SpotifyHistoryEntry[]; used: string[]; ignored: string[] }> {
  const entries: SpotifyHistoryEntry[] = [], used: string[] = [], ignored: string[] = [];
  const take = (name: string, text: string) => {
    // only the "audio" files hold music plays; Video and the account files have other shapes
    if (/Streaming_History_Video/i.test(name)) { ignored.push(name); return; }
    try {
      const j = JSON.parse(text) as unknown;
      if (Array.isArray(j) && j.every((e) => e && typeof e === 'object')) { entries.push(...(j as SpotifyHistoryEntry[])); used.push(name); } else ignored.push(name);
    } catch { ignored.push(name); }
  };
  for (const f of files) {
    if (/\.zip$/i.test(f.name)) {
      for (const e of await readZip(await f.arrayBuffer(), (n) => /Streaming_History_Audio.*\.json$/i.test(n) || /StreamingHistory.*\.json$/i.test(n))) take(e.name, await e.text());
    } else take(f.name, await f.text());
  }
  return { entries, used, ignored };
}

/** Import a Spotify "Extended streaming history" (zip or json files) as plays. */
export function ImportHistoryDialog({ onClose }: { onClose: () => void }) {
  const importRecords = useStore((s) => s.importRecords);
  const deviceId = useStore((s) => s.settings.deviceId);
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<{ entries: SpotifyHistoryEntry[]; used: string[]; ignored: string[] } | null>(null);
  const [minSec, setMinSec] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const preview: HistoryImport | null = state ? historyRecords(state.entries, deviceId, { minMs: minSec * 1000 }) : null;

  async function pick(list: FileList | null) {
    if (!list?.length) return;
    setErr(null); setResult(null); setBusy('Reading…');
    try { setState(await readHistoryFiles([...list])); } catch (e) { setErr((e as Error).message); } finally { setBusy(null); if (input.current) input.current.value = ''; }
  }
  async function run() {
    if (!preview) return;
    let applied = 0;
    for (let i = 0; i < preview.records.length; i += 8000) {
      setBusy(`Importing ${Math.min(i + 8000, preview.records.length).toLocaleString()} of ${preview.records.length.toLocaleString()}…`);
      applied += (await importRecords(preview.records.slice(i, i + 8000), 'merge')).applied;
      await new Promise((r) => setTimeout(r, 0)); // let the page breathe between batches
    }
    setBusy(null);
    setResult(applied ? `Imported ${applied.toLocaleString()} plays${applied < preview.records.length ? ` (${(preview.records.length - applied).toLocaleString()} were already here)` : ''}.` : 'Nothing new: all of these plays were already imported.');
  }
  return (
    <Modal title="Import Spotify listening history" onClose={onClose} wide
      footer={<><button className="btn" onClick={onClose}>{result ? 'Done' : 'Cancel'}</button><button className="btn btn-accent ml-auto" disabled={!preview?.records.length || !!busy || !!result} onClick={() => void run()}><Upload size={15} />Import {preview ? preview.records.length.toLocaleString() : ''} plays</button></>}>
      <p className="text-sm text-muted">Request your data at spotify.com/account/privacy (choose <b>Extended streaming history</b>; it can take a few days to arrive). Choose the .zip as it came, or the <code>Streaming_History_Audio_*.json</code> files inside it. Importing the same file twice does not duplicate anything, and overlapping exports are fine.</p>
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn" disabled={!!busy} onClick={() => input.current?.click()}><FileUp size={15} />Choose files…</button>
        <input ref={input} type="file" multiple hidden accept=".zip,.json,application/json,application/zip" onChange={(e) => void pick(e.target.files)} />
        {state && <span className="text-xs text-muted">{state.used.length} file{state.used.length === 1 ? '' : 's'} read{state.ignored.length ? `, ${state.ignored.length} ignored` : ''}</span>}
      </div>
      {preview && (
        <div className="space-y-3 rounded-theme bg-raised p-3 text-sm">
          <div><b className="tabular-nums">{preview.records.length.toLocaleString()}</b> music plays{preview.from && preview.to ? <> from {new Date(preview.from).toLocaleDateString()} to {new Date(preview.to).toLocaleDateString()}</> : null}
            <span className="text-muted"> · {preview.notMusic.toLocaleString()} podcast/audiobook entries skipped{preview.tooShort ? ` · ${preview.tooShort.toLocaleString()} too short` : ''}</span></div>
          <label className="flex flex-wrap items-center gap-2 text-xs text-muted">Skip plays shorter than
            <ThemedSelect className="input !w-auto !py-1" value={minSec} onChange={(e) => setMinSec(Number(e.target.value))}><option value={0}>nothing (keep all)</option><option value={5}>5 seconds</option><option value={30}>30 seconds (like stats.fm)</option></ThemedSelect>
            <span>Plays you skipped within seconds stay in the history otherwise, marked as skips.</span></label>
        </div>)}
      {busy && <div className="text-sm text-muted" role="status">{busy}</div>}
      {result && <div className="rounded-theme bg-good/10 p-3 text-sm text-good" role="status">{result} They match your library by Spotify link first, then by title and artist, and show up in Stats.</div>}
      {err && <div className="text-sm text-bad">{err}</div>}
    </Modal>
  );
}

const download = (name: string, data: BlobPart, type: string) => {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
};

/** Export plays in Spotify's own file format, which stats.fm (and other Spotify-history tools) can read. */
export function ExportHistoryDialog({ onClose }: { onClose: () => void }) {
  const lib = useLibraryLive();
  const [includeImported, setIncludeImported] = useState(false);
  const all = buildListens(lib);
  const plays: ExportPlay[] = all.filter((l) => includeImported || l.source === 'turbomusic').map((l) => ({ ts: l.ts, ms: l.ms, title: l.title, artist: l.artist, album: l.album, uri: l.uri, skipped: l.skipped, shuffle: l.shuffle, platform: l.platform === 'TurboMusic' ? 'TurboMusic' : l.platform, reasonStart: null, reasonEnd: l.reasonEnd }));
  const { entries, dropped } = exportSpotifyFormat(plays);
  const files = exportFiles(entries);
  return (
    <Modal title="Export history for stats.fm" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Close</button>
        <button className="btn btn-accent ml-auto" disabled={!entries.length} onClick={() => download('turbomusic-streaming-history.zip', writeZip(files.map((f) => ({ name: `Spotify Extended Streaming History/${f.name}`, data: f.data }))), 'application/zip')}><Download size={15} />Download .zip</button></>}>
      <p className="text-sm text-muted">Writes your plays in the same format as Spotify's own “Extended streaming history”, so you can upload them to stats.fm (Import) or any tool that reads Spotify exports. Only plays of tracks that have a Spotify link can be matched there; the rest are left out.</p>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={includeImported} onChange={(e) => setIncludeImported(e.target.checked)} /><span>Include the plays I imported from Spotify <span className="text-muted">(off: only what you played in TurboMusic, since stats.fm already has the rest from Spotify)</span></span></label>
      <div className="rounded-theme bg-raised p-3 text-sm"><b className="tabular-nums">{entries.length.toLocaleString()}</b> plays in {files.length} file{files.length === 1 ? '' : 's'} (one set per year, each under 11.8 MiB){dropped ? <span className="text-muted"> · {dropped.toLocaleString()} left out (no Spotify link)</span> : null}</div>
      {!entries.length && <p className="text-sm text-muted">Nothing to export yet. Play music in TurboMusic, or tick the box above after importing.</p>}
      {files.length > 1 && <div className="flex flex-wrap gap-2">{files.map((f) => <button key={f.name} className="btn btn-ghost !text-xs" onClick={() => download(f.name, f.data, 'application/json')}><Download size={13} />{f.name} · {(f.bytes / 1048576).toFixed(1)} MiB</button>)}</div>}
      {files.length === 1 && <button className="btn btn-ghost !text-xs" onClick={() => download(files[0].name, files[0].data, 'application/json')}><Download size={13} />{files[0].name}</button>}
    </Modal>
  );
}
