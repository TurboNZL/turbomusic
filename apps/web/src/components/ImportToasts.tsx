import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, SearchX, X } from 'lucide-react';
import { dismissImportJob, openImportJob, startImportSearch, useImportJobs, type ImportJob } from '../lib/openImport.ts';

const secs = (j: ImportJob, now: number) => Math.max(0, Math.round((now - j.startedAt) / 1000));

/** Progress of YouTube Music album searches: leave the page, come back, open one whenever it suits. Sits above the player bar. */
export function ImportToasts() {
  const jobs = useImportJobs((s) => s.jobs);
  const [now, setNow] = useState(Date.now());
  const running = jobs.some((j) => j.status === 'searching');
  useEffect(() => { if (!running) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [running]);
  if (!jobs.length) return null;
  return (
    <div className="pointer-events-none fixed bottom-[calc(8.5rem+env(safe-area-inset-bottom))] right-3 z-[55] flex w-[min(22rem,calc(100vw-1.5rem))] flex-col gap-2 md:bottom-24" role="region" aria-label="Import searches">
      {jobs.map((j) => (
        <div key={j.id} className="bt-menu pointer-events-auto flex items-start gap-3 rounded-theme p-3 text-sm shadow-lg" role="status">
          <span className="mt-0.5 shrink-0">
            {j.status === 'searching' ? <Loader2 size={18} className="animate-spin text-accent" /> : j.status === 'ready' ? <CheckCircle2 size={18} className="text-good" /> : j.status === 'empty' ? <SearchX size={18} className="text-warn" /> : <AlertTriangle size={18} className="text-bad" />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{j.title}</div>
            <div className="text-xs text-muted">
              {j.status === 'searching' && <>Searching YouTube Music… {secs(j, now)} s. You can keep using the app.</>}
              {j.status === 'ready' && <>{j.count} possible match{j.count === 1 ? '' : 'es'} found.</>}
              {j.status === 'empty' && <>Nothing found. You can search by hand or paste a link.</>}
              {j.status === 'failed' && <>The search failed: {j.error}</>}
            </div>
            {j.status === 'searching' && <div className="mt-2 h-1 overflow-hidden rounded-full bg-line"><div className="h-full w-1/3 animate-[bt-indeterminate_1.4s_ease-in-out_infinite] rounded-full bg-accent" /></div>}
            {j.status !== 'searching' && (
              <div className="mt-2 flex gap-2">
                {j.status === 'failed'
                  ? <button className="btn btn-accent !px-3 !py-1 text-xs" onClick={() => void startImportSearch(j.id, true)}>Try again</button>
                  : <button className="btn btn-accent !px-3 !py-1 text-xs" onClick={() => openImportJob(j.id)}>{j.status === 'ready' ? 'Open results' : 'Open import'}</button>}
                <button className="btn !px-3 !py-1 text-xs" onClick={() => dismissImportJob(j.id)}>Dismiss</button>
              </div>
            )}
          </div>
          <button className="shrink-0 text-muted hover:text-fg" aria-label="Hide" onClick={() => dismissImportJob(j.id)}><X size={14} /></button>
        </div>
      ))}
    </div>
  );
}
