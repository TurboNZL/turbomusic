import { useMemo, useState } from 'react';
import { History } from 'lucide-react';
import { useLibrary } from '../lib/derive.ts';
import { buildListens } from '../lib/listens.ts';
import { historyCandidates } from '../lib/historyEntities.ts';
import { planImport } from '../lib/spotifyImport.ts';
import { createFromPlan } from '../lib/spotifyCreate.ts';
import { useStore } from '../lib/store.ts';

/** Settings > Spotify > Library: make artists, albums and songs for what only exists in your listening history, so each has a page (hidden until imported). */
export function HistoryEntities() {
  const lib = useLibrary(true);
  const put = useStore((s) => s.put), patch = useStore((s) => s.patch);
  const [min, setMin] = useState(10);
  const [done, setDone] = useState<string | null>(null);
  const found = useMemo(() => historyCandidates(lib, buildListens(lib), min), [lib, min]);
  const run = () => {
    const plan = planImport(lib, found.list);
    const r = createFromPlan(lib, plan, { put, patch }, { makeAlbums: true });
    setDone(`Made ${r.albumsMade} album${r.albumsMade === 1 ? '' : 's'} and ${r.tracksMade} song${r.tracksMade === 1 ? '' : 's'}. They stay hidden until you import them or show them.`);
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2"><span className="font-medium">Pages for what you only played</span></div>
      <p className="text-xs text-muted">Artists, albums and songs that are only in your listening history get a page of their own (stats, links), kept hidden until they are imported.</p>
      <label className="flex flex-wrap items-center gap-2 text-xs">Only artists played at least<input type="number" min={1} max={500} className="input !w-20 !py-1" value={min} onChange={(e) => setMin(Math.max(1, Number(e.target.value) || 1))} />times</label>
      <p className="text-xs text-muted">{found.tracks ? `${found.artists.toLocaleString()} artist${found.artists === 1 ? '' : 's'} and ${found.tracks.toLocaleString()} song${found.tracks === 1 ? '' : 's'} (${found.plays.toLocaleString()} plays) have no page yet.` : 'Everything you played at least that often already has a page.'}</p>
      <button className="btn" disabled={!found.tracks} onClick={() => confirm(`Make pages for ${found.artists} artists and ${found.tracks} songs? They are hidden until imported.`) && run()}><History size={15} />Make the pages</button>
      {done && <p className="text-xs text-good" role="status">{done}</p>}
    </div>
  );
}
