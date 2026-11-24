import { useMemo, useState } from 'react';
import { useChunks } from '../lib/useChunks.ts';
import { PlayControls } from '../components/PlayControls.tsx';
import { ListToolbar } from '../components/ListToolbar.tsx';
import { matchesAll, splitTyped, trackSubject, type Chip } from '../lib/filters.ts';
import { playCounts } from '../lib/listens.ts';
import { TRACK_SORTS, sortTracks } from '../lib/trackSort.ts';
import { usePageState } from '../lib/pageState.ts';
import { canPlay } from '../lib/spotifyPlayer.ts';
import { Download, FileAudio, Play, Plus, Shuffle } from 'lucide-react';
import { shuffleWithRules } from '@turbomusic/core';
import { useLibrary } from '../lib/derive.ts';
import { HiddenToggle } from '../components/HiddenToggle.tsx';
import { unimportedOf } from '../lib/unimported.ts';
import { useEditor } from '../lib/editor.ts';
import { usePlayer } from '../lib/player.ts';
import { SingleGrid } from '../components/SingleCard.tsx';
import { TrackTable } from '../components/TrackTable.tsx';

/** Tracks that are not on any album. They have their own cover, and can be put on an album later (from the ⋯ menu or the track editor). */
export function SinglesPage() {
  const lib = useLibrary(true); // the Hidden switch below decides about what is not imported yet
  const [showHidden, setShowHidden] = useState(false);
  const hiddenIds = useMemo(() => unimportedOf(lib).tracks, [lib]);
  const edit = useEditor((s) => s.open);
  const play = usePlayer((s) => s.play);
  const [q, setQ] = useState('');
  const [chips, setChips] = useState<Chip[]>([]);
  const page = usePageState('singles', TRACK_SORTS, { sort: 'title' });
  // tracks on no album, plus songs on an album that also have a release marked as a single (their own stats page is the single's page)
  const allSingles = useMemo(() => {
    const own = new Set(lib.singles.map((t) => t.id));
    const extra = lib.singleReleases.flatMap((r) => { const t = lib.trackById.get(r.trackIds[0]); return t && !own.has(t.id) && own.add(t.id) ? [t] : []; });
    return [...lib.singles, ...extra].filter((t) => showHidden || !hiddenIds.has(t.id));
  }, [lib, showHidden, hiddenIds]);
  const singles = useMemo(() => {
    const needle = splitTyped(q, 'singles') ? '' : q.toLowerCase();
    return sortTracks(allSingles.filter((t) => `${t.title} ${t.artistName}`.toLowerCase().includes(needle) && matchesAll(chips, trackSubject(lib, t))), page.sort, page.dir, page.sort === 'plays' ? playCounts(lib) : undefined);
  }, [lib, allSingles, q, chips, page.sort, page.dir]);
  const playable = singles.filter(canPlay).map((t) => t.id);
  const CH = useChunks(singles.length, 48, `${q}|${chips.length}|${page.sort}|${page.dir}|${page.view}`);
  const shownSingles = singles.slice(0, CH.shown);
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-2xl font-bold">Singles <span className="text-base font-normal text-muted">{singles.length}</span></h1>
      </div>
      <ListToolbar actions={<><HiddenToggle count={lib.singles.filter((t) => hiddenIds.has(t.id)).length} on={showHidden} onChange={setShowHidden} noun="singles" /><PlayControls ids={playable} source={{ type: 'search', id: 'Singles' }} label="these singles" lineup={false} /></>} scope="singles" chips={chips} onChips={setChips} text={q} onText={setQ} placeholder="Search singles, or filter: artist, era, before…" sorts={TRACK_SORTS} sort={page.sort} dir={page.dir} onSort={page.setSort} onFlip={page.flip} view={page.view} onView={page.setView} />
      {!singles.length && <p className="text-sm text-muted">{allSingles.length ? 'No singles match.' : 'No singles. A single is a track that is not on an album: make one with New single, or take a track off its album in the track editor.'}</p>}
      {page.view === 'grid' ? <SingleGrid tracks={shownSingles} /> : <div className="card overflow-hidden"><TrackTable allowDelete tracks={shownSingles} queue={singles} source="search" sourceId="Singles" covers linkTitles /></div>}
      {CH.left > 0 && <div ref={CH.sentinel} className="mt-4 text-center"><button className="btn" onClick={CH.more}>Show more ({CH.left} left)</button></div>}
    </div>
  );
}
