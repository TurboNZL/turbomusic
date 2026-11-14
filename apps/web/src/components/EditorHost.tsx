import { planMergeReleases, releaseDateQuery, siblingDate } from '../lib/releaseOps.ts';
import { DateLookup } from './DateLookup.tsx';
import { FindDatesDialog } from './FindDatesDialog.tsx';
import { MergeTracksDialog } from './MergeTracksDialog.tsx';
import { MergePlaylistDialog, SyncedPlaylistDialog } from './SyncedPlaylist.tsx';
import { MergeWithDialog, type MergeKind } from './MergeWith.tsx';
import { SpotifyLinks } from './SpotifyLinks.tsx';
import { X } from 'lucide-react';
import { makePrimary } from '../lib/autofill.ts';
import { Select, albumOptions } from './Select.tsx';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { leaveRemoved } from '../lib/leave.ts';
import type { AlbumData, ArtistData, Credit, EraData, GroupData, ReleaseData, GroupMemberData, PlaybackRule, ProfileData, TrackData } from '@turbomusic/core';
import { resolveEntity } from '../lib/entities.ts';
import { useLibrary } from '../lib/derive.ts';
import { useEditor, type EditTarget } from '../lib/editor.ts';
import { useStore } from '../lib/store.ts';
import { ImportIntoAlbumDialog } from './ImportIntoAlbumDialog.tsx';
import { SpotifyImportDialog } from './SpotifyImportDialog.tsx';
import { MatchLinksDialog } from './MatchLinksDialog.tsx';
import { MergeAlbumDialog } from './MergeAlbumDialog.tsx';
import { TrackDetails } from './TrackDetails.tsx';
import { ImportDialog } from './ImportDialog.tsx';
import { logJournal } from '../lib/journal.ts';
import { newAlbumData, newTrackData, inheritFromAlbum, appendTrack, moveTrack, removeTrack, cleanCredits, hasLead, leadCredit, LEAD_ROLE, withLeadFallback, ownCreditsFromAlbum } from '../lib/defaults.ts';
import { defaultChoice, defaultRelease, planAddToAlbum, type ReleaseChoice } from '../lib/albumOps.ts';
import { albumCover, coverPicked, coverPool } from '../lib/covers.ts';
import { CoverPool } from './CoverPool.tsx';
import { removeCoverFromAlbum } from '../lib/coverOps.ts';
import { saveRules } from '../lib/profile.ts';
import { eraPatches } from '../lib/eraOps.ts';
import { AudioPicker, CreditsEditor, FeaturedEditor, EntityPicker, EraPicker, Field, ImagePicker, Modal, TagInput, TrackPicker } from './forms.tsx';
import { CrossfadePick } from './CrossfadeCard.tsx';
import { FindArtistImagesDialog, FindGenresDialog, MergeGenresDialog } from './FillGaps.tsx';
import { AddToPlaylistDialog, AddAlbumToPlaylistDialog, NewArtistDialog, PlaylistDialog, UploadDialog } from './Dialogs.tsx';
import { AddToAlbumDialog, ReleaseChoicePicker } from './AddToAlbum.tsx';

/** Make sure every genre name used exists as a genre record, so it shows up in filters and suggestions. */
function useEnsureGenres() {
  const lib = useLibrary();
  const put = useStore((s) => s.put);
  return (names: string[]) => {
    const known = new Set(lib.genres.map((g) => g.name.toLowerCase()));
    for (const n of names) if (!known.has(n.toLowerCase())) { put('genres', { name: n }); known.add(n.toLowerCase()); }
  };
}

/** Make sure every role name used exists as a role category record. */
function useEnsureRoles() {
  const lib = useLibrary();
  const put = useStore((s) => s.put);
  return (credits: { role: string[] }[]) => {
    const known = new Set(lib.roles.map((r) => r.name.toLowerCase()));
    for (const n of credits.flatMap((c) => c.role)) if (!known.has(n.toLowerCase())) { put('roleCategories', { name: n, isRemovable: true }); known.add(n.toLowerCase()); }
  };
}

/** the stored record (no derived fields like rating), which is what edits must be based on */
const raw = <T,>(table: 'tracks' | 'albums' | 'artists', id: string) => useStore.getState().rows[table].get(id)?.data as T | undefined;

const numOrNull = (s: string) => (s.trim() === '' || Number.isNaN(Number(s)) ? null : Number(s));

