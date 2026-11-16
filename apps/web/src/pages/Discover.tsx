import { useMemo, useRef, useState } from 'react';
import { shuffleWithRules } from '@turbomusic/core';
import { Link } from 'react-router-dom';
import { CalendarClock, Compass, Disc3, ListEnd, ListPlus, Music4, Play, RefreshCw, Shuffle, Sparkles, Users } from 'lucide-react';
import { useLibraryLive, type Track } from '../lib/derive.ts';
import { buildListens } from '../lib/listens.ts';
import { heardTrackIds, tryNewPlaylist } from '../lib/heard.ts';
import { canPlay } from '../lib/spotifyPlayer.ts';
import { usePlayer } from '../lib/player.ts';
import { useStore } from '../lib/store.ts';
import { artistWeights, bucketMix, decadeBuckets, deepCuts, forgottenFavourites, genreBuckets, hiddenGems, mixOfTheDay, unfinishedAlbums, type Bucket, type MixTrack, type Plays } from '../lib/discoverMixes.ts';
import { Cover } from '../components/Cover.tsx';
import { TrackTable } from '../components/TrackTable.tsx';
import { SimilarArtists } from '../components/SimilarArtists.tsx';
import { cn, plural } from '../lib/cn.ts';

type Tab = 'foryou' | 'genres' | 'unfinished' | 'similar';
const TABS: { id: Tab; label: string; icon: typeof Sparkles }[] = [
  { id: 'foryou', label: 'For you', icon: Sparkles }, { id: 'genres', label: 'Genres and decades', icon: Music4 },
  { id: 'unfinished', label: 'Unfinished albums', icon: Disc3 }, { id: 'similar', label: 'Artists like yours', icon: Users },
];
const KEY = 'turbomusic.discoverTab';
const loadTab = (): Tab => { try { const t = localStorage.getItem(KEY); return TABS.some((x) => x.id === t) ? (t as Tab) : 'foryou'; } catch { return 'foryou'; } };

/** A made-up playlist: a mosaic of its first covers, what it is, and what to do with it. */
function MixCard({ title, blurb, tracks, wide, accent, onReroll }: { title: string; blurb: string; tracks: Track[]; wide?: boolean; accent?: boolean; onReroll?: () => void }) {
  const lib = useLibraryLive();
  const play = usePlayer((s) => s.play);
  const hasCurrent = usePlayer((s) => !!s.queue.currentId);
  const appendRest = usePlayer((s) => s.appendRest);
  const put = useStore((s) => s.put);
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const ids = tracks.map((t) => t.id);
  const covers = [...new Map(tracks.filter((t) => t.cover).map((t) => [t.cover, t])).values()].slice(0, 4);
  const save = () => { put('playlists', { name: title, description: blurb, cover: null, createdAt: Date.now(), trackIds: ids }); setSaved(true); };
  return (
    <section className={cn('card space-y-3 p-4', wide && 'sm:col-span-2', accent && 'ring-1 ring-accent/40')}>
      <div className="flex items-start gap-4">
        <div className="grid h-24 w-24 shrink-0 grid-cols-2 gap-0.5 overflow-hidden rounded-theme bg-raised">
          {covers.length ? covers.map((t) => <Cover key={t.id} hash={t.cover} seed={t.title} className="!rounded-none" />) : <div className="col-span-2 row-span-2 grid place-items-center text-muted"><Music4 /></div>}
        </div>
        <div className="min-w-0 flex-1 space-y-1"><h2 className="font-semibold">{title}</h2><p className="text-sm text-muted">{blurb}</p><p className="text-xs text-muted">{plural(tracks.length, 'track')}</p></div>
      </div>
      {tracks.length > 0 ? <div className="flex flex-wrap gap-2">
        <button className="btn btn-accent" onClick={() => play(ids[0], ids, { type: 'search', id: 'Discover mix' })}><Play size={15} fill="currentColor" />Play</button>
        <button className="btn" title="Play this mix in a random order (your playback rules still apply)" onClick={() => { const s = shuffleWithRules(ids, lib.rules); play(s[0], s, { type: 'search', id: 'Discover mix' }); }}><Shuffle size={15} />Shuffle</button>
        {onReroll && <button className="btn btn-ghost" title="Pick a different set" onClick={onReroll}><RefreshCw size={15} />New mix</button>}
        {hasCurrent && <button className="btn" title="Add to the end of what is coming next" onClick={() => appendRest(ids)}><ListEnd size={15} />Add to Then</button>}
        <button className="btn btn-ghost" disabled={saved} onClick={save}><ListPlus size={15} />{saved ? 'Saved as a playlist' : 'Save as playlist'}</button>
        <button className="btn btn-ghost" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Hide tracks' : 'Show tracks'}</button></div>
        : <p className="text-sm text-muted">Nothing to put here yet.</p>}
      {open && <div className="overflow-hidden rounded-theme border border-line"><TrackTable tracks={tracks} source="search" sourceId="Discover mix" covers /></div>}
    </section>
  );
}

