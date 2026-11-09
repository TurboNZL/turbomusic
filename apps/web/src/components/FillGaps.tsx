import { useRef, useState } from 'react';
import { Check, ImageDown, Loader2, Tags, GitMerge } from 'lucide-react';
import { useLibrary } from '../lib/derive.ts';
import { api, useStore } from '../lib/store.ts';
import { useFileUrl } from '../lib/files.ts';
import { cn } from '../lib/cn.ts';
import { matchGenre, planGenreMerge, type GenreMatch } from '../lib/genreOps.ts';
import { Modal } from './forms.tsx';

const BATCH = 6;
const fail = (e: unknown) => ((e as Error).message === 'Failed to fetch' ? 'Cannot reach the server.' : (e as Error).message);

function Thumb({ hash }: { hash: string }) {
  const url = useFileUrl(hash);
  return url ? <img src={url} alt="" className="h-12 w-12 shrink-0 rounded-full object-cover" /> : <div className="h-12 w-12 shrink-0 rounded-full bg-raised" />;
}

/**
 * Pictures for artists that have none, from an open source (Deezer's artist search, exact name matches only, the artist's other names
 * included). The server downloads each picture into the library; nothing is attached until it is ticked.
 */
export function FindArtistImagesDialog({ onClose }: { onClose: () => void }) {
  const lib = useLibrary();
  const patch = useStore((s) => s.patch);
  const configured = useStore((s) => !!s.settings.token);
  const todo = lib.artists.filter((a) => !a.image);
  const [rows, setRows] = useState<{ id: string; name: string; hash: string; matched: string; on: boolean }[]>([]);
  const [missed, setMissed] = useState<string[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<number | null>(null);
  const stop = useRef(false);
  const running = !!progress && progress.done < progress.total && !error && !stop.current;

  async function run() {
    stop.current = false; setError(null); setRows([]); setMissed([]); setSaved(null);
    setProgress({ done: 0, total: todo.length });
    const found: typeof rows = [], none: string[] = [];
    try {
      for (let i = 0; i < todo.length && !stop.current; i += BATCH) {
        const chunk = todo.slice(i, i + BATCH);
        const { results } = await api().artistImages(chunk.map((a) => ({ id: a.id, name: a.name, aliases: a.aliases })));
        for (const r of results) {
          const a = lib.artistById.get(r.id);
          if (r.hash) found.push({ id: r.id, name: a?.name ?? '', hash: r.hash, matched: r.matched ?? '', on: true }); else none.push(a?.name ?? r.id);
        }
        setRows([...found]); setMissed([...none]); setProgress({ done: Math.min(todo.length, i + BATCH), total: todo.length });
      }
    } catch (e) { setError(fail(e)); }
  }
  const on = rows.filter((r) => r.on).length;
  const apply = () => { for (const r of rows.filter((x) => x.on)) patch('artists', r.id, { image: r.hash }); setSaved(on); };
  return (
    <Modal title="Find artist pictures" onClose={onClose} wide
      footer={saved !== null ? <button className="btn btn-accent ml-auto" onClick={onClose}>Done</button> : <><button className="btn" onClick={onClose}>Close</button><button className="btn btn-accent ml-auto" disabled={!on || running} onClick={apply}>Use {on} pictures</button></>}>
      <p className="text-sm text-muted">{todo.length} artist{todo.length === 1 ? ' has' : 's have'} no picture. The server looks each one up on Deezer by exact name (and any other names you gave them) and keeps the picture it finds. Check them before saving: a famous namesake is possible.</p>
      {!configured && <div className="rounded-theme bg-warn/15 p-3 text-sm text-warn">This needs your server (Settings).</div>}
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn btn-accent" disabled={running || !todo.length || !configured} onClick={() => void run()}>{running ? <Loader2 size={15} className="animate-spin" /> : <ImageDown size={15} />}{rows.length || missed.length ? 'Search again' : 'Find pictures'}</button>
        {running && <button className="btn" onClick={() => { stop.current = true; setProgress((p) => (p ? { ...p } : p)); }}>Stop</button>}
        {progress && <span className="text-sm text-muted" role="status">{progress.done}/{progress.total} artists</span>}
      </div>
      {error && <div className="rounded-theme bg-bad/15 p-3 text-sm text-bad">{error}</div>}
      {rows.length > 0 && <div className="grid max-h-96 gap-2 overflow-y-auto sm:grid-cols-2">{rows.map((r, i) => (
        <label key={r.id} className={cn('flex cursor-pointer items-center gap-3 rounded-theme border p-2 text-sm', r.on ? 'border-accent' : 'border-line opacity-60')}>
          <input type="checkbox" checked={r.on} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)))} />
          <Thumb hash={r.hash} /><span className="min-w-0"><span className="block truncate font-medium">{r.name}</span><span className="block truncate text-xs text-muted">Deezer: {r.matched}</span></span></label>))}</div>}
      {saved !== null && <div className="flex items-center gap-2 text-sm text-good"><Check size={15} />{saved} picture{saved === 1 ? '' : 's'} saved.</div>}
      {missed.length > 0 && <details className="text-xs text-muted"><summary className="cursor-pointer">{missed.length} not found (add those by hand)</summary><p className="mt-1">{missed.join(', ')}</p></details>}
    </Modal>
  );
}