function TrackEditor({ id, onClose }: { id: string; onClose: () => void }) {
  const nav = useNavigate();
  const lib = useLibrary();
  const { put, patch, remove } = useStore();
  const ensureGenres = useEnsureGenres();
  const ensureRoles = useEnsureRoles();
  const track = lib.trackById.get(id);
  const rule = lib.rules.find((r) => r.trackAId === id);
  const [t, setT] = useState<TrackData | null>(() => {
    const d = raw<TrackData>('tracks', id);
    // legacy records have the artist only in artistId; show it as a lead credit so saving keeps it
    return d ? { ...d, credits: withLeadFallback(d.credits ?? [], d.artistId) } : null;
  });
  const [after, setAfter] = useState<string | null>(rule?.trackBId ?? null);
  const [first, setFirst] = useState(rule?.playFirstOnShuffle ?? true);
  const [albumOnly, setAlbumOnly] = useState(rule?.applyToAlbumSource ?? false);
  const [fadeSec, setFadeSec] = useState<number | null>(rule?.crossfadeSec ?? null);
  const [shiftSec, setShiftSec] = useState<number>(rule?.crossfadeShiftSec ?? 0);
  const [fadeOut, setFadeOut] = useState<boolean>(rule?.crossfadeOut !== false);
  const [fadeIn, setFadeIn] = useState<boolean>(rule?.crossfadeIn !== false);
  const [albumSel, setAlbumSel] = useState(track?.albumId ?? '');
  const [eraIds, setEraIds] = useState<string[]>(() => (track?.albumId ? [] : track?.eraIds ?? []));
  const [choice, setChoice] = useState<ReleaseChoice>({ releaseIds: [], newRelease: false });
  if (!track || !t) return null;
  const set = <K extends keyof TrackData>(k: K, v: TrackData[K]) => setT((p) => ({ ...p!, [k]: v }));
  const selAlbum = albumSel ? lib.albumById.get(albumSel) : undefined;
  const albumCredits = selAlbum?.credits ?? [];
  /** a track that follows its album shows the album's credits, read-only */
  const follows = !!albumSel && !!t.syncWithAlbumCredits && hasLead(albumCredits);
  const credits = cleanCredits(t.credits ?? []);
  const canSave = follows || hasLead(credits);

  function save() {
    const { artistId: _legacy, ...base } = t!;
    // a single has no album to follow
    const d = { ...base, credits, cover: t!.cover || null, syncWithAlbumCredits: albumSel ? base.syncWithAlbumCredits : false };
    if (!d.syncWithAlbumCredits) ensureGenres(d.genres ?? []);
    ensureRoles(follows ? [] : credits);
    // moving the track to another album (or none): its first album link is the one it shows, and both albums' orders follow
    const moved = albumSel !== (track!.albumId ?? '');
    const kept = { ...d, albums: (d.albums ?? []).filter((l) => l.albumId !== track!.albumId) };
    const plan = moved && selAlbum ? planAddToAlbum(lib, kept, id, selAlbum, choice) : null;
    const albums = moved ? (plan ? plan.trackAlbums : kept.albums) : d.albums;
    put('tracks', { ...d, albums, eraId: null }, id);
    // eras are collections: a single is listed in them, a track on an album is in them through its album
    for (const e of eraPatches(lib, 'track', id, albumSel ? [] : eraIds)) patch('eras', e.id, e.patch);
    if (moved) {
      const from = track!.albumId ? lib.albumById.get(track!.albumId) : undefined;
      if (from) {
        patch('albums', from.id, { trackOrder: removeTrack(from.trackIds, id) });
        for (const r of lib.releases) if (r.albumId === from.id && r.trackIds.includes(id)) patch('releases', r.id, { trackIds: removeTrack(r.trackIds, id) });
      }
      if (plan && selAlbum) {
        patch('albums', selAlbum.id, { trackOrder: plan.trackOrder });
        for (const a of plan.releaseAppends) patch('releases', a.id, { trackIds: a.trackIds });
        if (plan.newRelease) put('releases', plan.newRelease);
      }
    }
    // playback rule lives on the profile: replace this track's rule
    const others = lib.rules.filter((r) => r.trackAId !== id);
    const rules: PlaybackRule[] = after ? [...others, { trackAId: id, trackBId: after, playFirstOnShuffle: first, applyToAlbumSource: albumOnly, crossfadeSec: fadeSec, ...(shiftSec > 0 ? { crossfadeShiftSec: shiftSec } : {}), ...(fadeOut ? {} : { crossfadeOut: false }), ...(fadeIn ? {} : { crossfadeIn: false }) }] : others;
    if (rules.length !== lib.rules.length || after !== (rule?.trackBId ?? null) || first !== (rule?.playFirstOnShuffle ?? true) || albumOnly !== (rule?.applyToAlbumSource ?? false) || fadeSec !== (rule?.crossfadeSec ?? null) || shiftSec !== (rule?.crossfadeShiftSec ?? 0) || fadeOut !== (rule?.crossfadeOut !== false) || fadeIn !== (rule?.crossfadeIn !== false)) {
      saveRules(lib, rules);
    }
    onClose();
  }

  return (
    <Modal title="Edit track" onClose={onClose} footer={<>
      <button className="btn text-bad" onClick={() => { if (confirm(`Delete “${track.title}”? Its votes stay in the history.`)) { remove('tracks', id); onClose(); leaveRemoved(nav, 'track', id, { fallback: '/tracks' }); } }}>Delete</button>
      <div className="ml-auto flex gap-2"><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-accent" disabled={!canSave} onClick={save}>Save</button></div></>}>
      <Field label="Title"><input className="input" value={t.title ?? ''} onChange={(e) => set('title', e.target.value)} /></Field>
      <Field label="Album" hint="Cover, genres and (if ticked below) credits come from the album. Moving a track puts it last on the new album.">
        <Select value={albumSel} options={albumOptions(lib, 'No album (single)')} onChange={(v) => { setAlbumSel(v); const a = lib.albumById.get(v); if (a) setChoice(defaultChoice(lib, a, !!t.cover)); }} /></Field>
      {albumSel !== (track.albumId ?? '') && albumSel && <ReleaseChoicePicker albumId={albumSel} trackTitle={t.title || track.title} hasOwnCover={!!t.cover} cover={t.cover ?? null} value={choice} onChange={setChoice} />}
      {albumSel && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!t.syncWithAlbumCredits} onChange={(e) => {
        const on = e.target.checked;
        // Switching to track-specific credits starts from what the track showed: while it followed its album that was the album's credits
        // (all of a duo's leads), plus anything of its own it stored. A track that already had its own credits keeps them.
        setT((p) => {
          const wasFollowing = !!track.syncWithAlbumCredits && hasLead(albumCredits); // as the record was when opened, not as the box was a moment ago
          return { ...p!, syncWithAlbumCredits: on,
            credits: !on && (wasFollowing || !hasLead(p!.credits ?? [])) ? ownCreditsFromAlbum(albumCredits, p!.credits ?? []) : p!.credits,
            genres: !on && wasFollowing && !(p!.genres ?? []).length ? [...(selAlbum?.genres ?? [])] : p!.genres };
        });
      }} />Use the album's credits and genres{selAlbum ? ` (${selAlbum.title})` : ''}</label>}
      <Field label={follows ? 'Credits (from the album)' : 'Credits'}>{follows
        ? <CreditsEditor readOnly value={albumCredits} onChange={() => undefined} />
        : <CreditsEditor requireLead value={t.credits ?? []} onChange={(v) => set('credits', v)} />}</Field>
      {follows && <Field label="Featured artists" hint="Added on this track only; the credits above stay the album's."><FeaturedEditor value={t.credits ?? []} onChange={(v) => set('credits', v)} /></Field>}
      {albumSel && t.syncWithAlbumCredits && <Field label="Genres (from the album)"><div className="flex flex-wrap gap-1.5">{(selAlbum?.genres ?? []).length ? selAlbum!.genres.map((g) => <span key={g} className="chip">{g}</span>) : <span className="text-sm text-muted">The album has no genre yet.</span>}</div></Field>}
      {(!albumSel || !t.syncWithAlbumCredits) && <Field label="Genres"><TagInput value={t.genres ?? []} onChange={(v) => set('genres', v)} suggestions={lib.genres.map((g) => g.name)} /></Field>}
      {!albumSel && <Field label="Eras" hint="Optional. A single can be in several eras."><EraPicker value={eraIds} onChange={setEraIds} /></Field>}
      <Field label="Cover" hint={albumSel ? "Optional. Without one the track shows its album's cover. If you add a track that has one to another album, it becomes a release of its own." : 'The single’s artwork.'}>
        <ImagePicker hash={t.cover ?? null} onChange={(h) => set('cover', h)} seed={t.title || 'track'} /></Field>
      {!albumSel && <Field label="Release date" hint="When the single came out. A track on an album uses its album's release date."><input type="date" className="input" value={t.releaseDate ?? ''} onChange={(e) => set('releaseDate', e.target.value || null)} />
        <DateLookup title={t.title} artist={lib.artistById.get(credits.find((c) => c.artistId && (c.role ?? []).some((r) => r.toLowerCase() === LEAD_ROLE.toLowerCase()))?.artistId ?? credits.find((c) => c.artistId)?.artistId ?? '')?.name ?? ''} onFound={(d) => set('releaseDate', d)} /></Field>}
      <Field label="Manual rating (0–10)" hint="A floor until votes take over"><input className="input" inputMode="decimal" value={t.initialRating ?? ''} onChange={(e) => set('initialRating', numOrNull(e.target.value))} /></Field>
      <Field label="Audio file" hint="Upload a file from this device, or add a YouTube link below and let the server download it"><AudioPicker hash={t.file} onChange={(file, bitrate) => setT((p) => ({ ...p!, file, bitrate: file ? bitrate ?? p!.bitrate : null }))} /></Field>
      <Field label="YouTube Music URL" hint="Used to download the audio"><input className="input" value={t.youtubeMusicUrl ?? ''} onChange={(e) => set('youtubeMusicUrl', e.target.value || null)} /></Field>
      <Field label="Spotify URLs" hint="The first one is the one played through Spotify. Add more when the same song is also another Spotify track (a single that later came out on an album has its own link).">
        <SpotifyLinks primary={t.spotifyUrl ?? null} others={t.spotifyUrls ?? []} onChange={(f) => setT((p) => ({ ...p!, ...f }))} /></Field>
      <Field label="Genius URL"><input className="input" value={t.geniusUrl ?? ''} onChange={(e) => set('geniusUrl', e.target.value || null)} /></Field>
      <div className="space-y-2 rounded-theme border border-line p-3">
        <div className="text-sm font-medium">Pre-release version</div>
        {!track.preReleaseIds.length && <>
          <div className="text-xs text-muted">Is this a leak, demo or other unreleased version of a song that has come out? Tie it to the released track: it keeps its own info and stats, but stops showing up as an entry of its own (lists, shuffle, ranking) until you untie it.</div>
          <TrackPicker value={t.preReleaseOf ?? null} onChange={(v) => set('preReleaseOf', v)} exclude={id} />
          {t.preReleaseOf && <div className="text-xs text-muted">Tied to “{lib.trackById.get(t.preReleaseOf)?.title ?? 'a track'}”. {lib.trackById.get(t.preReleaseOf)?.preReleaseOf ? 'That track is itself a pre-release, so this link does nothing until you pick a released track.' : 'Its title shows “[U]” in stats and history. Clear the choice above to make it an ordinary track again.'}</div>}</>}
        {track.preReleaseIds.length > 0 && <>
          <div className="text-xs text-muted">These pre-release versions are tied to this track and hidden from the lists. Choose one as the primary audio to play its file for this track (never done automatically). Unties here, or in each one’s own editor.</div>
          <label className="flex items-center gap-2 text-sm"><input type="radio" name="primary-audio" checked={!t.primaryAudioFrom} onChange={() => set('primaryAudioFrom', null)} />This track’s own audio</label>
          {track.preReleaseIds.map((pid) => { const p = lib.trackById.get(pid); return p && (
            <div key={pid} className="flex items-center gap-2 text-sm">
              <label className="flex min-w-0 flex-1 items-center gap-2"><input type="radio" name="primary-audio" disabled={!p.file} checked={t.primaryAudioFrom === pid} onChange={() => set('primaryAudioFrom', pid)} /><span className="truncate">{p.title}{!p.file && ' (no audio)'}</span></label>
              <button type="button" className="btn btn-ghost !px-2 !py-1 text-xs" onClick={() => useEditor.getState().open({ kind: 'track', id: pid })}>Edit</button>
              <button type="button" className="btn btn-ghost !px-2 !py-1 text-xs" onClick={() => patch('tracks', pid, { preReleaseOf: null } as Partial<TrackData>)}>Untie</button>
            </div>); })}</>}
      </div>
      <div className="space-y-2 rounded-theme border border-line p-3">
        <div className="text-sm font-medium">Playback rule: play another track right after this one</div>
        <TrackPicker value={after} onChange={setAfter} exclude={id} />
        {after && <><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={first} onChange={(e) => setFirst(e.target.checked)} />Keep them together when shuffling</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={albumOnly} onChange={(e) => setAlbumOnly(e.target.checked)} />Only when playing from an album</label>
          <div className="space-y-1 text-sm"><div>Crossfade into it</div><CrossfadePick value={fadeSec} onChange={setFadeSec} shift={shiftSec} onShift={setShiftSec} shape={{ out: fadeOut, in: fadeIn }} onShape={(p) => { if (p.crossfadeOut !== undefined) setFadeOut(p.crossfadeOut); if (p.crossfadeIn !== undefined) setFadeIn(p.crossfadeIn); }} /></div></>}
      </div>
    </Modal>
  );
}

function AlbumEditor({ id, onClose }: { id: string; onClose: () => void }) {
  const lib = useLibrary();
  const { put, patch, remove } = useStore();
  const nav = useNavigate();
  const ensureGenres = useEnsureGenres();
  const ensureRoles = useEnsureRoles();
  const album = lib.albumById.get(id);
  const [eraIds, setEraIds] = useState<string[]>(() => lib.albumById.get(id)?.eraIds ?? []);
  const [a, setA] = useState<AlbumData | null>(() => {
    const d = raw<AlbumData>('albums', id);
    return d ? { ...d, credits: withLeadFallback(d.credits ?? [], d.artistId) } : null;
  });
  if (!album || !a) return null;
  const set = <K extends keyof AlbumData>(k: K, v: AlbumData[K]) => setA((p) => ({ ...p!, [k]: v }));
  const credits = cleanCredits(a.credits ?? []);
  const mine = lib.releases.filter((r) => r.albumId === id);
  const pool = coverPool(a, mine);
  const inherited = albumCover({ ...a, coverPicked: false }, mine, defaultRelease(lib, album));
  return (
    <Modal title="Edit album" onClose={onClose} footer={<>
      <button className="btn text-bad" onClick={() => { if (confirm(`Delete “${album.title}”? Its tracks stay in your library.`)) { remove('albums', id); onClose(); leaveRemoved(nav, 'album', id, { fallback: '/albums' }); } }}>Delete</button>
      <div className="ml-auto flex gap-2"><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-accent" disabled={!hasLead(credits)} onClick={() => {
        const { artistId: _legacy, ...rest } = a;
        ensureGenres(a.genres ?? []); ensureRoles(credits); put('albums', { ...rest, credits, eraId: null }, id);
        for (const e of eraPatches(lib, 'album', id, eraIds)) patch('eras', e.id, e.patch);
        onClose();
      }}>Save</button></div></>}>
      <Field label="Cover" hint="Every image of this album is kept here, including the ones its releases replaced, until you delete it. Lock one to keep it as the cover.">
        <CoverPool seed={album.title} pool={pool} locked={coverPicked(a) ? a.cover ?? null : null} showing={coverPicked(a) && a.cover ? a.cover : inherited}
          autoLabel="Automatic: the album shows its default release's cover."
          onLock={(h) => setA((p) => ({ ...p!, cover: h, coverPicked: !!h }))}
          onAdd={(h) => setA((p) => ({ ...p!, covers: (p!.covers ?? []).includes(h) ? p!.covers : [...(p!.covers ?? []), h] }))}
          onRemove={(h) => {
            const users = mine.filter((r) => r.cover === h).length;
            if (!confirm(`Delete this image for good?${users ? ` ${users} release${users > 1 ? 's use' : ' uses'} it and will go back to the album's cover.` : ''}`)) return;
            removeCoverFromAlbum(id, h);
            setA((p) => ({ ...p!, covers: (p!.covers ?? []).filter((x) => x !== h), ...(p!.cover === h ? { cover: null, coverPicked: false } : {}) }));
          }} /></Field>
      <Field label="Title"><input className="input" value={a.title ?? ''} onChange={(e) => set('title', e.target.value)} /></Field>
      <Field label="Genres" hint="Tracks that use the album's genres follow these"><TagInput value={a.genres ?? []} onChange={(v) => set('genres', v)} suggestions={lib.genres.map((g) => g.name)} /></Field>
      <Field label="Eras" hint="Optional. An album can be in several eras."><EraPicker value={eraIds} onChange={setEraIds} /></Field>
      <Field label="Credits"><CreditsEditor requireLead value={a.credits ?? []} onChange={(v) => set('credits', v)} /></Field>
    </Modal>
  );
}

function ArtistEditor({ id, onClose }: { id: string; onClose: () => void }) {
  const lib = useLibrary();
  const { put, remove } = useStore();
  const nav = useNavigate();
  const artist = lib.artistById.get(id);
  const [a, setA] = useState<ArtistData | null>(() => raw<ArtistData>('artists', id) ?? null);
  if (!artist || !a) return null;
  const used = lib.tracks.filter((t) => t.credits.some((c) => c.artistId === id)).length + lib.albums.filter((x) => x.credits.some((c) => c.artistId === id)).length;
  return (
    <Modal title="Edit artist" onClose={onClose} footer={<>
      <button className="btn text-bad" disabled={used > 0} title={used ? 'Still credited on tracks or albums' : ''} onClick={() => { if (confirm(`Delete ${artist.name}?`)) { remove('artists', id); onClose(); leaveRemoved(nav, 'artist', id, { fallback: '/artists' }); } }}>Delete</button>
      <div className="ml-auto flex gap-2"><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-accent" onClick={() => {
        put('artists', { ...a, name: a.name.trim() || artist.name }, id); onClose();
      }}>Save</button></div></>}>
      <ImagePicker kind="artist" hash={a.image ?? null} onChange={(h) => setA({ ...a, image: h })} seed={artist.name} />
      <Field label="Name" hint="The name shown everywhere (the primary alias)."><input className="input" value={a.name ?? ''} onChange={(e) => setA({ ...a, name: e.target.value })} /></Field>
      <AliasEditor name={a.name ?? ''} aliases={a.aliases ?? []} onChange={(name, aliases) => setA({ ...a, name, aliases })} />
    </Modal>
  );
}

