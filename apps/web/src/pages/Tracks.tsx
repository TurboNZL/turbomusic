import { ListToolbar } from '../components/ListToolbar.tsx';
import { SingleGrid } from '../components/SingleCard.tsx';
import { usePageState } from '../lib/pageState.ts';
import { canPlay } from '../lib/spotifyPlayer.ts';
import { makeChip, matchesAll, splitTyped, trackSubject, type Chip, type FilterKey } from '../lib/filters.ts';
import { useSearchParams } from 'react-router-dom';
import { useMemo, useState } from 'react';
import { useLibrary } from '../lib/derive.ts';
import { FileAudio, Search as SearchIcon, Play, Plus, Shuffle } from 'lucide-react';
import { shuffleWithRules } from '@turbomusic/core';
import { useEditor } from '../lib/editor.ts';
import { usePlayer } from '../lib/player.ts';
import { playCounts } from '../lib/listens.ts';
import { TRACK_SORTS, sortTracks } from '../lib/trackSort.ts';
import { TrackTable } from '../components/TrackTable.tsx';

const PAGE = 100;

export function TracksPage() {
  const lib = useLibrary();
  const edit = useEditor((s) => s.open);
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
  const [shown, setShown] = useState(PAGE);

  const tracks = useMemo(() => {
    const needle = splitTyped(q, 'tracks') ? '' : q.toLowerCase(); // while a `key:` is being typed it is not a search word
    const f = lib.tracks.filter((t) =>
      (!needle || `${t.title} ${t.artistName} ${t.albumTitle ?? ''}`.toLowerCase().includes(needle)) && matchesAll(chips, trackSubject(lib, t)));
    return sortTracks(f, page.sort, page.dir, page.sort === 'plays' ? playCounts(lib) : undefined);
  }, [lib, q, page.sort, page.dir, chips]);

  const playable = tracks.filter(canPlay).map((t) => t.id);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-2xl font-bold">Tracks <span className="text-base font-normal text-muted">{tracks.length}</span></h1>
        <button className="btn btn-accent" disabled={!playable.length} onClick={() => play(playable[0], playable, { type: 'search', id: null })}><Play size={15} fill="currentColor" />Play</button>
        <button className="btn" disabled={!playable.length} onClick={() => { const s = shuffleWithRules(playable, lib.rules); play(s[0], s, { type: 'search', id: null }); }}><Shuffle size={15} />Shuffle</button>
        <button className="btn" onClick={() => edit({ kind: 'new-track', id: '' })}><Plus size={15} />New track</button>
        <button className="btn" onClick={() => edit({ kind: 'upload', id: '' })}><FileAudio size={15} />Add files</button>
      </div>
      <ListToolbar scope="tracks" chips={chips} onChips={(c) => { setChips(c); setShown(PAGE); }} text={q} onText={(t) => { setQ(t); setShown(PAGE); }}
        sorts={TRACK_SORTS} sort={page.sort} dir={page.dir} onSort={(k) => { page.setSort(k); setShown(PAGE); }} onFlip={page.flip} view={page.view} onView={page.setView} />
      {page.view === 'grid'
        ? <SingleGrid tracks={tracks.slice(0, shown)} />
        : <div className="card overflow-hidden"><TrackTable tracks={tracks.slice(0, shown)} queue={tracks} source="search" numbered covers /></div>}
      {shown < tracks.length && <div className="mt-4 text-center"><button className="btn" onClick={() => setShown(shown + PAGE)}>Show more ({tracks.length - shown} left)</button></div>}
    </div>
  );
}