type Choice = { kind: 'use'; name: string } | { kind: 'create'; name: string } | { kind: 'skip' };
interface Proposal { source: string; name: string; match: GenreMatch; choice: Choice }
interface AlbumRow { id: string; label: string; props: Proposal[] }


/**
 * Genres for albums that have none, from iTunes and MusicBrainz (exact album + artist matches only). A suggestion that is already one of your
 * genres is ticked; one that merely resembles yours ("Hip-Hop/Rap" when you have "Hip-Hop" and "Rap") and one that would be a brand new tag
 * both wait for your choice, so no tag is created behind your back.
 */
export function FindGenresDialog({ onClose }: { onClose: () => void }) {
  const lib = useLibrary();
  const patch = useStore((s) => s.patch);
  const put = useStore((s) => s.put);
  const configured = useStore((s) => !!s.settings.token);
  const todo = lib.albums.filter((a) => !a.genres.length);
  const [rows, setRows] = useState<AlbumRow[]>([]);
  const [missed, setMissed] = useState<string[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ albums: number; created: string[] } | null>(null);
  const stop = useRef(false);
  const running = !!progress && progress.done < progress.total && !error && !stop.current;
  const have = lib.genres.map((g) => g.name);

  async function run() {
    stop.current = false; setError(null); setRows([]); setMissed([]); setSaved(null);
    setProgress({ done: 0, total: todo.length });
    const found: AlbumRow[] = [], none: string[] = [];
    try {
      for (let i = 0; i < todo.length && !stop.current; i += BATCH) {
        const chunk = todo.slice(i, i + BATCH);
        const { results } = await api().albumGenres(chunk.map((a) => ({ id: a.id, album: a.title, artist: a.leads[0]?.name ?? a.artistName })));
        for (const r of results) {
          const a = lib.albumById.get(r.id);
          const label = `${a?.title ?? ''} · ${a?.artistName ?? ''}`;
          const props: Proposal[] = [];
          for (const g of r.genres) {
            if (props.some((p) => p.name.toLowerCase() === g.name.toLowerCase())) continue;
            const match = matchGenre(g.name, have);
            props.push({ source: g.source === 'itunes' ? 'iTunes' : 'MusicBrainz', name: g.name, match, choice: match.kind === 'existing' ? { kind: 'use', name: match.name } : { kind: 'skip' } });
          }
          if (props.length) found.push({ id: r.id, label, props }); else none.push(label);
        }
        setRows([...found]); setMissed([...none]); setProgress({ done: Math.min(todo.length, i + BATCH), total: todo.length });
      }
    } catch (e) { setError(fail(e)); }
  }
  const setChoice = (ri: number, pi: number, choice: Choice) => setRows((rs) => rs.map((r, i) => (i === ri ? { ...r, props: r.props.map((p, j) => (j === pi ? { ...p, choice } : p)) } : r)));
  const picked = (r: AlbumRow) => r.props.flatMap((p) => (p.choice.kind === 'skip' ? [] : [p.choice.name]));
  const newTags = [...new Set(rows.flatMap((r) => r.props.flatMap((p) => (p.choice.kind === 'create' ? [p.choice.name] : []))))];
  const albumsChanged = rows.filter((r) => picked(r).length).length;
  function apply() {
    const created: string[] = [];
    for (const name of newTags) if (!lib.genres.some((g) => g.name.toLowerCase() === name.toLowerCase())) { put('genres', { name }); created.push(name); }
    for (const r of rows) {
      const names = [...new Set(picked(r))];
      if (names.length) patch('albums', r.id, { genres: names });
    }
    setSaved({ albums: albumsChanged, created });
  }
  return (
    <Modal title="Find album genres" onClose={onClose} wide
      footer={saved ? <button className="btn btn-accent ml-auto" onClick={onClose}>Done</button> : <><button className="btn" onClick={onClose}>Close</button><button className="btn btn-accent ml-auto" disabled={!albumsChanged || running} onClick={apply}>Save {albumsChanged} album{albumsChanged === 1 ? '' : 's'}{newTags.length ? ` and ${newTags.length} new tag${newTags.length === 1 ? '' : 's'}` : ''}</button></>}>
      <p className="text-sm text-muted">{todo.length} album{todo.length === 1 ? ' has' : 's have'} no genre. The server asks iTunes and MusicBrainz about each one (exact matches only). Suggestions that are already your genres are ticked. Anything that would be a <b>new tag</b>, or only resembles one of yours, is left for you to decide.</p>
      {!configured && <div className="rounded-theme bg-warn/15 p-3 text-sm text-warn">This needs your server (Settings).</div>}
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn btn-accent" disabled={running || !todo.length || !configured} onClick={() => void run()}>{running ? <Loader2 size={15} className="animate-spin" /> : <Tags size={15} />}{rows.length || missed.length ? 'Search again' : 'Find genres'}</button>
        {running && <button className="btn" onClick={() => { stop.current = true; setProgress((p) => (p ? { ...p } : p)); }}>Stop</button>}
        {progress && <span className="text-sm text-muted" role="status">{progress.done}/{progress.total} albums</span>}
      </div>
      {error && <div className="rounded-theme bg-bad/15 p-3 text-sm text-bad">{error}</div>}
      {rows.length > 0 && <div className="max-h-[26rem] space-y-2 overflow-y-auto">{rows.map((r, ri) => (
        <div key={r.id} className="rounded-theme border border-line p-2.5 text-sm">
          <div className="mb-1.5 truncate font-medium">{r.label}</div>
          <div className="space-y-1.5">{r.props.map((p, pi) => (
            <div key={p.name} className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="w-24 shrink-0 text-muted">{p.source}: <b className="text-fg">{p.name}</b></span>
              {p.match.kind === 'existing' && <ChoiceBtn on={p.choice.kind === 'use'} onClick={() => setChoice(ri, pi, p.choice.kind === 'use' ? { kind: 'skip' } : { kind: 'use', name: (p.match as { name: string }).name })}>Use “{p.match.name}”</ChoiceBtn>}
              {p.match.kind === 'similar' && p.match.candidates.map((c) => <ChoiceBtn key={c} on={p.choice.kind === 'use' && p.choice.name === c} onClick={() => setChoice(ri, pi, { kind: 'use', name: c })}>Use “{c}”</ChoiceBtn>)}
              {p.match.kind !== 'existing' && <ChoiceBtn on={p.choice.kind === 'create'} onClick={() => setChoice(ri, pi, { kind: 'create', name: p.name })} accent>＋ New tag “{p.name}”</ChoiceBtn>}
              <ChoiceBtn on={p.choice.kind === 'skip'} onClick={() => setChoice(ri, pi, { kind: 'skip' })}>Skip</ChoiceBtn>
            </div>))}</div>
        </div>))}</div>}
      {saved && <div className="flex items-center gap-2 text-sm text-good"><Check size={15} />{saved.albums} album{saved.albums === 1 ? '' : 's'} saved{saved.created.length ? `, new tags: ${saved.created.join(', ')}` : ''}.</div>}
      {missed.length > 0 && <details className="text-xs text-muted"><summary className="cursor-pointer">{missed.length} with no answer (set those by hand)</summary><p className="mt-1">{missed.join(' · ')}</p></details>}
    </Modal>
  );
}
const ChoiceBtn = ({ on, onClick, children, accent }: { on: boolean; onClick: () => void; children: React.ReactNode; accent?: boolean }) => (
  <button type="button" aria-pressed={on} onClick={onClick} className={cn('rounded-full border px-2.5 py-0.5 transition-colors', on ? (accent ? 'border-warn bg-warn/20 text-fg' : 'border-accent bg-accent/20 text-fg') : 'border-line text-muted hover:text-fg')}>{children}</button>
);