/** Other names an artist goes by. Imports recognise them; one of them can become the displayed name. */
export function AliasEditor({ name, aliases, onChange }: { name: string; aliases: string[]; onChange: (name: string, aliases: string[]) => void }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const v = draft.trim();
    if (!v || v.toLowerCase() === name.trim().toLowerCase() || aliases.some((x) => x.toLowerCase() === v.toLowerCase())) { setDraft(''); return; }
    onChange(name, [...aliases, v]); setDraft('');
  };
  return (
    <Field label="Also known as" hint="Stage names, old names, other spellings. When you import something by one of these names it is matched to this artist. Make one primary to show it instead.">
      <div className="space-y-1.5">
        {aliases.map((al) => (
          <div key={al} className="flex items-center gap-2 rounded-theme bg-raised px-3 py-1.5 text-sm">
            <span className="min-w-0 flex-1 truncate">{al}</span>
            <button type="button" className="btn btn-ghost !px-2 !py-0.5 text-xs" onClick={() => { const m = makePrimary(name, aliases, al); onChange(m.name, m.aliases); }}>Make primary</button>
            <button type="button" aria-label={`Remove ${al}`} className="text-muted hover:text-bad" onClick={() => onChange(name, aliases.filter((x) => x !== al))}><X size={14} /></button>
          </div>))}
        <div className="flex gap-2"><input className="input" placeholder="Add another name…" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} /><button type="button" className="btn shrink-0" disabled={!draft.trim()} onClick={add}>Add</button></div>
      </div>
    </Field>);
}