function BucketGrid({ buckets, now, empty }: { buckets: Bucket<Track>[]; now: number; empty: string }) {
  const play = usePlayer((s) => s.play);
  if (!buckets.length) return <p className="text-sm text-muted">{empty}</p>;
  const top = Math.max(...buckets.map((b) => b.tracks.length));
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {buckets.map((b) => {
        const mix = bucketMix(b, now);
        return (
          <div key={b.key} className="card space-y-2 p-4">
            <div className="flex items-baseline justify-between gap-2"><h3 className="truncate font-semibold">{b.label}</h3><span className="text-xs tabular-nums text-muted">{b.avg ? `avg ${b.avg.toFixed(1)}` : 'unrated'}</span></div>
            <div className="h-1.5 overflow-hidden rounded-full bg-raised" title={`${b.tracks.length} tracks`}><div className="h-full rounded-full bg-accent" style={{ width: `${(b.tracks.length / top) * 100}%` }} /></div>
            <div className="text-xs text-muted">{plural(b.tracks.length, 'track')}</div>
            <button className="btn btn-accent w-full" disabled={!mix.length} onClick={() => play(mix[0].id, mix.map((t) => t.id), { type: 'search', id: 'Discover mix' })}><Play size={14} fill="currentColor" />Play a mix</button>
          </div>);
      })}
    </div>
  );
}

