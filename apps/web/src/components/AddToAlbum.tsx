import { Select, albumOptions } from './Select.tsx';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { newAlbumData } from '../lib/defaults.ts';
import type { TrackData } from '@turbomusic/core';
import { useLibrary } from '../lib/derive.ts';
import { defaultChoice, planAddToAlbum, type ReleaseChoice } from '../lib/albumOps.ts';
import { useStore } from '../lib/store.ts';
import { Field, Modal } from './forms.tsx';
import { plural } from '../lib/cn.ts';
import { Cover } from './Cover.tsx';

/** Write what planAddToAlbum worked out: the track's link, the album order and the releases. */
export function useAddToAlbum() {
  const lib = useLibrary();
  const { put, patch } = useStore();
  return (trackId: string, albumId: string, choice: ReleaseChoice) => {
    const album = lib.albumById.get(albumId);
    const raw = useStore.getState().rows.tracks.get(trackId)?.data as TrackData | undefined;
    if (!album || !raw) return;
    const plan = planAddToAlbum(lib, raw, trackId, album, choice);
    put('tracks', { ...raw, albums: plan.trackAlbums }, trackId);
    patch('albums', album.id, { trackOrder: plan.trackOrder });
    for (const a of plan.releaseAppends) patch('releases', a.id, { trackIds: a.trackIds });
    if (plan.newRelease) put('releases', plan.newRelease);
    if (plan.singleRelease) put('releases', plan.singleRelease);
  };
}

/** Which releases of the chosen album the track joins. Shown when a track is put on an album. */
export function ReleaseChoicePicker({ albumId, trackTitle, hasOwnCover, cover, value, onChange }: {
  albumId: string; trackTitle: string; hasOwnCover: boolean; cover: string | null; value: ReleaseChoice; onChange: (c: ReleaseChoice) => void;
}) {
  const lib = useLibrary();
  const album = lib.albumById.get(albumId);
  if (!album) return null;
  const releases = lib.releases.filter((r) => r.albumId === albumId);
  const toggle = (id: string, on: boolean) => onChange({ ...value, releaseIds: on ? [...value.releaseIds, id] : value.releaseIds.filter((x) => x !== id) });
  return (
    <fieldset className="space-y-2 rounded-theme border border-line p-3">
      <legend className="px-1 text-sm font-medium">Releases of {album.title}</legend>
      <p className="text-xs text-muted">{hasOwnCover
        ? 'This track has its own cover, so it starts as a release of its own. You can also add it to existing releases.'
        : 'This track has no cover of its own, so it joins the default release. Pick others if it belongs on them too.'}</p>
      <label className="flex items-center gap-3 text-sm">
        <input type="checkbox" checked={value.newRelease} onChange={(e) => onChange({ ...value, newRelease: e.target.checked })} />
        <Cover hash={cover} seed={trackTitle} className="h-9 w-9 shrink-0" />
        <span className="min-w-0 flex-1"><span className="block truncate font-medium">New release: {trackTitle}</span><span className="block text-xs text-muted">{hasOwnCover ? 'uses the track’s cover' : 'no cover'}</span></span>
      </label>
      <label className="flex items-center gap-3 text-sm">
        <input type="checkbox" checked={!!value.asSingle} onChange={(e) => onChange({ ...value, asSingle: e.target.checked })} />
        <Cover hash={cover} seed={trackTitle} className="h-9 w-9 shrink-0" />
        <span className="min-w-0 flex-1"><span className="block truncate font-medium">Keep it as a single too</span><span className="block text-xs text-muted">a release marked single: no name needed, it stays on the Singles page with its own stats page</span></span>
      </label>
      {releases.map((r) => (
        <label key={r.id} className="flex items-center gap-3 text-sm">
          <input type="checkbox" checked={value.releaseIds.includes(r.id)} onChange={(e) => toggle(r.id, e.target.checked)} />
          <Cover hash={r.cover ?? album.cover} seed={r.title} className="h-9 w-9 shrink-0" />
          <span className="min-w-0 flex-1"><span className="block truncate font-medium">{r.title}{album.defaultReleaseId === r.id && <span className="chip ml-2">default</span>}</span>
            <span className="block text-xs text-muted">{r.releaseDate ?? 'undated'} · {plural(r.trackIds.length, 'track')}</span></span>
        </label>))}
    </fieldset>
  );
}

/** "Add to album…" for a track (usually a single): pick the album, then which releases it joins. */
export function AddToAlbumDialog({ trackId, onClose }: { trackId: string; onClose: () => void }) {
  const lib = useLibrary();
  const add = useAddToAlbum();
  const track = lib.trackById.get(trackId);
  const [albumId, setAlbumId] = useState('');
  const [choice, setChoice] = useState<ReleaseChoice>({ releaseIds: [], newRelease: false });
  const { put, patch } = useStore();
  const nav = useNavigate();
  const [fresh, setFresh] = useState<string | null>(null); // title of the album to create, null = pick an existing one
  if (!track) return null;
  /** A new album built from this single: same credits and genres, one release (the single's own edition, with its cover and date). */
  const createAlbum = () => {
    const raw = useStore.getState().rows.tracks.get(trackId)?.data as TrackData | undefined;
    const title = (fresh ?? '').trim();
    if (!raw || !title) return;
    const albumId = put('albums', newAlbumData({ title, credits: raw.credits ?? [], genres: raw.genres ?? [], cover: raw.cover ?? null, trackOrder: [trackId] }));
    const releaseId = put('releases', { albumId, title, cover: raw.cover ?? null, releaseDate: raw.releaseDate ?? null, trackIds: [trackId] });
    patch('albums', albumId, { defaultReleaseId: releaseId });
    patch('tracks', trackId, { albums: [{ albumId, order: 0 }, ...(raw.albums ?? [])], syncWithAlbumCredits: true });
    onClose();
    nav(`/albums/${albumId}`);
  };
  const hasOwnCover = !!track.cover;
  const pick = (id: string) => {
    setAlbumId(id);
    const a = lib.albumById.get(id);
    if (a) setChoice(defaultChoice(lib, a, hasOwnCover));
  };
  return (
    <Modal title={`Add “${track.title}” to an album`} onClose={onClose} footer={<div className="ml-auto flex gap-2">
      <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
      {fresh !== null
        ? <button className="btn btn-accent" disabled={!fresh.trim()} onClick={createAlbum}>Create album</button>
        : <button className="btn btn-accent" disabled={!albumId} onClick={() => { add(trackId, albumId, choice); onClose(); }}>Add to album</button>}</div>}>
      {fresh !== null
        ? <>
            <Field label="New album title"><input className="input" autoFocus value={fresh} onChange={(e) => setFresh(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && createAlbum()} /></Field>
            <p className="text-xs text-muted">The album gets this track’s credits, genres, cover and release date, with the track as its first release. Add the other tracks afterwards.</p>
            <button className="btn btn-ghost" onClick={() => setFresh(null)}>Pick an existing album instead</button></>
        : <>
            <Field label="Album"><Select value={albumId} options={albumOptions(lib, 'Choose an album…')} onChange={pick} /></Field>
            <button className="btn" onClick={() => setFresh(track.title)}><Plus size={15} />New album from this track</button></>}
      {fresh === null && albumId && <ReleaseChoicePicker albumId={albumId} trackTitle={track.title} hasOwnCover={hasOwnCover} cover={track.cover} value={choice} onChange={setChoice} />}
    </Modal>
  );
}