function NewAlbumDialog({ onClose }: { onClose: () => void }) {
  const lib = useLibrary();
  const put = useStore((s) => s.put);
  const nav = useNavigate();
  const ensureGenres = useEnsureGenres();
  const ensureRoles = useEnsureRoles();
  const [title, setTitle] = useState('');
  const [credits, setCredits] = useState<Credit[]>([{ artistId: '', role: [LEAD_ROLE] }]);
  const [genres, setGenres] = useState<string[]>([]);
  const [cover, setCover] = useState<string | null>(null);
  const clean = cleanCredits(credits);
  const ok = title.trim() && hasLead(clean);
  return (
    <Modal title="New album" onClose={onClose} footer={<div className="ml-auto flex gap-2"><button className="btn btn-ghost" onClick={onClose}>Cancel</button>
      <button className="btn btn-accent" disabled={!ok} onClick={() => { ensureGenres(genres); ensureRoles(clean); const id = put('albums', newAlbumData({ title: title.trim(), credits: clean, genres, cover, covers: cover ? [cover] : [], coverPicked: !!cover })); logJournal('add', `Added album: ${title.trim()}`, lib.artistById.get(clean.find((c) => c.artistId)?.artistId ?? '')?.name ?? '', id); onClose(); nav(`/albums/${id}`); }}>Create</button></div>}>
      <ImagePicker hash={cover} onChange={setCover} seed={title || 'new'} />
      <Field label="Title"><input autoFocus className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
      <Field label="Credits"><CreditsEditor requireLead value={credits} onChange={setCredits} /></Field>
      <Field label="Genres"><TagInput value={genres} onChange={setGenres} suggestions={lib.genres.map((g) => g.name)} /></Field>
    </Modal>
  );
}