/** Merge tags: choose the ones to fold away and the one they become (an existing tag or a new name); every album and track that has any of them gets the one tag. */
export function MergeGenresDialog({ onClose }: { onClose: () => void }) {
  const lib = useLibrary();
  const { patch, put, remove } = useStore();
  const [from, setFrom] = useState<string[]>([]);
  const [into, setInto] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const use = new Map<string, number>();
  for (const t of lib.tracks) t.allGenres.forEach((g) => use.set(g.toLowerCase(), (use.get(g.toLowerCase()) ?? 0) + 1));
  for (const a of lib.albums) a.genres.forEach((g) => use.set(g.toLowerCase(), (use.get(g.toLowerCase()) ?? 0) + 1));
  const names = [...lib.genres].sort((a, b) => a.name.localeCompare(b.name));
  const raw = () => {
    const rows = useStore.getState().rows;
    const take = (m: Map<string, { data: unknown }>) => [...m.entries()].map(([id, r]) => ({ id, genres: ((r.data as { genres?: string[] }).genres ?? []) as string[] }));
    return { albums: take(rows.albums as never), tracks: take(rows.tracks as never) };
  };
  const target = into.trim();
  const sources = from.filter((f) => f.toLowerCase() !== target.toLowerCase());
  const plan = sources.length && target ? (() => { const r = raw(); return { albums: planGenreMerge(r.albums, sources, target), tracks: planGenreMerge(r.tracks, sources, target) }; })() : null;
  function apply() {
    if (!plan) return;
    if (!lib.genres.some((g) => g.name.toLowerCase() === target.toLowerCase())) put('genres', { name: target });
    for (const p of plan.albums) patch('albums', p.id, { genres: p.genres });
    for (const p of plan.tracks) patch('tracks', p.id, { genres: p.genres });
    for (const g of lib.genres) if (sources.some((s) => s.toLowerCase() === g.name.toLowerCase())) remove('genres', g.id);
    setDone(`${sources.length} tag${sources.length === 1 ? '' : 's'} merged into “${target}”: ${plan.albums.length} album${plan.albums.length === 1 ? '' : 's'} and ${plan.tracks.length} track${plan.tracks.length === 1 ? '' : 's'} updated.`);
    setFrom([]);
  }
  return (
    <Modal title="Merge tags" onClose={onClose} wide footer={done ? <button className="btn btn-accent ml-auto" onClick={onClose}>Done</button> : <><button className="btn" onClick={onClose}>Close</button><button className="btn btn-accent ml-auto" disabled={!plan} onClick={apply}><GitMerge size={15} />Merge</button></>}>
      <p className="text-sm text-muted">For overlapping tags (Hip-Hop and Rap, or “Hip Hop” and “Hip-Hop”). Tick the tags to fold away, then say which tag they become.</p>
      <div className="flex flex-wrap gap-1.5">{names.map((g) => { const on = from.some((f) => f.toLowerCase() === g.name.toLowerCase()); return (
        <button key={g.id} type="button" aria-pressed={on} onClick={() => setFrom(on ? from.filter((f) => f.toLowerCase() !== g.name.toLowerCase()) : [...from, g.name])}
          className={cn('rounded-full border px-2.5 py-0.5 text-xs transition-colors', on ? 'border-accent bg-accent/20' : 'border-line text-muted hover:text-fg')}>{g.name} <span className="text-muted">{use.get(g.name.toLowerCase()) ?? 0}</span></button>); })}</div>
      <label className="block space-y-1 text-sm">They become
        <input className="input" placeholder="Pick one of the tags above, or type a new name" value={into} onChange={(e) => setInto(e.target.value)} /></label>
      {from.length > 0 && <div className="flex flex-wrap gap-1.5 text-xs text-muted">Use one of the ticked tags: {from.map((f) => <button key={f} type="button" className="underline hover:text-fg" onClick={() => setInto(f)}>{f}</button>)}</div>}
      {plan && <p className="text-sm">{plan.albums.length} album{plan.albums.length === 1 ? '' : 's'} and {plan.tracks.length} track{plan.tracks.length === 1 ? '' : 's'} will change; {sources.length} tag{sources.length === 1 ? '' : 's'} will be removed.</p>}
      {done && <div className="flex items-center gap-2 text-sm text-good"><Check size={15} />{done}</div>}
    </Modal>
  );
}
