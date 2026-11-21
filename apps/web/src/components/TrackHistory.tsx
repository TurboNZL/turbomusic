import type { TrackInfo } from '../lib/trackinfo.ts';
import { cn } from '../lib/cn.ts';

/** compact on phones: "21 Nov 2026, 14:05" */
const fmtWhen = (ts: number) => new Date(ts).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export const fmtListened = (s: number) => (s >= 3600 ? `${(s / 3600).toFixed(1)} h` : s >= 60 ? `${Math.round(s / 60)} min` : `${Math.round(s)} s`);

/** A track's play history and vote record, as two scrolling lists. */
export function TrackHistory({ info, track }: { info: TrackInfo; track: { memories?: number } }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2 2xl:grid-cols-3">
      <div className="min-w-0">
        <div className="mb-1 text-sm font-medium">Play history ({info.history.length})</div>
        {!info.history.length && <p className="text-sm text-muted">No plays yet, in TurboMusic or in imported Spotify history.</p>}
        {info.history.length > 0 && <div className="max-h-72 divide-y divide-line/60 overflow-y-auto rounded-theme border border-line">{info.history.map((h) => (
          <div key={h.logId} className="flex min-w-0 items-center gap-2 px-3 py-1.5 text-sm sm:gap-3">
            <span className={cn('w-11 shrink-0 text-[11px] font-semibold uppercase sm:w-12 sm:text-xs', h.isSkip ? 'text-warn' : 'text-good')}>{h.isSkip ? 'skip' : 'played'}</span>
            <span className="min-w-0 flex-1 truncate text-muted">{fmtListened(h.seconds)} · {h.imported ? 'on Spotify' : `from ${h.source ?? 'unknown'}`}</span>
            <span className="shrink-0 whitespace-nowrap text-[11px] text-muted sm:text-xs">{fmtWhen(h.timestamp)}</span></div>))}</div>}
      </div>
      <div className="min-w-0">
        <div className="mb-1 text-sm font-medium">Votes ({info.votes.length})</div>
        {!info.votes.length && <p className="text-sm text-muted">No votes yet. Use Rank to compare it with other tracks.</p>}
        {info.votes.length > 0 && <div className="max-h-72 divide-y divide-line/60 overflow-y-auto rounded-theme border border-line">{info.votes.map((v) => (
          <div key={v.voteId} className="flex min-w-0 items-center gap-2 px-3 py-1.5 text-sm sm:gap-3">
            <span className={cn('w-16 shrink-0 text-[11px] font-semibold uppercase sm:w-20 sm:text-xs', v.result === 'won' || v.result === 'thumb up' ? 'text-good' : v.result === 'lost' || v.result === 'thumb down' ? 'text-bad' : 'text-muted')}>{v.result}</span>
            <span className={cn('min-w-0 flex-1 truncate', !v.opponentExists && 'italic text-muted')}>{v.opponent}</span>
            <span className="shrink-0 text-xs text-muted">{new Date(v.timestamp).toLocaleDateString()}</span></div>))}</div>}
      </div>
      <div className="min-w-0">
        <div className="mb-1 text-sm font-medium">Memories ({track.memories ?? 0})</div>
        {!info.memories.length && <p className="text-sm text-muted">{(track.memories ?? 0) > 0 ? 'Added before dates were recorded.' : 'No memories yet.'}</p>}
        {info.memories.length > 0 && <div className="max-h-72 divide-y divide-line/60 overflow-y-auto rounded-theme border border-line">{info.memories.map((m) => (
          <div key={m.id} className="flex min-w-0 items-center gap-2 px-3 py-1.5 text-sm sm:gap-3">
            <span className="w-11 shrink-0 text-[11px] font-semibold uppercase sm:w-12 sm:text-xs text-good">added</span>
            <span className="min-w-0 flex-1" />
            <span className="shrink-0 whitespace-nowrap text-[11px] text-muted sm:text-xs">{fmtWhen(m.timestamp)}</span></div>))}
          {info.memories.length < (track.memories ?? 0) && <p className="px-3 py-1.5 text-xs text-muted">{(track.memories ?? 0) - info.memories.length} more from before dates were recorded.</p>}</div>}
      </div>
    </div>
  );
}
