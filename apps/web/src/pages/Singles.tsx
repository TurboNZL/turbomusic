import { useMemo, useState } from 'react';
import { ListToolbar } from '../components/ListToolbar.tsx';
import { matchesAll, splitTyped, trackSubject, type Chip } from '../lib/filters.ts';
import { playCounts } from '../lib/listens.ts';
import { TRACK_SORTS, sortTracks } from '../lib/trackSort.ts';
import { usePageState } from '../lib/pageState.ts';
import { canPlay } from '../lib/spotifyPlayer.ts';
import { Download, FileAudio, Play, Plus, Shuffle } from 'lucide-react';
import { shuffleWithRules } from '@turbomusic/core';
import { useLibrary } from '../lib/derive.ts';
import { useEditor } from '../lib/editor.ts';
import { usePlayer } from '../lib/player.ts';
import { SingleGrid } from '../components/SingleCard.tsx';
import { TrackTable } from '../components/TrackTable.tsx';

/** Tracks that are not on any album. They have their own cover, and can be put on an album later (from the ⋯ menu or the track editor). */
export function SinglesPage() {
  const lib = useLibrary();
  const edit = useEditor((s) => s.open);
  const play = usePlayer((s) => s.play);
  const [q, setQ] = useState('');
  const [chips, setChips] = useState<Chip[]>([]);
  const page = usePageState('singles', TRACK_SORTS, { sort: 'title' });
  const singles = useMemo(() => {
    const needle = splitTyped(q, 'singles') ? '' : q.toLowerCase();
    return sortTracks(lib.singles.filter((t) => `${t.title} ${t.artistName}`.toLowerCase().includes(needle) && matchesAll(chips, trackSubject(lib, t))), page.sort, page.dir, page.sort === 'plays' ? playCounts(lib) : undefined);
  }, [lib, q, chips, page.sort, page.dir]);
  const playable = singles.filter(canPlay).map((t) => t.id);
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-2xl font-bold">Singles <span className="text-base font-normal text-muted">{singles.length}</span></h1>
        <button className="btn btn-accent" disabled={!playable.length} onClick={() => play(playable[0], playable, { type: 'search', id: null })}><Play size={15} fill="currentColor" />Play</button>
        <button className="btn" disabled={!playable.length} onClick={() => { const s = shuffleWithRules(playable, lib.rules); play(s[0], s, { type: 'search', id: null }); }}><Shuffle size={15} />Shuffle</button>
        <button className="btn" onClick={() => edit({ kind: 'import', id: 'single' })}><Download size={15} />Import from YouTube</button>
        <button className="btn" onClick={() => edit({ kind: 'new-track', id: '' })}><Plus size={15} />New single</button>
        <button className="btn" onClick={() => edit({ kind: 'upload', id: '' })}><FileAudio size={15} />Add files</button>
      </div>
      <ListToolbar scope="singles" chips={chips} onChips={setChips} text={q} onText={setQ} placeholder="Search singles, or filter: artist, era, before…" sorts={TRACK_SORTS} sort={page.sort} dir={page.dir} onSort={page.setSort} onFlip={page.flip} view={page.view} onView={page.setView} />
      {!singles.length && <p className="text-sm text-muted">{lib.singles.length ? 'No singles match.' : 'No singles. A single is a track that is not on an album: make one with New single, or take a track off its album in the track editor.'}</p>}
      {page.view === 'grid' ? <SingleGrid tracks={singles} /> : <div className="card overflow-hidden"><TrackTable tracks={singles} source="search" covers /></div>}
    </div>
  );
}