function NewTrackDialog({ albumId, onClose }: { albumId: string; onClose: () => void }) {
  const lib = useLibrary();
  const { put, patch } = useStore();
  const nav = useNavigate();
  const [albumSel, setAlbumSel] = useState(albumId);
  const album = albumSel ? lib.albumById.get(albumSel) : undefined;
  const blank = (): Credit[] => [{ artistId: '', role: [LEAD_ROLE] }];
  const fromAlbum = (a: typeof album): Credit[] => {
    const own = withLeadFallback((a?.credits ?? []).map((c) => ({ ...c, role: [...c.role] })), a?.artistId);
    return hasLead(own) ? own : blank();
  };
  const [title, setTitle] = useState('');
  const [credits, setCredits] = useState<Credit[]>(() => fromAlbum(album));
  const [yt, setYt] = useState('');
  const [sp, setSp] = useState('');
  const [file, setFile] = useState<string | null>(null);
  const [bitrate, setBitrate] = useState<string | null>(null);
  const [cover, setCover] = useState<string | null>(null);
  const [eraIds, setEraIds] = useState<string[]>([]);
  const [choice, setChoice] = useState<ReleaseChoice>(() => (album ? defaultChoice(lib, album, false) : { releaseIds: [], newRelease: false }));
  const ensureRoles = useEnsureRoles();
  if (albumId && !lib.albumById.has(albumId)) return null;
  const clean = cleanCredits(credits);
  const ok = title.trim() && hasLead(clean);
  const pickAlbum = (id: string, hasCover: boolean) => {
    const next = lib.albumById.get(id);
    setAlbumSel(id);
    if (next) setChoice(defaultChoice(lib, next, hasCover));
    if (!hasLead(cleanCredits(credits))) setCredits(fromAlbum(next));
  };
  return (
    <Modal title={album && albumId ? `Add a track to ${album.title}` : 'New track'} onClose={onClose} footer={<div className="ml-auto flex gap-2"><button className="btn btn-ghost" onClick={onClose}>Cancel</button>
      <button className="btn btn-accent" disabled={!ok} onClick={() => {
        ensureRoles(clean);
        const data = newTrackData({ title: title.trim(), credits: clean, ...inheritFromAlbum(album, clean), file, bitrate, cover, youtubeMusicUrl: yt.trim() || null, spotifyUrl: sp.trim() || null });
        const id = put('tracks', data);
        if (!album) for (const e of eraPatches(lib, 'track', id, eraIds)) patch('eras', e.id, e.patch);
        if (album) {
          const plan = planAddToAlbum(lib, data, id, album, choice);
          put('tracks', { ...data, albums: plan.trackAlbums }, id);
          patch('albums', album.id, { trackOrder: plan.trackOrder });
          for (const a of plan.releaseAppends) patch('releases', a.id, { trackIds: a.trackIds });
          if (plan.newRelease) put('releases', plan.newRelease);
        }
        onClose();
        if (!albumId && album) nav(`/albums/${album.id}`);
      }}>Add track</button></div>}>
      <Field label="Title"><input autoFocus className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
      {!albumId && <Field label="Album" hint="Optional. Leave empty for a single.">
        <Select value={albumSel} options={albumOptions(lib, 'No album')} onChange={(v) => pickAlbum(v, !!cover)} /></Field>}
      {album && <ReleaseChoicePicker albumId={album.id} trackTitle={title || 'New track'} hasOwnCover={!!cover} cover={cover} value={choice} onChange={setChoice} />}
      {!album && <Field label="Eras" hint="Optional. A single can be in several eras."><EraPicker value={eraIds} onChange={setEraIds} /></Field>}
      <Field label="Cover" hint={album ? "Optional. Without one the track shows its album's cover. With one, it is added as a release of its own." : "The single's artwork."}>
        <ImagePicker hash={cover} onChange={(h) => { setCover(h); if (album) setChoice(defaultChoice(lib, album, !!h)); }} seed={title || 'new'} /></Field>
      <Field label="Credits" hint={album ? "Starts from the album's credits" : undefined}><CreditsEditor requireLead value={credits} onChange={setCredits} /></Field>
      <Field label="Audio file" hint="From this device. Or use a YouTube link below."><AudioPicker hash={file} onChange={(f, b) => { setFile(f); setBitrate(b); }} /></Field>
      <Field label="YouTube Music URL" hint="Lets the server download the audio"><input className="input" value={yt} onChange={(e) => setYt(e.target.value)} /></Field>
      <Field label="Spotify URL"><input className="input" value={sp} onChange={(e) => setSp(e.target.value)} /></Field>
    </Modal>
  );
}

/** Create or edit a note: a titled write-up tied to at least one thing. `initial` pre-links an entity ("album:xyz") when started from its page. */
/** a category that does not exist yet: made when the note is saved, so cancelling leaves nothing behind */
const NEW_CATEGORY = 'new:';

