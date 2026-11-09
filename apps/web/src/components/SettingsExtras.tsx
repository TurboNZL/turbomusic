import { useState } from 'react';
import { ArrowRight, GitMerge, Pencil, Plus, X } from 'lucide-react';
import type { PlaybackRule } from '@turbomusic/core';
import { useLibrary } from '../lib/derive.ts';
import { useStore } from '../lib/store.ts';
import { saveDefaultImage, defaultImage, saveRules } from '../lib/profile.ts';
import { useEditor } from '../lib/editor.ts';
import { akaLine } from '../lib/autofill.ts';
import { ImagePicker, TrackPicker } from './forms.tsx';
import { CrossfadePick } from './CrossfadeCard.tsx';

/** Every "play B right after A" rule in one place (they can also be set from a track's editor). */
export function PlaybackRules() {
  const lib = useLibrary();
  const [a, setA] = useState<string | null>(null);
  const [b, setB] = useState<string | null>(null);
  const title = (id: string) => lib.trackById.get(id)?.title ?? '(deleted track)';
  const setRule = (i: number, change: Partial<PlaybackRule>) => saveRules(lib, lib.rules.map((r, j) => (j === i ? { ...r, ...change } : r)));
  const add = () => {
    if (!a || !b || a === b) return;
    saveRules(lib, [...lib.rules.filter((r) => r.trackAId !== a), { trackAId: a, trackBId: b, playFirstOnShuffle: true, applyToAlbumSource: false }]);
    setA(null); setB(null);
  };
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">When track A plays, track B is queued right after it, and the change can have its own crossfade. {lib.rules.length} rule{lib.rules.length === 1 ? '' : 's'}.</p>
      {lib.rules.map((r, i) => (
        <div key={`${r.trackAId}`} className="space-y-1 rounded-theme border border-line p-3 text-sm">
          <div className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate">{title(r.trackAId)}</span><ArrowRight size={14} className="shrink-0 text-muted" /><span className="min-w-0 flex-1 truncate">{title(r.trackBId)}</span>
            <button className="p-1 text-muted hover:text-bad" aria-label="Delete rule" onClick={() => saveRules(lib, lib.rules.filter((_, j) => j !== i))}><X size={15} /></button></div>
          <div className="flex flex-wrap gap-4 text-xs text-muted">
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={r.playFirstOnShuffle} onChange={(e) => setRule(i, { playFirstOnShuffle: e.target.checked })} />Keep together when shuffling</label>
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={r.applyToAlbumSource} onChange={(e) => setRule(i, { applyToAlbumSource: e.target.checked })} />Only when playing from an album</label>
            </div>
          <div className="space-y-0.5 text-xs text-muted"><div>Crossfade into it</div><CrossfadePick value={r.crossfadeSec} onChange={(v) => setRule(i, { crossfadeSec: v })} shift={r.crossfadeShiftSec} onShift={(v) => setRule(i, { crossfadeShiftSec: v })} shape={{ out: r.crossfadeOut, in: r.crossfadeIn }} onShape={(p) => setRule(i, p)} /></div>
        </div>))}
      <div className="grid gap-2 sm:grid-cols-[1fr_auto_1fr_auto] sm:items-start">
        <TrackPicker value={a} onChange={setA} /><ArrowRight size={16} className="mt-2.5 hidden text-muted sm:block" /><TrackPicker value={b} onChange={setB} exclude={a ?? undefined} />
        <button className="btn btn-accent" disabled={!a || !b} onClick={add}><Plus size={15} />Add rule</button></div>
    </div>
  );
}

