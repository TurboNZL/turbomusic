import { useEditor } from '../lib/editor.ts';
import { Select, albumOptions } from './Select.tsx';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { leaveRemoved } from '../lib/leave.ts';
import { Check, FileAudio, Plus } from 'lucide-react';
import type { ArtistData, Credit, PlaylistData } from '@turbomusic/core';
import { useLibrary } from '../lib/derive.ts';
import { useStore } from '../lib/store.ts';
import { saveAudio } from '../lib/files.ts';
import { logJournal } from '../lib/journal.ts';
import { AUDIO_ACCEPT, appendTrack, cleanCredits, hasLead, LEAD_ROLE, newTrackData, inheritFromAlbum, titleFromFilename, withLeadFallback } from '../lib/defaults.ts';
import { CreditsEditor, Field, ImagePicker, Modal } from './forms.tsx';

export function NewArtistDialog({ onClose }: { onClose: () => void }) {
  const lib = useLibrary();
  const put = useStore((s) => s.put);
  const nav = useNavigate();
  const [name, setName] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const n = name.trim();
  const existing = n ? lib.artists.find((a) => [a.name, ...(a.aliases ?? [])].some((x) => x.toLowerCase() === n.toLowerCase())) : undefined;
  const create = () => {
    if (!n) return;
    const id = existing?.id ?? put('artists', { name: n, image } satisfies ArtistData);
    onClose(); nav(`/artists/${id}`);
  };
  return (
    <Modal title="New artist" onClose={onClose} footer={<div className="ml-auto flex gap-2"><button className="btn btn-ghost" onClick={onClose}>Cancel</button>
      <button className="btn btn-accent" disabled={!n} onClick={create}>{existing ? 'Open existing' : 'Create'}</button></div>}>
      <ImagePicker kind="artist" hash={image} onChange={setImage} seed={n || 'new'} />
      <Field label="Name" hint={existing ? 'An artist with this name already exists.' : undefined}><input autoFocus className="input" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} /></Field>
    </Modal>
  );
}

