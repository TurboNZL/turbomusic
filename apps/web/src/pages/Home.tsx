import { useState } from 'react';
import { canPlay } from '../lib/spotifyPlayer.ts';
import { Link } from 'react-router-dom';
import { HeartPulse, Play, Shuffle, Sparkles, Swords, Trash2 } from 'lucide-react';
import { useMemo } from 'react';
import { usePlayer } from '../lib/player.ts';
import { buildListens } from '../lib/listens.ts';
import { heardTrackIds, tryNewPlaylist } from '../lib/heard.ts';
import { computeListenStats, dayKey } from '../lib/listenStats.ts';
import { Bars, fmtHours } from '../components/charts.tsx';
import { healthScore } from '../components/HealthHero.tsx';
import { Cover } from '../components/Cover.tsx';
import type { Library } from '../lib/derive.ts';
import { logJournal } from '../lib/journal.ts';
import { useLibraryLive } from '../lib/derive.ts';
import { useStore } from '../lib/store.ts';
import { cn } from '../lib/cn.ts';
import { EloQuestions } from '../components/EloQuestions.tsx';
import { useMenu } from '../components/Menu.tsx';
import { useAlbumMenuItems } from '../components/entityMenus.tsx';
import { useTrackMenuItems } from '../components/TrackMenu.tsx';
import { RecapPrompt } from '../components/RecapPrompt.tsx';

const ago = (ts: number) => { const m = Math.max(1, Math.round((Date.now() - ts) / 60000)); return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };

function AlbumTile({ album, onMenu }: { album: Library['albums'][number]; onMenu: (a: Library['albums'][number]) => (e: React.MouseEvent) => void }) {
  return <Link to={`/albums/${album.id}`} onContextMenu={onMenu(album)} className="group w-36 shrink-0 space-y-1.5"><Cover hash={album.cover} seed={album.title} className="w-36 transition-transform group-hover:-translate-y-0.5" /><div className="truncate text-sm font-medium">{album.title}</div><div className="truncate text-xs text-muted">{album.artistName}</div></Link>;
}

function Tile({ label, value, to }: { label: string; value: string; to?: string }) {
  const body = <><div className="text-xs uppercase tracking-wider text-muted">{label}</div><div className="mt-1 text-2xl font-bold tabular-nums">{value}</div></>;
  return to ? <Link to={to} className="card block p-4 hover:bg-raised/50">{body}</Link> : <div className="card p-4">{body}</div>;
}

function Shelf({ title, to, children }: { title: string; to?: string; children: React.ReactNode }) {
  return <section className="space-y-2"><div className="flex items-baseline justify-between"><h2 className="text-lg font-semibold">{title}</h2>{to && <Link to={to} className="text-xs text-muted hover:text-fg">See all</Link>}</div>{children}</section>;
}