function NoteDialog({ noteId, initial, onClose }: { noteId?: string; initial?: string; onClose: () => void }) {
  const nav = useNavigate();
  const lib = useLibrary();
  const { put, remove } = useStore();
  const existing = noteId ? lib.groups.find((g) => g.id === noteId) : undefined;
  const [g, setG] = useState<GroupData>(() => {
    if (existing) return { ...existing };
    const [t, i] = (initial ?? '').split(':');
    const pre: GroupMemberData[] = t && i ? [{ entityType: t as GroupMemberData['entityType'], entityId: i, showOnEntityPage: true }] : [];
    // the first note on a thing starts out named after it and filed under its kind ("Era", "Artist", ...); both can be changed
    const first = !!(t && i) && !lib.groups.some((n) => n.members.some((m) => m.entityType === t && m.entityId === i));
    const label = first ? resolveEntity(lib, t as GroupMemberData['entityType'], i)?.label : undefined;
    const kind = t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
    const cat = first && kind ? lib.noteCategories.find((c) => c.name.toLowerCase() === kind.toLowerCase())?.id ?? `${NEW_CATEGORY}${kind}` : null;
    return { name: label ?? '', description: '', label: null, categoryId: cat, members: pre };
  });
  if (noteId && !existing) return null;
  const add = (e: { type: GroupMemberData['entityType']; id: string }) =>
    !g.members.some((m) => m.entityType === e.type && m.entityId === e.id) && setG({ ...g, members: [...g.members, { entityType: e.type, entityId: e.id, showOnEntityPage: true }] });
  const ok = g.name.trim() && g.members.length > 0;
  /** categories that no note uses once this note is saved with `keep` (or deleted: null) are removed, so none are left orphaned */
  const pruneCategories = (keep: string | null) => {
    const used = new Set(lib.groups.filter((n) => n.id !== noteId).map((n) => n.categoryId));
    if (keep) used.add(keep);
    for (const c of lib.noteCategories) if (!used.has(c.id)) remove('noteCategories', c.id);
  };
  const categories = [...lib.noteCategories].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <Modal title={noteId ? 'Edit note' : 'New note'} onClose={onClose} footer={<>
      {noteId && <button className="btn text-bad" onClick={() => { if (confirm(`Delete “${g.name}”?`)) { remove('groups', noteId); pruneCategories(null); onClose(); leaveRemoved(nav, 'note', noteId, { fallback: '/notes' }); } }}>Delete</button>}
      <div className="ml-auto flex gap-2"><button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-accent" disabled={!ok} onClick={() => {
          const { type: _old, ...rest } = g;
          if (rest.categoryId?.startsWith(NEW_CATEGORY)) rest.categoryId = put('noteCategories', { name: rest.categoryId.slice(NEW_CATEGORY.length) });
          const id = put('groups', { ...rest, name: g.name.trim(), label: null, description: g.description?.trim() || null, createdAt: g.createdAt ?? Date.now() }, noteId);
          if (!noteId) logJournal('bio', `New note: ${g.name.trim()}`, '', id);
          pruneCategories(g.categoryId?.startsWith(NEW_CATEGORY) ? null : g.categoryId ?? null);
          onClose();
        }}>Save</button></div></>}>
      <Field label="Title"><input autoFocus className="input" value={g.name} onChange={(e) => setG({ ...g, name: e.target.value })} /></Field>
      <Field label="Category" hint="Your own: type a name that does not exist yet to create it."><Select value={g.categoryId ?? ''} placeholder="No category" searchable
        options={[{ value: '', label: 'No category' }, ...(g.categoryId?.startsWith(NEW_CATEGORY) ? [{ value: g.categoryId, label: `${g.categoryId.slice(NEW_CATEGORY.length)} (new)` }] : []), ...categories.map((c) => ({ value: c.id, label: c.name }))]} onChange={(v) => setG({ ...g, categoryId: v || null })}
        creatable={{ label: (n) => `Create category: “${n}”`, create: (n) => put('noteCategories', { name: n }) }} /></Field>
      <Field label="Text"><textarea className="input" rows={5} value={g.description ?? ''} onChange={(e) => setG({ ...g, description: e.target.value })} /></Field>
      <div className="space-y-2"><div className="text-sm text-muted">Tied to ({g.members.length}), and whether the note shows on that page</div>
        {g.members.length === 0 && <div role="alert" className="rounded-theme bg-warn/15 p-3 text-sm text-warn">A note has to be tied to at least one thing. Search below.</div>}
        {g.members.map((m, i) => { const r = resolveEntity(lib, m.entityType, m.entityId); return (
          <div key={i} className="flex items-center gap-2 rounded-theme bg-raised px-3 py-2 text-sm">
            <span className="chip">{m.entityType}</span><span className="min-w-0 flex-1 truncate">{r?.label ?? '(deleted)'}</span>
            <label className="flex items-center gap-1 text-xs text-muted"><input type="checkbox" checked={m.showOnEntityPage} onChange={(e) => setG({ ...g, members: g.members.map((x, j) => (j === i ? { ...x, showOnEntityPage: e.target.checked } : x)) })} />show</label>
            <button type="button" aria-label="Unlink" className="text-muted hover:text-fg" onClick={() => setG({ ...g, members: g.members.filter((_, j) => j !== i) })}>×</button></div>); })}
        <EntityPicker onPick={add} /></div>
    </Modal>
  );
}

/** Create or edit a release (an edition of an album with its own tracklist, date and cover). */
/** Fold this release into another release of the album (the other one survives). */
function MergeReleaseInto({ releaseId, onDone }: { releaseId: string; onDone: () => void }) {
  const lib = useLibrary();
  const { patch, remove } = useStore();
  const me = lib.releases.find((r) => r.id === releaseId);
  const others = lib.releases.filter((r) => r.albumId === me?.albumId && r.id !== releaseId);
  const [into, setInto] = useState('');
  if (!me || !others.length) return null;
  const plan = into ? planMergeReleases(lib, into, releaseId) : null;
  const run = () => {
    if (!plan) return;
    patch('releases', into, plan.keepPatch);
    if (Object.keys(plan.albumPatch).length) patch('albums', me.albumId, plan.albumPatch);
    remove('releases', plan.removeId);
    onDone();
  };
  return (
    <div className="space-y-2 rounded-theme border border-line p-3">
      <div className="text-sm font-medium">Merge into another release</div>
      <p className="text-xs text-muted">Two entries of the same edition (the one a Spotify import made and the one a YouTube import made, say) become one. The other release survives; this one is deleted.</p>
      <Select value={into} onChange={setInto} placeholder={`Merge “${me.title}” into…`} options={others.map((r) => ({ value: r.id, label: `${r.title}${r.releaseDate ? ` · ${r.releaseDate}` : ''}`, hint: `${r.trackIds.length} tracks` }))} />
      {plan && plan.summary.length > 0 && <ul className="list-disc pl-5 text-xs text-muted">{plan.summary.map((x) => <li key={x}>{x}</li>)}</ul>}
      <button className="btn" disabled={!plan} onClick={run}>Merge</button>
    </div>
  );
}