export function DiscoverPage() {
  const lib = useLibraryLive();
  const play = usePlayer((s) => s.play);
  const [tab, setTabState] = useState(loadTab);
  const setTab = (t: Tab) => { setTabState(t); try { localStorage.setItem(KEY, t); } catch { /* private mode */ } };
  const now = useMemo(() => Date.now(), []);
  const freshRef = useRef<{ seed: number; ids: string[] }>({ seed: -1, ids: [] });
  const [seed, setSeed] = useState(0); // "New mix" is the only thing that re-rolls the random one: it must not change under your hands every time the library refreshes
  const listens = useMemo(() => buildListens(lib), [lib]);
  const playable = useMemo(() => lib.tracks.filter((t) => canPlay(t)), [lib]);
  const plays = useMemo<Plays>(() => {
    const count = new Map<string, number>(), last = new Map<string, number>();
    for (const l of listens) { if (!l.trackId || l.skipped) continue; count.set(l.trackId, (count.get(l.trackId) ?? 0) + 1); last.set(l.trackId, Math.max(last.get(l.trackId) ?? 0, l.ts)); }
    // a track that was only skipped still counts as heard (it is not "never played")
    for (const l of listens) if (l.trackId && !count.has(l.trackId)) count.set(l.trackId, 0);
    return { count, last };
  }, [listens]);
  const mixables = useMemo(() => playable.map((t): MixTrack & { t: Track } => ({ t, id: t.id, title: t.title, rating: t.effectiveRating, albumId: t.albumId, artistId: t.leads[0]?.id ?? null, artistName: t.artistName, genres: t.allGenres, releaseDate: t.releaseDate, cover: t.cover, albumTitle: t.albumTitle })), [playable]);
  const back = (xs: MixTrack[]) => xs.map((x) => lib.trackById.get(x.id)).filter((t): t is Track => !!t);
  const mixes = useMemo(() => {
    const w = artistWeights(mixables);
    const heard = heardTrackIds(listens);
    return {
      day: back(mixOfTheDay(mixables, plays, now)),
      forgotten: back(forgottenFavourites(mixables, plays, now)),
      gems: back(hiddenGems(mixables, plays)),
      cuts: back(deepCuts(mixables, plays, w)),
      fresh: freshRef.current.seed === seed && freshRef.current.ids.length ? freshRef.current.ids.map((id) => lib.trackById.get(id)).filter((t): t is Track => !!t) : (() => { const f = tryNewPlaylist(playable, heard, canPlay); freshRef.current = { seed, ids: f.map((t) => t.id) }; return f; })(),
    };
  }, [mixables, plays, now, playable, seed]); // eslint-disable-line react-hooks/exhaustive-deps
  const genres = useMemo(() => genreBuckets(mixables).map((b) => ({ ...b, tracks: back(b.tracks) })), [mixables]); // eslint-disable-line react-hooks/exhaustive-deps
  const decades = useMemo(() => decadeBuckets(mixables).map((b) => ({ ...b, tracks: back(b.tracks) })), [mixables]); // eslint-disable-line react-hooks/exhaustive-deps
  const unfinished = useMemo(() => unfinishedAlbums(lib.albums, heardTrackIds(listens), (id) => canPlay(lib.trackById.get(id))).slice(0, 40), [lib, listens]);
  const rated = lib.tracks.filter((t) => t.effectiveRating > 0.001).length;

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div><h1 className="flex items-center gap-2 text-2xl font-bold"><Compass size={22} className="text-accent" />Discover</h1>
        <p className="text-sm text-muted">Playlists made from your own ratings and listening: what to play next, what you forgot, what you never heard. Nothing here needs the internet.</p></div>
      <div role="tablist" className="flex flex-wrap gap-1 border-b border-line pb-px">
        {TABS.map((t) => <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={cn('-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium', tab === t.id ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg')}><t.icon size={15} />{t.label}</button>)}
      </div>

      {tab === 'foryou' && (!playable.length ? <p className="text-sm text-muted">Nothing can be played yet: add some audio first.</p> : <>
        {rated < 10 && <p className="rounded-theme bg-raised p-3 text-sm text-muted">The mixes get better as you rate more songs: <Link to="/vote" className="text-accent hover:underline">rank a few</Link> and come back.</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          <MixCard wide accent title="Mix of the day" blurb={`${new Date(now).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}: songs you loved and forgot, hidden gems and deep cuts. The same all day, new tomorrow.`} tracks={mixes.day} />
          <MixCard title="Loved and forgotten" blurb="Rated highly, played before, and not heard for three weeks." tracks={mixes.forgotten} />
          <MixCard title="Hidden gems" blurb="Songs you rate highly but have hardly played." tracks={mixes.gems} />
          <MixCard title="Deep cuts" blurb="Songs you never played, by the artists you rate best." tracks={mixes.cuts} />
          <MixCard title="Something new" blurb="Songs you have never played, a few from each album." tracks={mixes.fresh} onReroll={() => setSeed((n) => n + 1)} />
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn" onClick={() => { const r = [...playable].sort(() => Math.random() - 0.5).slice(0, 40); if (r.length) play(r[0].id, r.map((t) => t.id), { type: 'shuffle', id: null }); }}><Shuffle size={15} />Surprise me: 40 random songs</button>
        </div>
      </>)}

      {tab === 'genres' && <div className="space-y-6">
        <section className="space-y-2"><h2 className="font-semibold">Genres</h2><BucketGrid buckets={genres} now={now} empty="Genres with at least 8 playable tracks show up here." /></section>
        <section className="space-y-2"><h2 className="flex items-center gap-2 font-semibold"><CalendarClock size={16} className="text-accent" />Decades</h2><BucketGrid buckets={decades} now={now} empty="Decades appear once enough tracks have a release date (Library health can find them)." /></section>
      </div>}

      {tab === 'unfinished' && (unfinished.length ? <ul className="space-y-2">{unfinished.map((u) => {
        const a = lib.albumById.get(u.albumId)!;
        return (
          <li key={u.albumId} className="card flex items-center gap-3 p-3">
            <Cover hash={a.cover} seed={a.title} className="h-14 w-14 shrink-0" />
            <div className="min-w-0 flex-1"><Link to={`/albums/${a.id}`} className="block truncate font-medium hover:underline">{a.title}</Link><div className="truncate text-xs text-muted">{a.artistName}</div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-raised"><div className="h-full rounded-full bg-accent" style={{ width: `${(u.heard / u.total) * 100}%` }} /></div>
              <div className="mt-0.5 text-xs text-muted">You have heard {u.heard} of {u.total}</div></div>
            <button className="btn btn-accent shrink-0" onClick={() => play(u.missing[0], u.missing, { type: 'album', id: a.id })}><Play size={14} fill="currentColor" />Play the other {u.missing.length}</button>
          </li>);
      })}</ul> : <p className="text-sm text-muted">No half-heard albums: every album you started, you finished (or never started).</p>)}

      {tab === 'similar' && <SimilarArtists />}
    </div>
  );
}
