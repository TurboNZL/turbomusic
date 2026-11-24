import { PlayControls } from '../components/PlayControls.tsx';
import { HiddenToggle } from '../components/HiddenToggle.tsx';
import { unimportedOf } from '../lib/unimported.ts';
import { ListToolbar } from '../components/ListToolbar.tsx';
import { SingleGrid } from '../components/SingleCard.tsx';
import { usePageState } from '../lib/pageState.ts';
import { canPlay } from '../lib/spotifyPlayer.ts';
import { makeChip, matchesAll, splitTyped, trackSubject, type Chip, type FilterKey } from '../lib/filters.ts';
import { useSearchParams } from 'react-router-dom';
import { useMemo, useState } from 'react';
import { useChunks } from '../lib/useChunks.ts';
import { useLibrary } from '../lib/derive.ts';
import { Play, Shuffle } from 'lucide-react';
import { shuffleWithRules } from '@turbomusic/core';
import { usePlayer } from '../lib/player.ts';
import { playCounts } from '../lib/listens.ts';
import { TRACK_SORTS, sortTracks } from '../lib/trackSort.ts';
import { TrackTable } from '../components/TrackTable.tsx';

const PAGE = 100;

export function TracksPage() {
  const lib = useLibrary(true); // the Hidden switch below decides about what is not imported yet
  const [showHidden, setShowHidden] = useState(false);
  const hiddenIds = useMemo(() => unimportedOf(lib).tracks, [lib]);
  const play = usePlayer((s) => s.play);
  const [params] = useSearchParams();
  // /tracks?track=<id> (Go to track, for a single) starts with its title typed in, so it is the one on screen
  const [q, setQ] = useState(() => { const t = params.get('track'); return (t && lib.trackById.get(t)?.title) || ''; });
  const page = usePageState('tracks', TRACK_SORTS, { sort: 'rating', view: 'list' });
  // a link such as /tracks?era=<id> or ?artist=<id> starts with that filter already on
  const [chips, setChips] = useState<Chip[]>(() => (['artist', 'era', 'album', 'genre'] as FilterKey[]).flatMap((k) => {
    const v = params.get(k);
    if (!v) return [];
    const label = k === 'artist' ? lib.artistById.get(v)?.name : k === 'era' ? lib.eraById.get(v)?.name : k === 'album' ? lib.albumById.get(v)?.title : v;
    return label ? [{ key: k, value: v, label }] : makeChip(lib, k, v) ? [makeChip(lib, k, v)!] : [];
  }));

  const tracks = useMemo(() => {
    const needle = splitTyped(q, 'tracks') ? '' : q.toLowerCase(); // while a `key:` is being typed it is not a search word
    const f = lib.tracks.filter((t) => (showHidden || !hiddenIds.has(t.id)) &&
      (!needle || `${t.title} ${t.artistName} ${t.albumTitle ?? ''}`.toLowerCase().includes(needle)) && matchesAll(chips, trackSubject(lib, t)));
    return sortTracks(f, page.sort, page.dir, page.sort === 'plays' ? playCounts(lib) : undefined);
  }, [lib, q, page.sort, page.dir, chips, showHidden, hiddenIds]);

  const CH = useChunks(tracks.length, PAGE, `${q}|${chips.length}|${page.sort}|${page.dir}`);
  const shown = CH.shown;
  const playable = tracks.filter(canPlay).map((t) => t.id);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-2xl font-bold">Tracks <span className="text-base font-normal text-muted">{tracks.length}</span></h1>
      </div>
      <ListToolbar actions={<><HiddenToggle count={hiddenIds.size} on={showHidden} onChange={setShowHidden} noun="tracks" /><PlayControls ids={playable} source={{ type: 'search', id: 'All tracks' }} label="these tracks" lineup={false} /></>} scope="tracks" chips={chips} onChips={setChips} text={q} onText={setQ}
        sorts={TRACK_SORTS} sort={page.sort} dir={page.dir} onSort={page.setSort} onFlip={page.flip} view={page.view} onView={page.setView} />
      {page.view === 'grid'
        ? <SingleGrid tracks={tracks.slice(0, shown)} />
        : <div className="card overflow-hidden"><TrackTable allowDelete tracks={tracks.slice(0, shown)} queue={tracks} source="search" sourceId="All tracks" numbered covers /></div>}
      {CH.left > 0 && <div ref={CH.sentinel} className="mt-4 text-center"><button className="btn" onClick={CH.more}>Show more ({CH.left} left)</button></div>}
    </div>
  );
}