function ReleaseDialog({ releaseId, albumId, onClose }: { releaseId?: string; albumId?: string; onClose: () => void }) {
  const lib = useLibrary();
  const { put, patch, remove } = useStore();
  // the stored record, not the derived one: a release without a name is stored with a blank title (it is shown under the album's name)
  const existing = releaseId ? useStore.getState().rows.releases.get(releaseId)?.data as ReleaseData | undefined : undefined;
  const album = lib.albumById.get(existing?.albumId ?? albumId ?? '');
  const [added, setAdded] = useState<string[]>([]);
  const [gone, setGone] = useState<string[]>([]);
  const [r, setR] = useState<ReleaseData | null>(() => existing ? { ...existing } : album ? { albumId: album.id, title: '', cover: null, releaseDate: siblingDate(lib.releases.filter((x) => x.albumId === album.id), album.defaultReleaseId), trackIds: [...album.trackIds] } : null);
  if (!r || !album) return null;
  const live = r.trackIds.filter((id) => lib.trackById.has(id));
  const lookup = releaseDateQuery(lib, { albumId: album.id, trackIds: live });
  const save = () => {
    if (added.length) { const raw = useStore.getState().rows.albums.get(album.id)?.data as AlbumData | undefined; patch('albums', album.id, { covers: [...new Set([...(raw?.covers ?? []), ...added])] }); }
    const name = r.title.trim();
    if (name && !lib.releaseNames.some((n) => n.name.toLowerCase() === name.toLowerCase())) put('releaseNames', { name }); // a new name joins the reusable list
    put('releases', { ...r, title: name, trackIds: live }, releaseId); onClose();
  };
  return (
    <Modal title={releaseId ? 'Edit release' : `New release of ${album.title}`} onClose={onClose} footer={<>
      {releaseId && <button className="btn text-bad" onClick={() => { if (confirm(`Delete release “${r.title || album.title}”?`)) { remove('releases', releaseId); onClose(); } }}>Delete</button>}
      <div className="ml-auto flex gap-2"><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-accent" onClick={save}>Save</button></div></>}>
      <Field label="Cover" hint="Any image of the album can be used. A new upload joins the album's pool. Lock one to keep it as this release's cover.">
        <CoverPool seed={r.title || album.title} pool={[...album.coverPool.filter((h) => !gone.includes(h)), ...added.filter((h) => !album.coverPool.includes(h))]} locked={r.cover} showing={r.cover ?? album.cover}
          autoLabel="Automatic: this release shows the album's cover."
          onLock={(h) => setR({ ...r, cover: h })} onAdd={(h) => setAdded((x) => [...x, h])}
          onRemove={(h) => {
            if (!confirm('Delete this image from the album for good? Anything using it goes back to the album\'s cover.')) return;
            removeCoverFromAlbum(album.id, h); setGone((x) => [...x, h]); setAdded((x) => x.filter((y) => y !== h));
            if (r.cover === h) setR({ ...r, cover: null });
          }} /></Field>
      <Field label="Release name" hint="Pick a name you have used before or type a new one. Leave it blank to call the release after the album.">
        <Select value={r.title} onChange={(v) => setR({ ...r, title: v })} searchable placeholder={`Same as the album (${album.title})`}
          options={[{ value: '', label: `Same as the album (${album.title})` }, ...[...lib.releaseNames].sort((a, b) => a.name.localeCompare(b.name)).map((n) => ({ value: n.name, label: n.name }))]}
          creatable={{ label: (n) => `Create name: “${n}”`, create: (n) => n }} /></Field>
      <Field label="Release date"><input type="date" className="input" value={r.releaseDate ?? ''} onChange={(e) => setR({ ...r, releaseDate: e.target.value || null })} />
        <DateLookup title={lookup.album} artist={lookup.artist} onFound={(d) => setR({ ...r, releaseDate: d })} /></Field>
      <div className="space-y-1"><div className="text-sm text-muted">Tracklist ({live.length})</div>
        {live.map((id, i) => (
          <div key={id} className="flex items-center gap-2 rounded-theme bg-raised px-3 py-1.5 text-sm"><span className="w-5 text-right text-xs text-muted">{i + 1}</span><span className="min-w-0 flex-1 truncate">{lib.trackById.get(id)!.title}</span>
            <button type="button" className="px-1 text-muted hover:text-fg disabled:opacity-30" aria-label="Move up" disabled={i === 0} onClick={() => setR({ ...r, trackIds: moveTrack(live, i, i - 1) })}>↑</button>
            <button type="button" className="px-1 text-muted hover:text-fg disabled:opacity-30" aria-label="Move down" disabled={i === live.length - 1} onClick={() => setR({ ...r, trackIds: moveTrack(live, i, i + 1) })}>↓</button>
            <button type="button" className="px-1 text-muted hover:text-bad" aria-label="Remove from release" onClick={() => setR({ ...r, trackIds: removeTrack(live, id) })}>×</button></div>))}
        <TrackPicker value={null} onChange={(id) => id && setR({ ...r, trackIds: appendTrack(live, id) })} /></div>
      {releaseId && <button className="btn" onClick={() => { patch('albums', album.id, { defaultReleaseId: releaseId, trackOrder: live }); onClose(); }}>Use this tracklist and edition as the album's default</button>}
      {releaseId && <MergeReleaseInto releaseId={releaseId} onDone={onClose} />}
    </Modal>
  );
}

/** Create or edit an era: a collection of albums, singles and playlists. Things can be in several eras at once. */
function EraDialog({ eraId, onClose }: { eraId?: string; onClose: () => void }) {
  const lib = useLibrary();
  const { put, remove, patch } = useStore();
  const nav = useNavigate();
  const existing = eraId ? lib.eraById.get(eraId) : undefined;
  const [e, setE] = useState<EraData>(() => (existing ? { name: existing.name, description: existing.description, cover: existing.cover } : { name: '', description: '', cover: null }));
  const [albumIds, setAlbumIds] = useState<string[]>(existing?.albumIds ?? []);
  const [trackIds, setTrackIds] = useState<string[]>(existing?.trackIds ?? []);
  const [playlistIds, setPlaylistIds] = useState<string[]>(existing?.playlistIds ?? []);
  if (eraId && !existing) return null;
  const rawEra = (table: 'albums' | 'tracks', id: string) => (useStore.getState().rows[table].get(id)?.data as { eraId?: string | null } | undefined)?.eraId;
  /** a list of chips with a search to add more */
  const list = <T extends { id: string }>(label: string, ids: string[], setIds: (v: string[]) => void, all: T[], name: (x: T) => string) => (
    <Field label={label}>
      <div className="space-y-2">
        {ids.length > 0 && <div className="flex flex-wrap gap-1.5">{ids.map((id) => (
          <span key={id} className="chip gap-1 !text-fg">{(all.find((x) => x.id === id) && name(all.find((x) => x.id === id)!)) ?? '(deleted)'}<button type="button" aria-label="Take it out" onClick={() => setIds(ids.filter((x) => x !== id))}><X size={12} /></button></span>))}</div>}
        <Select value="" placeholder={`Add…`} searchable onChange={(id) => id && !ids.includes(id) && setIds([...ids, id])}
          options={all.filter((x) => !ids.includes(x.id)).map((x) => ({ value: x.id, label: name(x) })).sort((p, q) => p.label.localeCompare(q.label))} />
      </div>
    </Field>);
  const save = () => {
    const id = put('eras', { ...e, name: e.name.trim(), description: e.description?.trim() || null, albumIds, trackIds, playlistIds }, eraId);
    // an old single-era field would keep a removed item in the era: clear it
    if (existing) {
      for (const a of existing.albumIds.filter((x) => !albumIds.includes(x))) if (rawEra('albums', a) === existing.id) patch('albums', a, { eraId: null });
      for (const t of existing.trackIds.filter((x) => !trackIds.includes(x))) if (rawEra('tracks', t) === existing.id) patch('tracks', t, { eraId: null });
    }
    onClose(); if (!eraId) nav(`/eras/${id}`);
  };
  return (
    <Modal title={eraId ? 'Edit era' : 'New era'} onClose={onClose} footer={<>
      {eraId && <button className="btn text-bad" onClick={() => { if (confirm(`Delete the era “${e.name}”? Everything in it stays in your library.`)) { remove('eras', eraId); onClose(); leaveRemoved(nav, 'era', eraId, { fallback: '/eras' }); } }}>Delete</button>}
      <div className="ml-auto flex gap-2"><button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-accent" disabled={!e.name.trim()} onClick={save}>Save</button></div></>}>
      <ImagePicker hash={e.cover} onChange={(h) => setE({ ...e, cover: h })} seed={e.name || 'era'} />
      <Field label="Name" hint="An era is a collection of albums, singles and playlists: a phase of an artist, a feud, a scene. Collections can overlap."><input autoFocus className="input" value={e.name} onChange={(x) => setE({ ...e, name: x.target.value })} /></Field>
      <Field label="Description"><textarea className="input" rows={3} value={e.description ?? ''} onChange={(x) => setE({ ...e, description: x.target.value })} /></Field>
      {list('Albums', albumIds, setAlbumIds, lib.albums, (a) => `${a.title} · ${a.artistName}`)}
      {list('Singles', trackIds, setTrackIds, lib.singles, (t) => `${t.title} · ${t.artistName}`)}
      {list('Playlists', playlistIds, setPlaylistIds, lib.playlists, (p) => p.name)}
      <p className="text-xs text-muted">Notes can be tied to an era from the note’s own editor, or with the + on the era’s page.</p>
    </Modal>
  );
}

/** The editor or dialog for a target. The stats pages draw the same editors in the page (see InlineModals). */
export function EditorFor({ target, close }: { target: EditTarget; close: () => void }) {
  const key = `${target.kind}:${target.id}`;
  if (target.kind === 'track-details') return <TrackDetails key={key} id={target.id} onClose={close} />;
  if (target.kind === 'release') return <ReleaseDialog key={key} releaseId={target.id} onClose={close} />;
  if (target.kind === 'new-release') return <ReleaseDialog key={key} albumId={target.id} onClose={close} />;
  if (target.kind === 'import') return <ImportDialog key={`import-${target.id}`} singleFirst={target.id === 'single'} onClose={close} />;
  if (target.kind === 'import-into-album') return <ImportIntoAlbumDialog key={key} albumId={target.id} initialUrl={target.url} onClose={close} />;
  if (target.kind === 'import-spotify') return <SpotifyImportDialog key="import-spotify" onClose={close} />;
  if (target.kind === 'new-synced-playlist') return <SyncedPlaylistDialog key="new-synced-playlist" onClose={close} />;
  if (target.kind === 'merge-playlist') return <MergePlaylistDialog key={key} spec={target.id} onClose={close} />;
  if (target.kind === 'merge-with') { const [k, ...rest] = target.id.split(':'); return <MergeWithDialog key={key} kind={k as MergeKind} id={rest.join(':')} onClose={close} />; }
  if (target.kind === 'merge-album') return <MergeAlbumDialog key={key} albumId={target.id} onClose={close} />;
  if (target.kind === 'match-links') return <MatchLinksDialog key={`match-links-${target.id}`} albumId={target.id} onClose={close} />;
  if (target.kind === 'note') return <NoteDialog key={key} noteId={target.id} onClose={close} />;
  if (target.kind === 'new-note') return <NoteDialog key={key} initial={target.id} onClose={close} />;
  if (target.kind === 'new-album') return <NewAlbumDialog key="new-album" onClose={close} />;
  if (target.kind === 'new-artist') return <NewArtistDialog key="new-artist" onClose={close} />;
  if (target.kind === 'upload') return <UploadDialog key={key} albumId={target.id} onClose={close} />;
  if (target.kind === 'new-playlist') return <PlaylistDialog key="new-playlist" onClose={close} />;
  if (target.kind === 'playlist') return <PlaylistDialog key={key} playlistId={target.id} onClose={close} />;
  if (target.kind === 'add-to-playlist') return <AddToPlaylistDialog key={key} trackId={target.id} onClose={close} />;
  if (target.kind === 'find-artist-images') return <FindArtistImagesDialog key="find-artist-images" onClose={close} />;
  if (target.kind === 'find-genres') return <FindGenresDialog key="find-genres" onClose={close} />;
  if (target.kind === 'merge-genres') return <MergeGenresDialog key="merge-genres" onClose={close} />;
  if (target.kind === 'find-dates') return <FindDatesDialog key="find-dates" onClose={close} />;
  if (target.kind === 'merge-tracks') return <MergeTracksDialog key={key} ids={target.id.split(',').filter(Boolean)} onClose={close} />;
  if (target.kind === 'add-album-to-playlist') return <AddAlbumToPlaylistDialog key={key} albumId={target.id} onClose={close} />;
  if (target.kind === 'new-track') return <NewTrackDialog key={key} albumId={target.id} onClose={close} />;
  if (target.kind === 'add-to-album') return <AddToAlbumDialog key={key} trackId={target.id} onClose={close} />;
  if (target.kind === 'new-era') return <EraDialog key="new-era" onClose={close} />;
  if (target.kind === 'era') return <EraDialog key={key} eraId={target.id} onClose={close} />;
  if (target.kind === 'track') return <TrackEditor key={key} id={target.id} onClose={close} />;
  if (target.kind === 'album') return <AlbumEditor key={key} id={target.id} onClose={close} />;
  return <ArtistEditor key={key} id={target.id} onClose={close} />;
}

export function EditorHost() {
  const { target, close } = useEditor();
  return target ? <EditorFor target={target} close={close} /> : null;
}
