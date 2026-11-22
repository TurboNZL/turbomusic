import { useChunks } from '../lib/useChunks.ts';
import { Link } from 'react-router-dom';
import { useLibraryLive } from '../lib/derive.ts';
import type { TopRow } from '../lib/listenStats.ts';
import { statsPath, type StatsKind } from '../lib/entityStats.ts';
import { Cover } from './Cover.tsx';
import { fmtHours } from './charts.tsx';
import { useEntityContext } from './EntityContext.tsx';

const FIRST = 24; // a whole number of rows at every common width (2, 3, 4, 6 and 8 columns)

/** One kind of top list as a grid of pictures with the numbers underneath, like stats.fm. Rows that are in the library link to their stats page. */
function Section({ title, kind, rows, byTime, image }: { title: string; kind: Exclude<StatsKind, 'era' | 'playlist'>; rows: TopRow[]; byTime: boolean; image: (r: TopRow) => string | null | undefined }) {
  const sorted = [...rows].sort((a, b) => (byTime ? b.ms - a.ms : b.plays - a.plays) || b.ms - a.ms);
  const { ctx, element } = useEntityContext();
  const CH = useChunks(sorted.length, FIRST, `${kind}|${byTime}|${sorted.length}`);
  if (!sorted.length) return null;
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(var(--grid-min), 9rem), 1fr))' }}>
        {sorted.slice(0, CH.shown).map((r, i) => {
          const to = r.id ? statsPath(kind, r.id) : null;
          const art = <Cover kind={kind === 'artist' ? 'artist' : 'album'} hash={image(r)} seed={r.label} className="transition-transform group-hover:scale-[1.02]" />;
          const name = <span className="bt-cap-t mt-2 block truncate text-sm font-medium" title={r.label}>{r.label}</span>;
          return (
            <div key={r.key} className="bt-tile group" onContextMenu={ctx(r.id ? { kind, id: r.id } : null)}>
              <div className="relative">
                {to ? <Link to={to} aria-label={`${r.label}: stats`} className="block">{art}</Link> : art}
                <span className="absolute left-1.5 top-1.5 flex h-6 min-w-6 items-center justify-center rounded-full bg-bg/80 px-1.5 text-xs font-bold tabular-nums backdrop-blur-sm">{i + 1}</span>
              </div>
              {to ? <Link to={to} className="hover:underline">{name}</Link> : name}
              {r.sub && <span className="bt-cap block truncate text-xs text-muted">{r.sub}</span>}
              <span className="bt-cap block text-xs tabular-nums text-muted">{byTime ? `${fmtHours(r.ms)} · ${r.plays.toLocaleString()} plays` : `${r.plays.toLocaleString()} plays · ${fmtHours(r.ms)}`}</span>
            </div>);
        })}
      </div>
      {element}
      {CH.left > 0 && <div ref={CH.sentinel} className="flex gap-2"><button className="btn" onClick={CH.more}>Show {Math.min(FIRST, CH.left)} more</button></div>}
    </section>
  );
}

/** Top artists, albums and tracks as picture grids (the Top tab's "Grid" view). */
export function TopGrid({ artists, albums, tracks, byTime }: { artists: TopRow[]; albums: TopRow[]; tracks: TopRow[]; byTime: boolean }) {
  const lib = useLibraryLive();
  return (
    <div className="space-y-8">
      <Section title="Artists" kind="artist" rows={artists} byTime={byTime} image={(r) => (r.id ? lib.artistById.get(r.id)?.image : null)} />
      <Section title="Albums" kind="album" rows={albums} byTime={byTime} image={(r) => (r.id ? lib.albumById.get(r.id)?.cover : null)} />
      <Section title="Tracks" kind="track" rows={tracks} byTime={byTime} image={(r) => (r.id ? lib.trackById.get(r.id)?.cover : null)} />
    </div>
  );
}
