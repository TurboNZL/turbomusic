import { useEffect, useRef, useState } from 'react';
import { AudioLines, Download, ScanSearch } from 'lucide-react';
import { api, useStore } from '../lib/store.ts';
import { useLibrary } from '../lib/derive.ts';
import { claimedKbps, qualityOf, runAudioCheck, type CheckProgress } from '../lib/audioCheck.ts';
import { cn } from '../lib/cn.ts';
import { fresh, peek } from '../lib/swr.ts';

const Bar = ({ value, tone = 'accent' }: { value: number; tone?: 'accent' | 'good' | 'warn' }) => (
  <div className="h-2 overflow-hidden rounded-full bg-raised"><div className={cn('h-full rounded-full transition-[width] duration-500', tone === 'good' ? 'bg-good' : tone === 'warn' ? 'bg-warn' : 'bg-accent')} style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }} /></div>
);

/** Downloads the audio of tracks that only have a YouTube link (runs on the server). Moved here from Settings. */
export function MissingAudioCard() {
  const lib = useLibrary(true);
  const configured = useStore((s) => !!s.settings.token);
  const [msg, setMsg] = useState<string | null>(null);
  const [st, setSt] = useState<{ queued: number; running: number; done: number; failed: number; failures: { trackId: string; error: string; dead?: boolean }[]; active?: { trackId: string; stage: 'downloading' | 'converting'; percent: number }[] } | null>(null);
  const timer = useRef<number>(0);
  const withAudio = lib.tracks.filter((t) => t.file).length;
  const missing = lib.tracks.filter((t) => !t.file && t.youtubeMusicUrl).length;

  async function poll() {
    try { const r = await api().acquireStatus(); setSt(r); if (r.queued + r.running === 0) { window.clearInterval(timer.current); timer.current = 0; } }
    catch { setMsg('Could not reach the server.'); window.clearInterval(timer.current); timer.current = 0; }
  }
  // the first look may be a minute old (coming back to this page); a running queue is polled live below
  useEffect(() => { if (configured) void fresh('acquire-status', 30_000, () => api().acquireStatus()).then((r) => { setSt(r); if (r.queued + r.running > 0 && !timer.current) timer.current = window.setInterval(() => void poll(), 1500); }).catch(() => undefined); return () => window.clearInterval(timer.current); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  async function start() {
    try { const r = await api().acquire(); setMsg(`Queued ${r.queued} tracks.`); await poll(); if (!timer.current) timer.current = window.setInterval(() => void poll(), 1500); }
    catch { setMsg('Could not reach the server.'); }
  }
  const total = st ? st.queued + st.running + st.done + st.failed : 0;
  const needsCookies = st?.failures.some((f) => /cookies|not a bot/i.test(f.error));
  return (
    <section className="card space-y-3 p-4">
      <div className="flex items-center gap-2"><Download size={18} className="text-accent" /><h2 className="font-semibold">Missing audio</h2></div>
      <div className="text-sm text-muted"><span className="text-lg font-semibold text-fg">{withAudio}</span> of {lib.tracks.length} tracks have audio · {missing} have a YouTube source and no file</div>
      <Bar value={lib.tracks.length ? withAudio / lib.tracks.length : 0} tone="good" />
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn btn-accent" onClick={() => void start()} disabled={!configured || !missing}><Download size={15} />Download missing audio</button>
        <button className="btn" onClick={() => void poll()} disabled={!configured}>Refresh</button>
        {!configured && <span className="text-xs text-muted">Needs a server (Settings).</span>}
      </div>
      {st && total > 0 && <div className="space-y-1"><Bar value={total ? (st.done + st.failed) / total : 0} /><div className="text-xs text-muted">{st.queued} queued · {st.running} running · {st.done} done · {st.failed} failed</div></div>}
      {st?.active && st.active.length > 0 && <ul className="space-y-2" aria-label="Downloading now">{st.active.map((a) => (
        <li key={a.trackId} className="space-y-1">
          <div className="flex items-baseline gap-2 text-xs"><span className="min-w-0 flex-1 truncate font-medium">{lib.trackById.get(a.trackId)?.title ?? 'A track'}</span><span className="shrink-0 tabular-nums text-muted">{a.stage === 'converting' ? 'converting to MP3…' : `${a.percent}%`}</span></div>
          <div role="progressbar" aria-valuenow={a.percent} aria-valuemin={0} aria-valuemax={100}><Bar value={a.percent / 100} tone={a.stage === 'converting' ? 'good' : 'accent'} /></div>
        </li>))}</ul>}
      {msg && <div className="text-xs text-muted">{msg}</div>}
      {st && st.failures.length > 0 && (
        <div className="space-y-1 rounded-theme bg-bad/10 p-3 text-xs" role="status">
          <div className="font-medium text-bad">Failed downloads (press the button to try them again)</div>
          <ul className="max-h-40 space-y-0.5 overflow-y-auto">{st.failures.map((f, i) => <li key={i}><span className="font-medium">{lib.trackById.get(f.trackId)?.title ?? f.trackId}</span>{f.dead && <span className="ml-1 rounded bg-bad/20 px-1 text-bad">dead link</span>}<span className="text-muted"> — {f.error}</span></li>)}</ul>
          {needsCookies && <div className="pt-1 text-warn">YouTube is asking this server to prove it is not a bot. Give yt-dlp a cookies file: see docs/guides/YTDLP_COOKIES.md.</div>}
        </div>)}
      <p className="text-xs text-muted">Downloads run on the server and need yt-dlp and ffmpeg installed there.</p>
    </section>
  );
}

/** Re-measures the audio files (real bit rate and the highest frequency that has sound) to find "320"s that are really low-quality sources. */
export function AudioQualityCard() {
  const lib = useLibrary(true);
  const configured = useStore((s) => !!s.settings.token);
  const patch = useStore((s) => s.patch);
  const [p, setP] = useState<CheckProgress | null>(null);
  const withFile = lib.tracks.filter((t) => t.file);
  const checked = withFile.filter((t) => qualityOf(t) !== 'unchecked').length;
  const bad = withFile.filter((t) => ['transcode', 'mismatch'].includes(qualityOf(t)));
  const fixable = withFile.filter((t) => t.audioCheck && t.audioCheck.kbps && qualityOf(t) !== 'unchecked' && claimedKbps(t.bitrate) !== t.audioCheck.kbps);
  return (
    <section className="card space-y-3 p-4">
      <div className="flex items-center gap-2"><AudioLines size={18} className="text-accent" /><h2 className="font-semibold">Audio quality</h2></div>
      <div className="text-sm text-muted"><span className="text-lg font-semibold text-fg">{checked}</span> of {withFile.length} files measured · <span className={bad.length ? 'font-medium text-warn' : ''}>{bad.length} suspicious</span></div>
      <Bar value={withFile.length ? checked / withFile.length : 0} />
      <p className="text-xs text-muted">The server reads each file's real bit rate and finds the highest frequency that still has sound. A “320” whose sound stops at 16 kHz was made from a lower-quality source. It is a strong hint, not proof: quiet or old recordings can look the same.</p>
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn btn-accent" disabled={!configured || p?.running || !withFile.length} onClick={() => void runAudioCheck(lib.tracks, setP)}><ScanSearch size={15} />Check audio quality</button>
        <button className="btn" disabled={!configured || p?.running || !checked} onClick={() => void runAudioCheck(lib.tracks, setP, true)}>Measure everything again</button>
        <button className="btn" disabled={!fixable.length} title="Replace the stored bit rate with what each file measures" onClick={() => confirm(`Set the stored bit rate of ${fixable.length} tracks to what they measure?`) && fixable.forEach((t) => patch('tracks', t.id, { bitrate: `${t.audioCheck!.kbps} kbps` }))}>Use measured bit rates ({fixable.length})</button>
        {!configured && <span className="text-xs text-muted">Needs a server (Settings).</span>}
      </div>
      {p && <div className="space-y-1"><Bar value={p.total ? p.done / p.total : 1} /><div className="text-xs text-muted">{p.running ? 'Measuring… ' : 'Done. '}{p.done}/{p.total}{p.failed ? ` · ${p.failed} failed (needs ffmpeg on the server)` : ''}</div></div>}
    </section>
  );
}
