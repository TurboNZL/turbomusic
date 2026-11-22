import { useEffect, useState } from 'react';
import { Link2, Loader2, RefreshCw } from 'lucide-react';
import { CandidateArt } from './CandidateArt.tsx';
import { Cover } from './Cover.tsx';
import { useLibraryLive } from '../lib/derive.ts';
import { useEditor } from '../lib/editor.ts';
import { cachedMatches, forgetMatches, prefetchMatches, topUnlinked } from '../lib/matchCache.ts';
import { useStore } from '../lib/store.ts';

/** Health: the five albums whose best songs have no YouTube Music link yet, each with its best search result already looked up and kept, so importing is one click. */
export function AlbumSuggestions() {
  const lib = useLibraryLive(true);
  const edit = useEditor((s) => s.open);
  const configured = useStore((s) => !!s.settings.token);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, bump] = useState(0);
  const top = topUnlinked(lib, 5);
  const key = top.map((a) => a.id).join(',');

  const run = () => {
    if (!configured || !top.length) return;
    setBusy(true); setError(null);
    prefetchMatches(lib, top).catch((e: Error) => setError(e.message === 'Failed to fetch' ? 'Cannot reach the server.' : e.message)).finally(() => { setBusy(false); bump((n) => n + 1); });
  };
  useEffect(run, [key, configured]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!top.length) return null;
  return (
    <section className="card space-y-2 p-4">
      <div className="flex items-center gap-2">
        <h2 className="flex-1 text-sm font-semibold">Albums to link: your top {top.length} without a YouTube Music link</h2>
        {busy && <Loader2 size={15} className="animate-spin text-muted" />}
        <button className="btn btn-ghost !p-1.5" aria-label="Search again" title="Search again" disabled={!configured || busy} onClick={() => { top.forEach((a) => forgetMatches(a.id)); run(); }}><RefreshCw size={14} /></button>
      </div>
      {error && <div className="text-xs text-bad">{error}</div>}
      {!configured && <div className="text-xs text-muted">Connect a server in Settings: it does the searching.</div>}
      <div className="divide-y divide-line/60">
        {top.map((a) => {
          const c = cachedMatches(a.id)?.[0];
          return (
            <div key={a.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
              <Cover hash={a.cover} seed={a.title} className="h-12 w-12 shrink-0" />
              <div className="min-w-0 flex-1 basis-40"><div className="truncate font-medium">{a.title}</div><div className="truncate text-xs text-muted">{a.artistName} · {a.trackIds.length} track{a.trackIds.length === 1 ? '' : 's'}</div></div>
              {c ? <>
                {(c.thumbnail || c.coverHash) && <CandidateArt c={c} className="h-12 w-12 shrink-0 rounded-theme bg-raised object-cover" />}
                <div className="min-w-0 flex-1 basis-44"><div className="truncate">{c.title}{c.edition && <span className="chip ml-2 !text-[10px]">{c.edition}</span>}</div>
                  <div className="truncate text-xs text-muted">{[c.owner ?? c.channel, c.count ? `${c.count} tracks` : ''].filter(Boolean).join(' · ')} · {Math.round(Math.min(1, c.score) * 100)}% match</div></div>
                <button className="btn btn-accent !py-1 text-xs" onClick={() => edit({ kind: 'import-into-album', id: a.id, url: c.url })}><Link2 size={13} />Import</button>
              </> : <span className="text-xs text-muted">{busy ? 'Searching…' : 'No result yet'}</span>}
              <button className="btn !py-1 text-xs" onClick={() => edit({ kind: 'import-into-album', id: a.id })}>More</button>
            </div>);
        })}
      </div>
    </section>
  );
}