/** Genres and credit roles: add new ones, remove the ones nothing uses. */
export function Vocabulary() {
  const lib = useLibrary();
  const { put, remove } = useStore();
  const edit = useEditor((s) => s.open);
  const [genre, setGenre] = useState('');
  const [role, setRole] = useState('');
  const genreUse = new Map<string, number>(), roleUse = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string) => m.set(k.toLowerCase(), (m.get(k.toLowerCase()) ?? 0) + 1);
  for (const t of lib.tracks) { t.allGenres.forEach((g) => bump(genreUse, g)); t.credits.forEach((c) => c.role.forEach((r) => bump(roleUse, r))); }
  for (const al of lib.albums) { al.genres.forEach((g) => bump(genreUse, g)); al.credits.forEach((c) => c.role.forEach((r) => bump(roleUse, r))); }
  const chips = (rows: { id: string; name: string }[], use: Map<string, number>, table: 'genres' | 'roleCategories') => (
    <div className="flex flex-wrap gap-1.5">{[...rows].sort((x, y) => x.name.localeCompare(y.name)).map((r) => { const n = use.get(r.name.toLowerCase()) ?? 0; return (
      <span key={r.id} className="chip gap-1 !text-fg" title={n ? `Used ${n} time${n === 1 ? '' : 's'}` : 'Not used'}>{r.name}<span className="text-muted">{n}</span>
        {n === 0 && <button aria-label={`Delete ${r.name}`} onClick={() => remove(table, r.id)}><X size={12} /></button>}</span>); })}</div>);
  const add = (table: 'genres' | 'roleCategories', name: string, existing: { name: string }[], reset: () => void) => {
    const n = name.trim();
    if (n && !existing.some((x) => x.name.toLowerCase() === n.toLowerCase())) put(table, table === 'genres' ? { name: n } : { name: n, isRemovable: true });
    reset();
  };
  return (
    <div className="space-y-4">
      <div className="space-y-2"><div className="flex items-center justify-between gap-2 text-sm font-medium"><span>Genres</span><button className="btn !py-1 text-xs" onClick={() => edit({ kind: 'merge-genres', id: '' })}><GitMerge size={13} />Merge tags…</button></div>{chips(lib.genres, genreUse, 'genres')}
        <div className="flex max-w-sm gap-2"><input className="input" placeholder="New genre" value={genre} onChange={(e) => setGenre(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add('genres', genre, lib.genres, () => setGenre(''))} />
          <button className="btn" onClick={() => add('genres', genre, lib.genres, () => setGenre(''))}><Plus size={15} />Add</button></div></div>
      <div className="space-y-2"><div className="text-sm font-medium">Credit roles</div>{chips(lib.roles, roleUse, 'roleCategories')}
        <div className="flex max-w-sm gap-2"><input className="input" placeholder="New role category" value={role} onChange={(e) => setRole(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add('roleCategories', role, lib.roles, () => setRole(''))} />
          <button className="btn" onClick={() => add('roleCategories', role, lib.roles, () => setRole(''))}><Plus size={15} />Add</button></div></div>
      <p className="text-xs text-muted">The number is how many tracks and albums use it. Only unused ones can be deleted.</p>
    </div>
  );
}

/** Release names (Deluxe, Remastered, ...): rename them everywhere at once, delete the unused, add new ones. */
export function ReleaseNamesManager() {
  const lib = useLibrary();
  const { put, patch, remove } = useStore();
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const use = new Map<string, number>();
  for (const r of lib.releases) { const k = r.title.trim().toLowerCase(); if (k) use.set(k, (use.get(k) ?? 0) + 1); }
  const names = [...lib.releaseNames].sort((a, b) => a.name.localeCompare(b.name));
  const add = () => { const n = draft.trim(); if (n && !names.some((x) => x.name.toLowerCase() === n.toLowerCase())) put('releaseNames', { name: n }); setDraft(''); };
  const rename = () => {
    if (!editing) return;
    const n = editing.name.trim(), old = names.find((x) => x.id === editing.id);
    setEditing(null);
    if (!old || !n || n === old.name || names.some((x) => x.id !== old.id && x.name.toLowerCase() === n.toLowerCase())) return;
    patch('releaseNames', old.id, { name: n });
    for (const r of lib.releases) if (r.title.trim().toLowerCase() === old.name.toLowerCase()) patch('releases', r.id, { title: n });
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {names.length === 0 && <span className="text-sm text-muted">No release names yet. They are made from the release editor or an import.</span>}
        {names.map((r) => { const n = use.get(r.name.toLowerCase()) ?? 0; return editing?.id === r.id ? (
          <span key={r.id} className="flex gap-1"><input autoFocus className="input !py-1 text-sm" value={editing.name} onChange={(e) => setEditing({ id: r.id, name: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') rename(); if (e.key === 'Escape') setEditing(null); }} onBlur={rename} /></span>
        ) : (
          <span key={r.id} className="chip gap-1 !text-fg" title={n ? `Used by ${n} release${n === 1 ? '' : 's'}` : 'Not used'}>{r.name}<span className="text-muted">{n}</span>
            <button aria-label={`Rename ${r.name}`} onClick={() => setEditing({ id: r.id, name: r.name })}><Pencil size={11} /></button>
            {n === 0 && <button aria-label={`Delete ${r.name}`} onClick={() => remove('releaseNames', r.id)}><X size={12} /></button>}</span>); })}
      </div>
      <div className="flex max-w-sm gap-2"><input className="input" placeholder="New release name" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} /><button className="btn" onClick={add}><Plus size={15} />Add</button></div>
      <p className="text-xs text-muted">The number is how many releases carry the name. Renaming changes it on all of them; only unused names can be deleted.</p>
    </div>
  );
}

/** Every artist with their other names; open one to add aliases or choose which one is displayed. */
export function AliasesManager() {
  const lib = useLibrary();
  const open = useEditor((s) => s.open);
  const [q, setQ] = useState('');
  const n = q.trim().toLowerCase();
  const list = [...lib.artists].sort((a, b) => (b.aliases?.length ?? 0) - (a.aliases?.length ?? 0) || a.name.localeCompare(b.name))
    .filter((a) => !n || [a.name, ...(a.aliases ?? [])].some((x) => x.toLowerCase().includes(n)));
  return (
    <div className="space-y-2">
      <input className="input max-w-sm" placeholder="Search artists and aliases…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="max-h-72 space-y-1 overflow-y-auto">
        {list.slice(0, 60).map((a) => (
          <button key={a.id} type="button" className="flex w-full items-center gap-2 rounded-theme bg-raised px-3 py-1.5 text-left text-sm hover:bg-hover" onClick={() => open({ kind: 'artist', id: a.id })}>
            <span className="min-w-0 flex-1 truncate">{a.name}{akaLine(a.aliases) && <span className="ml-2 text-xs text-muted">{akaLine(a.aliases, 3)}</span>}</span><Pencil size={13} className="shrink-0 text-muted" />
          </button>))}
        {list.length === 0 && <div className="text-sm text-muted">No artists match.</div>}
      </div>
      <p className="text-xs text-muted">Aliases are used to recognise an artist when you import by another name. The primary alias is the name shown everywhere.</p>
    </div>
  );
}

/** The picture shown for albums / artists that have none. */
export function DefaultImages() {
  const lib = useLibrary();
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2"><div className="text-sm font-medium">Default album cover</div>
        <ImagePicker hash={defaultImage(lib, 'defaultAlbumCover')} onChange={(h) => saveDefaultImage(lib, 'defaultAlbumCover', h)} seed="default album" /></div>
      <div className="space-y-2"><div className="text-sm font-medium">Default artist image</div>
        <ImagePicker kind="artist" hash={defaultImage(lib, 'defaultArtistImage')} onChange={(h) => saveDefaultImage(lib, 'defaultArtistImage', h)} seed="default artist" /></div>
    </div>
  );
}