/** Create or edit a playlist: name, description, cover. */
export function PlaylistDialog({ playlistId, onClose }: { playlistId?: string; onClose: () => void }) {
  const nav = useNavigate();
  const lib = useLibrary();
  const { put, patch, remove } = useStore();
  const existing = playlistId ? lib.playlists.find((p) => p.id === playlistId) : undefined;
  const [name, setName] = useState(existing?.name ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [cover, setCover] = useState<string | null>(existing?.cover ?? null);
  const [kind, setKind] = useState<'tracks' | 'albums'>(existing?.kind ?? 'tracks');
  if (playlistId && !existing) return null;
  const save = () => {
    const d = { name: name.trim(), description: description.trim() || null, cover };
    if (existing) patch('playlists', existing.id, d);
    else put('playlists', { ...d, createdAt: Date.now(), trackIds: [], ...(kind === 'albums' ? { kind, albumIds: [] } : {}) } satisfies PlaylistData);
    onClose();
  };
  return (
    <Modal title={existing ? 'Edit playlist' : 'New playlist'} onClose={onClose} footer={<>
      {existing && <button className="btn text-bad" onClick={() => { if (confirm(`Delete “${existing.name}”? The tracks stay in your library.`)) { remove('playlists', existing.id); onClose(); leaveRemoved(nav, 'playlist', existing.id, { fallback: '/playlists' }); } }}>Delete</button>}
      <div className="ml-auto flex gap-2"><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-accent" disabled={!name.trim()} onClick={save}>{existing ? 'Save' : 'Create'}</button></div></>}>
      {!existing && <div className="flex flex-wrap items-center gap-2 rounded-theme border border-line p-2 text-sm"><span className="mr-auto text-muted">Start from a Spotify playlist?</span>
        <button type="button" className="btn !py-1 text-xs" onClick={() => useEditor.getState().open({ kind: 'import-spotify', id: '' })}>Import from Spotify…</button>
        <button type="button" className="btn !py-1 text-xs" title="Keep a playlist in step with one on your Spotify account" onClick={() => useEditor.getState().open({ kind: 'new-synced-playlist', id: '' })}>Synced playlist…</button></div>}
      <ImagePicker hash={cover} onChange={setCover} seed={name || 'playlist'} />
      <p className="-mt-2 text-xs text-muted">Leave the picture empty and the playlist shows a mosaic of the covers of its first four {kind === 'albums' ? 'albums' : 'tracks'}.</p>
      {!existing && <Field label="What does it hold?"><div className="flex gap-2" role="group" aria-label="Playlist type">
        <button type="button" className={`btn ${kind === 'tracks' ? 'btn-accent' : ''}`} aria-pressed={kind === 'tracks'} onClick={() => setKind('tracks')}>Songs</button>
        <button type="button" className={`btn ${kind === 'albums' ? 'btn-accent' : ''}`} aria-pressed={kind === 'albums'} onClick={() => setKind('albums')}>Albums</button></div></Field>}
      <Field label="Name"><input autoFocus className="input" placeholder="e.g. Late night jazz" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Description"><textarea className="input" rows={3} placeholder="What's the vibe of this collection?" value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
    </Modal>
  );
}

/** Put one track on one or more playlists (or a new one). Ticking toggles membership immediately. */
export function AddToPlaylistDialog({ trackId, onClose }: { trackId: string; onClose: () => void }) {
  const lib = useLibrary();
  const { put, patch } = useStore();
  const [name, setName] = useState('');
  const track = lib.trackById.get(trackId);
  if (!track) return null;
  const toggle = (id: string, ids: string[]) => patch('playlists', id, { trackIds: ids.includes(trackId) ? ids.filter((x) => x !== trackId) : [...ids, trackId] });
  const create = () => {
    if (!name.trim()) return;
    put('playlists', { name: name.trim(), description: null, cover: null, createdAt: Date.now(), trackIds: [trackId] } satisfies PlaylistData);
    setName('');
  };
  return (
    <Modal title="Add to playlist" onClose={onClose} footer={<button className="btn btn-accent ml-auto" onClick={onClose}>Done</button>}>
      <div className="text-sm text-muted">{track.title} · {track.artistName}</div>
      <div className="max-h-64 divide-y divide-line/60 overflow-y-auto rounded-theme border border-line">
        {lib.playlists.filter((p) => p.kind !== 'albums').map((p) => { const on = p.trackIds.includes(trackId); return (
          <button key={p.id} className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-raised" onClick={() => toggle(p.id, p.trackIds)}>
            <span className="flex h-5 w-5 items-center justify-center rounded border border-line">{on && <Check size={13} />}</span><span className="flex-1 truncate">{p.name}</span><span className="text-xs text-muted">{p.trackIds.length}</span></button>); })}
        {!lib.playlists.some((p) => p.kind !== 'albums') && <div className="px-3 py-3 text-sm text-muted">No playlists yet. Make one below.</div>}
      </div>
      <div className="flex gap-2"><input className="input" placeholder="New playlist name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} />
        <button className="btn shrink-0" disabled={!name.trim()} onClick={create}><Plus size={15} />Create &amp; add</button></div>
    </Modal>
  );
}

/** Put one album on one or more album playlists (or a new one). Ticking toggles membership immediately. */
export function AddAlbumToPlaylistDialog({ albumId, onClose }: { albumId: string; onClose: () => void }) {
  const lib = useLibrary();
  const { put, patch } = useStore();
  const [name, setName] = useState('');
  // `albumId` is an album id, or a release id to put just that edition on the list
  const release = lib.releases.find((r) => r.id === albumId);
  const album = lib.albumById.get(albumId) ?? (release && lib.albumById.get(release.albumId));
  if (!album) return null;
  const lists = lib.playlists.filter((p) => p.kind === 'albums');
  const toggle = (id: string, ids: string[]) => patch('playlists', id, { albumIds: ids.includes(albumId) ? ids.filter((x) => x !== albumId) : [...ids, albumId] });
  const create = () => {
    if (!name.trim()) return;
    put('playlists', { name: name.trim(), description: null, cover: null, createdAt: Date.now(), trackIds: [], kind: 'albums', albumIds: [albumId] } satisfies PlaylistData);
    setName('');
  };
  return (
    <Modal title="Add to album playlist" onClose={onClose} footer={<button className="btn btn-accent ml-auto" onClick={onClose}>Done</button>}>
      <div className="text-sm text-muted">{release ? `${album.title} · ${release.title} (release)` : album.title} · {album.artistName}</div>
      <div className="max-h-64 divide-y divide-line/60 overflow-y-auto rounded-theme border border-line">
        {lists.map((p) => { const on = (p.albumIds ?? []).includes(albumId); return (
          <button key={p.id} className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-raised" onClick={() => toggle(p.id, p.albumIds ?? [])}>
            <span className="flex h-5 w-5 items-center justify-center rounded border border-line">{on && <Check size={13} />}</span><span className="flex-1 truncate">{p.name}</span><span className="text-xs text-muted">{(p.albumIds ?? []).length}</span></button>); })}
        {!lists.length && <div className="px-3 py-3 text-sm text-muted">No album playlists yet. Make one below.</div>}
      </div>
      <div className="flex gap-2"><input className="input" placeholder="New album playlist name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} />
        <button className="btn shrink-0" disabled={!name.trim()} onClick={create}><Plus size={15} />Create &amp; add</button></div>
    </Modal>
  );
}

interface Picked { file: File; title: string }

/**
 * Add tracks from audio files on this device. Each file becomes a track (title from the file name, editable)
 * with its audio attached; files go to an album when one is given, else they are singles with the credits entered here.
 */
export function UploadDialog({ albumId, onClose }: { albumId: string; onClose: () => void }) {
  const lib = useLibrary();
  const { put, patch } = useStore();
  const nav = useNavigate();
  const [album, setAlbum] = useState(albumId);
  const [files, setFiles] = useState<Picked[]>([]);
  const [credits, setCredits] = useState<Credit[]>([{ artistId: '', role: [LEAD_ROLE] }]);
  const [progress, setProgress] = useState<{ done: number; failed: string[] } | null>(null);
  const a = album ? lib.albumById.get(album) : undefined;
  const follows = !!a && hasLead(withLeadFallback(a.credits ?? [], a.artistId));
  const clean = cleanCredits(credits);
  const ok = files.length > 0 && files.every((f) => f.title.trim()) && (follows || hasLead(clean)) && !progress?.done;
  const busy = !!progress && progress.done < files.length;

  const pick = (list: FileList | null) => {
    if (!list) return;
    const picked = [...list].sort((x, y) => x.name.localeCompare(y.name, undefined, { numeric: true })).map((file) => ({ file, title: titleFromFilename(file.name) }));
    setFiles((p) => [...p, ...picked]);
  };

  async function run() {
    const failed: string[] = [];
    let order = a ? [...a.trackIds] : [];
    let done = 0;
    setProgress({ done, failed });
    for (const f of files) {
      try {
        const r = await saveAudio(f.file);
        const own = follows ? withLeadFallback(a!.credits, a!.artistId) : clean;
        const id = put('tracks', newTrackData({
          title: f.title.trim(), credits: own, ...(follows ? { syncWithAlbumCredits: true, genres: [] } : inheritFromAlbum(a, own)), file: r.hash, bitrate: r.bitrate,
          albums: a ? [{ albumId: a.id, order: order.length }] : [],
        }));
        order = appendTrack(order, id);
      } catch { failed.push(f.file.name); }
      setProgress({ done: ++done, failed: [...failed] });
    }
    if (a) patch('albums', a.id, { trackOrder: order });
    const added = files.length - failed.length;
    if (added) logJournal('add', `Added ${added} track${added === 1 ? '' : 's'} from files`, a?.title ?? '', a?.id ?? null);
    if (!failed.length) { onClose(); if (a) nav(`/albums/${a.id}`); }
  }

  return (
    <Modal title="Add audio files" onClose={busy ? () => undefined : onClose} footer={<div className="ml-auto flex gap-2">
      <button className="btn btn-ghost" disabled={busy} onClick={onClose}>{progress?.failed.length ? 'Close' : 'Cancel'}</button>
      <button className="btn btn-accent" disabled={!ok || busy} onClick={() => void run()}>{busy ? `Adding ${progress!.done}/${files.length}…` : `Add ${files.length || ''} track${files.length === 1 ? '' : 's'}`}</button></div>}>
      <Field label="Album" hint="Optional. Without one, the tracks are singles.">
        <Select value={album} disabled={!!progress} options={albumOptions(lib, 'No album (singles)')} onChange={setAlbum} /></Field>
      <div className="space-y-2">
        <label className="btn cursor-pointer"><FileAudio size={15} />Choose files
          <input type="file" multiple hidden accept={AUDIO_ACCEPT} disabled={!!progress} onChange={(e) => { pick(e.target.files); e.target.value = ''; }} /></label>
        {files.map((f, i) => (
          <div key={`${f.file.name}${i}`} className="flex items-center gap-2"><span className="w-5 text-right text-xs text-muted">{i + 1}</span>
            <input className="input" aria-label={`Title for ${f.file.name}`} value={f.title} disabled={!!progress} onChange={(e) => setFiles(files.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
            <button type="button" className="px-1 text-muted hover:text-bad" aria-label="Remove file" disabled={!!progress} onClick={() => setFiles(files.filter((_, j) => j !== i))}>×</button></div>))}
      </div>
      {!follows && <Field label="Credits" hint="Needed because there is no album to take them from"><CreditsEditor requireLead value={credits} onChange={setCredits} /></Field>}
      {follows && <p className="text-xs text-muted">Credits and genres come from the album.</p>}
      {progress?.failed.length ? <div role="alert" className="rounded-theme bg-warn/15 p-3 text-sm text-warn">Could not read: {progress.failed.join(', ')}. The other files were added.</div> : null}
    </Modal>
  );
}