export function HomePage() {
  const lib = useLibraryLive();
  const remove = useStore((s) => s.remove);
  const play = usePlayer((s) => s.play);
  const menu = useMenu();
  const albumItems = useAlbumMenuItems();
  const trackItems = useTrackMenuItems();
  const albumMenu = (a: Library['albums'][number]) => menu.onContextMenu(albumItems(a), `Actions for ${a.title}`, a.id);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [shown, setShown] = useState(15);
  const [jq, setJq] = useState('');
  const [jtype, setJtype] = useState('all');
  const listens = useMemo(() => buildListens(lib), [lib]);

  const rated = lib.tracks.filter((t) => t.effectiveRating > 0.001);
  const avg = rated.length ? rated.reduce((s, t) => s + t.effectiveRating, 0) / rated.length : 0;
  // "complete" = enough votes to trust the rating, or a manual rating
  const done = lib.tracks.filter((t) => t.comparisons >= 3 || (t.initialRating ?? 0) > 0).length;
  const pct = lib.tracks.length ? Math.round((done / lib.tracks.length) * 100) : 0;
  const allEntries = [...lib.timeline].sort((a, b) => b.timestamp - a.timestamp);
  const jTypes = [...new Set(allEntries.map((e) => e.type))];
  const needle = jq.trim().toLowerCase();
  const entries = allEntries.filter((e) => (jtype === 'all' || e.type === jtype) && (!needle || `${e.title} ${e.description ?? ''}`.toLowerCase().includes(needle)));

  // pick up where you left off: the last thing played here that can be played again, with the rest of its album after it
  const last = useMemo(() => {
    for (let i = listens.length - 1; i >= 0; i--) { const t = listens[i].trackId ? lib.trackById.get(listens[i].trackId!) : undefined; if (t?.file && listens[i].source === 'turbomusic') return { t, at: listens[i].ts }; }
    return null;
  }, [listens, lib]);
  const resume = () => {
    if (!last) return;
    const album = last.t.albumId ? lib.albumById.get(last.t.albumId) : undefined;
    const ids = album ? album.trackIds.filter((id) => canPlay(lib.trackById.get(id))) : [last.t.id];
    play(last.t.id, ids.length ? ids : [last.t.id], album ? { type: 'album', id: album.id } : { type: 'track', id: last.t.id });
  };
  // albums heard lately, newest first
  const recentAlbums = useMemo(() => {
    const seen = new Set<string>(), out: typeof lib.albums = [];
    for (let i = listens.length - 1; i >= 0 && out.length < 12; i--) { const t = listens[i].trackId ? lib.trackById.get(listens[i].trackId!) : undefined; const a = t?.albumId ? lib.albumById.get(t.albumId) : undefined; if (a && !seen.has(a.id)) { seen.add(a.id); out.push(a); } }
    return out;
  }, [listens, lib]);
  // loved tracks that have not been heard for a while
  const comeback = useMemo(() => {
    const lastHeard = new Map<string, number>();
    for (const l of listens) if (l.trackId) lastHeard.set(l.trackId, l.ts);
    const cutoff = Date.now() - 30 * 86_400_000;
    return lib.tracks.filter((t) => t.file && t.effectiveRating >= 8 && (lastHeard.get(t.id) ?? 0) < cutoff).sort((a, b) => b.effectiveRating - a.effectiveRating).slice(0, 6);
  }, [listens, lib]);
  // never-played tracks, a few per album: a premade playlist to get to know the rest of the library (they are kept out of the ranking until heard)
  const [shuffleSeed, setShuffleSeed] = useState(0);
  const unheardCount = useMemo(() => { const h = heardTrackIds(listens); return lib.tracks.filter((t) => !h.has(t.id) && canPlay(t)).length; }, [listens, lib]);
  const tryNew = useMemo(() => tryNewPlaylist(lib.tracks, heardTrackIds(listens), canPlay), [listens, lib, shuffleSeed]); // eslint-disable-line react-hooks/exhaustive-deps
  const newest = useMemo(() => [...lib.albums].sort((a, b) => b.id.localeCompare(a.id)).slice(0, 12), [lib]);
  const month = useMemo(() => computeListenStats(listens, { from: Date.now() - 30 * 86_400_000 }), [listens]);
  const days = useMemo(() => Array.from({ length: 30 }, (_, i) => { const d = new Date(Date.now() - (29 - i) * 86_400_000); return { label: i % 5 === 0 || i === 29 ? d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '', full: d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }), value: month.byDay.get(dayKey(d.getTime())) ?? 0 }; }), [month]);
  const score = healthScore(lib);

  return (
    <div className="space-y-8">
      {menu.element}
      <RecapPrompt lib={lib} />
      <section className="card relative overflow-hidden p-5 sm:p-6">
        <div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-accent/20 blur-3xl" aria-hidden />
        <div className="relative flex flex-wrap items-center gap-5" onContextMenu={last ? menu.onContextMenu(trackItems(last.t, resume), `Actions for ${last.t.title}`, 'resume') : undefined}>
          {last ? <>
            <Cover hash={last.t.cover} seed={last.t.albumTitle ?? last.t.title} className="h-24 w-24 shrink-0 sm:h-28 sm:w-28" />
            <div className="min-w-0 flex-1 space-y-1">
              <div className="text-xs uppercase tracking-wider text-muted">Pick up where you left off</div>
              <div className="truncate text-2xl font-bold">{last.t.title}</div>
              <div className="truncate text-sm text-muted">{last.t.artistName}{last.t.albumTitle ? ` · ${last.t.albumTitle}` : ''} · {ago(last.at)}</div>
              <div className="flex flex-wrap gap-2 pt-2"><button className="btn btn-accent" onClick={resume}><Play size={16} fill="currentColor" />Resume</button>
                <Link to="/vote" className="btn"><Swords size={16} />Keep ranking · {lib.tracks.length - done} to go</Link></div>
            </div></>
          : <div className="min-w-0 flex-1 space-y-2"><h1 className="text-2xl font-bold">Welcome back</h1><p className="text-sm text-muted">Play something and it will be waiting for you here.</p>
              <div className="flex flex-wrap gap-2"><Link to="/vote" className="btn btn-accent"><Swords size={16} />Keep ranking · {lib.tracks.length - done} to go</Link><Link to="/albums" className="btn">Browse albums</Link></div></div>}
        </div>
      </section>
      {lib.tracks.filter((t) => t.file).length >= 3 && <EloQuestions />}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Library" value={`${lib.tracks.length} tracks`} to="/tracks" />
        <Tile label="Avg. rating" value={avg.toFixed(2)} to="/stats?tab=library" />
        <Tile label="Ranked" value={`${pct}%`} to="/vote" />
        <Link to="/health" className="card flex items-center gap-3 p-4 hover:bg-raised/50"><div><div className="text-xs uppercase tracking-wider text-muted">Library health</div><div className={cn('mt-1 text-2xl font-bold tabular-nums', score >= 0.9 ? 'text-good' : score >= 0.6 ? 'text-warn' : 'text-bad')}>{Math.round(score * 100)}</div></div><HeartPulse size={22} className="ml-auto text-muted" /></Link>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="card space-y-2 p-5 lg:col-span-2">
          <div className="flex items-baseline justify-between"><h2 className="font-semibold">The last 30 days</h2><Link to="/stats" className="text-xs text-muted hover:text-fg">All stats</Link></div>
          {month.plays ? <><Bars data={days} format={fmtHours} height={110} /><p className="text-sm text-muted"><b className="text-fg">{fmtHours(month.ms)}</b> across {month.plays.toLocaleString()} plays{month.currentStreak ? ` · ${month.currentStreak}-day streak` : ''}{month.topArtists[0] ? ` · most played ${month.topArtists[0].label}` : ''}</p></>
            : <p className="py-6 text-sm text-muted">No listening in the last 30 days. <Link to="/stats" className="underline">Import your Spotify history</Link> to fill this in.</p>}
        </section>
        <section className="card space-y-2 p-5"><h2 className="font-semibold">Back in rotation</h2>
          {comeback.length ? <ul className="space-y-1">{comeback.map((t) => <li key={t.id}><button className="flex w-full items-center gap-2 rounded-theme px-1 py-1 text-left text-sm hover:bg-raised" onContextMenu={menu.onContextMenu(trackItems(t, () => play(t.id, comeback.map((x) => x.id), { type: 'search', id: null })), `Actions for ${t.title}`, t.id)} onClick={() => play(t.id, comeback.map((x) => x.id), { type: 'search', id: null })}><Play size={12} className="shrink-0 text-muted" /><span className="min-w-0 flex-1 truncate">{t.title}<span className="text-muted"> · {t.artistName}</span></span><span className="text-xs tabular-nums text-muted">{t.effectiveRating.toFixed(1)}</span></button></li>)}</ul>
            : <p className="text-sm text-muted">Tracks you rated 8 or higher and have not played for a month will show up here.</p>}
        </section>
      </div>
      {tryNew.length > 0 && <section className="card space-y-3 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="mr-auto"><h2 className="flex items-center gap-2 font-semibold"><Sparkles size={16} className="text-accent" />Try something new</h2>
            <p className="text-xs text-muted">{tryNew.length} tracks you have never played{unheardCount > tryNew.length ? `, picked from ${unheardCount}` : ''}. Ranking only uses tracks you have heard.</p></div>
          <button className="btn" title="A different mix" onClick={() => setShuffleSeed((n) => n + 1)}><Shuffle size={16} />New mix</button>
          <button className="btn btn-accent" onClick={() => play(tryNew[0].id, tryNew.map((t) => t.id), { type: 'search', id: null })}><Play size={16} fill="currentColor" />Play</button>
        </div>
        <div className="flex gap-3 overflow-x-auto pb-1">{tryNew.slice(0, 12).map((t) => <button key={t.id} className="group w-28 shrink-0 space-y-1 text-left" title={`${t.title} · ${t.artistName}`} onContextMenu={menu.onContextMenu(trackItems(t, () => play(t.id, tryNew.map((x) => x.id), { type: 'search', id: null })), `Actions for ${t.title}`, t.id)} onClick={() => play(t.id, tryNew.map((x) => x.id), { type: 'search', id: null })}>
          <Cover hash={t.cover} seed={t.albumTitle ?? t.title} className="w-28 transition-transform group-hover:-translate-y-0.5" /><div className="truncate text-sm font-medium">{t.title}</div><div className="truncate text-xs text-muted">{t.artistName}</div></button>)}</div>
      </section>}
      {recentAlbums.length > 0 && <Shelf title="Recently played" to="/albums"><div className="flex gap-3 overflow-x-auto pb-2">{recentAlbums.map((a) => <AlbumTile key={a.id} album={a} onMenu={albumMenu} />)}</div></Shelf>}
      {newest.length > 0 && <Shelf title="Latest additions" to="/albums"><div className="flex gap-3 overflow-x-auto pb-2">{newest.map((a) => <AlbumTile key={a.id} album={a} onMenu={albumMenu} />)}</div></Shelf>}
      <h2 className="text-lg font-semibold">Curation journal</h2>
      <section className="space-y-3">
        <form className="card space-y-2 p-4" onSubmit={(e) => { e.preventDefault(); if (!title.trim()) return; logJournal('entry', title.trim(), text.trim()); setTitle(''); setText(''); }}>
          <input className="input" placeholder="Write a journal entry title…" value={title} onChange={(e) => setTitle(e.target.value)} />
          {title && <><textarea className="input" rows={2} placeholder="Details (optional)" value={text} onChange={(e) => setText(e.target.value)} /><button className="btn btn-accent">Add entry</button></>}
        </form>
        {allEntries.length > 0 && <div className="flex flex-wrap items-center gap-2">
          <input className="input !w-64 max-w-full" placeholder="Filter the journal…" aria-label="Filter the journal" value={jq} onChange={(e) => { setJq(e.target.value); setShown(15); }} />
          <select className="input !w-auto" aria-label="Entry type" value={jtype} onChange={(e) => { setJtype(e.target.value); setShown(15); }}><option value="all">All kinds</option>{jTypes.map((t) => <option key={t} value={t}>{t}</option>)}</select>
          {(jq || jtype !== 'all') && <span className="text-xs text-muted">{entries.length} of {allEntries.length}</span>}</div>}
        {!entries.length && <p className="text-sm text-muted">{allEntries.length ? 'No entries match.' : 'Nothing here yet. Adding albums and writing entries will fill the timeline.'}</p>}
        <div className="space-y-2">{entries.slice(0, shown).map((e) => (
          <div key={e.id} className="card group flex gap-3 p-4">
            <div className={cn('w-1 shrink-0 rounded-full', e.type === 'entry' ? 'bg-accent' : 'bg-muted')} />
            <div className="min-w-0 flex-1"><div className="flex items-center gap-3 text-xs text-muted"><span>{new Date(e.timestamp).toLocaleString()}</span><span className="uppercase tracking-wider">{e.type}</span>
              <button className="ml-auto opacity-0 hover:text-bad group-hover:opacity-100" aria-label="Delete entry" onClick={() => confirm('Delete this entry?') && remove('timeline', e.id)}><Trash2 size={13} /></button></div>
              <div className="mt-0.5 text-sm font-semibold">{e.title}</div>{e.description && <p className="mt-0.5 whitespace-pre-wrap text-sm text-muted">{e.description}</p>}</div>
          </div>))}</div>
        {shown < entries.length && <button className="btn" onClick={() => setShown(shown + 15)}>Show more</button>}
      </section>
    </div>
  );
}
