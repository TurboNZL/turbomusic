import { CandidateArt } from './CandidateArt.tsx';
import { cleanAlbumTitle, cleanArtistName, genresFor, matchArtist, splitFeaturing } from '../lib/autofill.ts';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, ImagePlus, Loader2 } from 'lucide-react';
import type { ArtistData } from '@turbomusic/core';
import { leadCredit, newAlbumData, newTrackData } from '../lib/defaults.ts';
import { fetchCoverFromLinks } from '../lib/cover.ts';
import type { ImportPreview, MatchCandidate } from '../lib/api.ts';
import { useLibrary } from '../lib/derive.ts';
import { logJournal } from '../lib/journal.ts';
import { api, useStore } from '../lib/store.ts';
import { saveImage } from '../lib/files.ts';
import { Cover } from './Cover.tsx';
import { Field, Modal, TagInput } from './forms.tsx';
import { Select } from './Select.tsx';
import { FEATURED_ROLE } from '../lib/defaults.ts';

const NEW = '__new__';
interface Row { id: string; title: string; url: string; on: boolean; /** featured artists named in the title: they become credits, not part of the title */ feat: string[] }

/** Import an album from a YouTube / YouTube Music link: look up, review and edit, then create it and queue the audio. */
export function ImportDialog({ onClose, singleFirst = false }: { onClose: () => void; /** opened from the Singles page: start in "as a single" */ singleFirst?: boolean }) {
  const lib = useLibrary();
  const { put, syncNow } = useStore();
  const configured = useStore((s) => !!s.settings.token);
  const nav = useNavigate();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pv, setPv] = useState<ImportPreview | null>(null);
  const [title, setTitle] = useState('');
  const [artistId, setArtistId] = useState('');
  const [newArtist, setNewArtist] = useState<string | null>(null);
  const [genres, setGenres] = useState<string[]>([]);
  const [useCover, setUseCover] = useState(true);
  /** a picture chosen from this device; it replaces whatever the link offers */
  const [ownCover, setOwnCover] = useState<string | null>(null);
  const [thumbBroken, setThumbBroken] = useState(false);
  /** the picture the album will really get: fetched as soon as the link is read, so the preview shows exactly that one (the first candidate link is not always the one that downloads, and video frames are trimmed) */
  const [linkCover, setLinkCover] = useState<{ state: 'loading' | 'ok' | 'failed'; hash?: string; error?: string }>({ state: 'loading' });
  const picker = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [download, setDownload] = useState(true);
  /** import each chosen track as a single (no album) with its own cover and release date, instead of making an album */
  const [asSingle, setAsSingle] = useState(singleFirst);
  /** set after an import whose cover could not be fetched, so the user hears about it before the dialog closes */
  const [done, setDone] = useState<{ to: string; what: string; coverError: string } | null>(null);

  /** a link goes straight to the preview; anything else is searched on YouTube Music (albums) and the results are listed to pick from */
  const isLink = (v: string) => /^https?:\/\/\S+$/i.test(v.trim());
  const [hits, setHits] = useState<MatchCandidate[] | null>(null);
  async function search() {
    setBusy('Searching YouTube Music…'); setError(null); setHits(null);
    try {
      const { results } = await api().matchAlbums([{ id: 'search', title: url.trim(), artist: '', trackCount: 0 }]);
      if (results[0]?.error) setError(results[0].error);
      setHits(results[0]?.candidates ?? []);
    } catch (e) { setError((e as Error).message === 'Failed to fetch' ? 'Cannot reach the server.' : (e as Error).message); }
    finally { setBusy(null); }
  }
  const go = () => (isLink(url) ? void lookUp() : void search());
  async function lookUp(link = url) {
    setBusy('Looking it up…'); setError(null); setHits(null);
    try {
      const p = await api().importPreview(link.trim());
      setPv(p); setThumbBroken(false);
      const links = p.thumbnails?.length ? p.thumbnails : p.thumbnail ? [p.thumbnail] : [];
      if (links.length) {
        setLinkCover({ state: 'loading' });
        fetchCoverFromLinks(links).then((hash) => setLinkCover({ state: 'ok', hash }), (e: Error) => setLinkCover({ state: 'failed', error: e.message }));
      } else setLinkCover({ state: 'failed', error: 'YouTube gave no cover image for this link.' });
      setTitle(cleanAlbumTitle(p.title)); setAsSingle(p.entries.length === 1); setRows(p.entries.map((e) => { const sp = splitFeaturing(e.title); return { id: e.id, title: sp.title, url: e.url, on: true, feat: sp.featured }; }));
      const hit = matchArtist(lib.artists, p.artist);
      setArtistId(hit?.id ?? ''); setNewArtist(hit ? null : cleanArtistName(p.artist));
      setGenres(hit ? genresFor(lib, hit.id) : []); // a known artist: start from the genres of their other albums
    } catch (e) { setError((e as Error).message === 'Failed to fetch' ? 'Cannot reach the server.' : (e as Error).message); }
    finally { setBusy(null); }
  }

  async function doImport() {
    if (!pv) return;
    setBusy('Importing…'); setError(null);
    try {
      const picked = rows.filter((r) => r.on && r.title.trim());
      let aid = artistId;
      if (!aid) aid = put('artists', { name: (newArtist ?? pv.artist).trim(), image: null } satisfies ArtistData);
      let cover: string | null = ownCover, coverError = '';
      if (!ownCover && useCover) {
        const links = pv.thumbnails?.length ? pv.thumbnails : pv.thumbnail ? [pv.thumbnail] : [];
        if (linkCover.state === 'ok' && linkCover.hash) cover = linkCover.hash; // the one the preview showed
        else if (!links.length) coverError = 'YouTube gave no cover image for this link.';
        else { try { cover = await fetchCoverFromLinks(links); } catch (e) { coverError = (e as Error).message; } }
      }
      const known = new Set(lib.genres.map((g) => g.name.toLowerCase()));
      for (const g of genres) if (!known.has(g.toLowerCase())) put('genres', { name: g });
      const credits = leadCredit(aid);
      // featured artists named in a title become "Featured artist" credits (matched to an artist you have, else created once)
      const artistByName = new Map<string, string>();
      const featCredits = (names: string[]) => names.map((n) => {
        const key = n.toLowerCase();
        let id = artistByName.get(key) ?? matchArtist(lib.artists, n)?.id;
        if (!id) id = put('artists', { name: n, image: null } satisfies ArtistData);
        artistByName.set(key, id);
        return { artistId: id, role: [FEATURED_ROLE] };
      });
      // the release date: the one the link gave, else the first exact answer of the date lookup (Spotify, iTunes, MusicBrainz); empty if neither knows
      let releaseDate: string | null = pv.releaseDate ?? null;
      if (!releaseDate) {
        const who = lib.artistById.get(aid)?.name ?? (newArtist ?? pv.artist).trim();
        const what = asSingle ? picked[0]?.title.trim() : title.trim();
        if (who && what) { try { releaseDate = (await api().releaseDates([{ id: 'import', album: what, artist: who }])).results[0]?.answer?.date ?? null; } catch { /* the date stays empty; Library health can find it later */ } }
      }
      let ids: string[], to: string, what: string;
      if (asSingle) {
        // a single: no album, its own cover and release date, its own genres
        ids = picked.map((r) => put('tracks', newTrackData({ title: r.title.trim(), credits: [...credits, ...featCredits(r.feat)], genres, cover, releaseDate, youtubeMusicUrl: r.url, syncWithAlbumCredits: false })));
        to = '/singles'; what = ids.length === 1 ? 'The single' : 'The singles';
        logJournal('add', `Imported ${ids.length === 1 ? 'single' : 'singles'}: ${picked.map((r) => r.title.trim()).join(', ')}`, 'from YouTube', ids[0]);
      } else {
        const albumId = put('albums', newAlbumData({ title: title.trim(), credits, genres, cover: null, covers: cover ? [cover] : [], coverPicked: false }));
        ids = picked.map((r, i) => put('tracks', newTrackData({ title: r.title.trim(), credits: [...credits, ...featCredits(r.feat)], youtubeMusicUrl: r.url, albums: [{ albumId, order: i }] })));
        // the imported edition is the album's default release: it carries the cover and the tracklist
        const releaseId = put('releases', { albumId, title: '', cover, releaseDate, trackIds: ids });
        useStore.getState().patch('albums', albumId, { trackOrder: ids, defaultReleaseId: releaseId });
        logJournal('add', `Imported album: ${title.trim()}`, `${ids.length} tracks from YouTube`, albumId);
        to = `/albums/${albumId}`; what = 'The album';
      }
      if (download) { await syncNow(); await api().acquire(ids).catch(() => undefined); }
      if (coverError) { setDone({ to, what, coverError }); setBusy(null); return; }
      onClose(); nav(to);
    } catch (e) { setError((e as Error).message); setBusy(null); }
  }

  const count = rows.filter((r) => r.on).length;
  const footer = done
    ? <div className="ml-auto flex gap-2"><button className="btn btn-accent" onClick={() => { onClose(); nav(done.to); }}>{done.to === '/singles' ? 'Open singles' : 'Open the album'}</button></div>
    : pv
    ? <div className="ml-auto flex gap-2"><button className="btn btn-ghost" onClick={() => setPv(null)} disabled={!!busy}>Back</button>
        <button className="btn btn-accent" disabled={!!busy || !count || (!asSingle && !title.trim()) || (!artistId && !(newArtist ?? '').trim())} onClick={doImport}>{busy ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}{asSingle ? (count === 1 ? 'Import the single' : `Import ${count} singles`) : `Import ${count} tracks`}</button></div>
    : <div className="ml-auto flex gap-2"><button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-accent" disabled={!url.trim() || !!busy || !configured} onClick={go}>{busy ? <Loader2 size={15} className="animate-spin" /> : null}{isLink(url) || !url.trim() ? 'Look up' : 'Search'}</button></div>;

  return (
    <Modal title="Add from YouTube Music" onClose={onClose} footer={footer}>
      {!configured && <div className="rounded-theme bg-warn/15 p-3 text-sm text-warn">Importing runs on your server. Connect one in Settings first.</div>}
      {done ? null : !pv ? (
        <>
        <Field label="Search YouTube Music, or paste a link" hint="Paste a YouTube Music album or playlist link (or one video for a single), or type an album's name (and artist) to search YouTube Music. Nothing is downloaded until you confirm.">
          <input autoFocus className="input" placeholder="Search: artist album   ·   or paste a link" value={url} onChange={(e) => { setUrl(e.target.value); setHits(null); }} onKeyDown={(e) => e.key === 'Enter' && url.trim() && !busy && go()} /></Field>
        {hits && !hits.length && !error && <div className="rounded-theme bg-warn/15 p-3 text-sm text-warn">No album found. Try the artist and the album name, or paste a link.</div>}
        {hits && hits.length > 0 && <div className="space-y-1.5" aria-label="Search results">{hits.map((c) => (
          <button key={c.url} type="button" className="flex w-full items-center gap-3 rounded-theme border border-line p-2 text-left hover:border-accent" onClick={() => { setUrl(c.url); void lookUp(c.url); }}>
            {c.thumbnail || c.coverHash ? <CandidateArt c={c} className="h-12 w-12 shrink-0 rounded-theme bg-raised object-cover" /> : <div className="h-12 w-12 shrink-0 rounded-theme bg-raised" />}
            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{c.title}{c.edition ? ` · ${c.edition}` : ''}</span><span className="block truncate text-xs text-muted">{c.owner ?? c.channel}{c.count ? ` · ${c.count} tracks` : ''}</span></span>
            <span className="text-xs text-muted">{Math.round(c.score * 100)}%</span></button>))}</div>}
        </>
      ) : (<>
        <div className="flex gap-4">
          {ownCover ? <Cover hash={ownCover} seed={title} className="h-24 w-24 shrink-0" />
            : linkCover.state === 'ok' && !done ? <Cover hash={linkCover.hash ?? null} seed={title} className={`h-24 w-24 shrink-0 ${useCover ? '' : 'opacity-30'}`} />
            : linkCover.state === 'loading' && pv.thumbnail && !done ? <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-theme bg-raised"><Loader2 size={18} className="animate-spin text-muted" /></div>
            : pv.thumbnail && !done && !thumbBroken ? <img src={pv.thumbnails?.[0] ?? pv.thumbnail} alt="" onError={() => setThumbBroken(true)} className={`h-24 w-24 shrink-0 rounded-theme object-cover ${useCover ? '' : 'opacity-30'}`} />
            : <Cover hash={null} seed={title} className="h-24 w-24 shrink-0" />}
          <div className="min-w-0 flex-1 space-y-2">
            <div role="radiogroup" aria-label="Import as" className="flex gap-1.5">
              {([['Album', false], ['Single', true]] as const).map(([label, v]) => (
                <button key={label} type="button" role="radio" aria-checked={asSingle === v} onClick={() => setAsSingle(v)}
                  className={`rounded-full border px-3 py-0.5 text-sm font-medium ${asSingle === v ? 'border-accent/60 bg-accent/15 text-accent' : 'border-line text-muted hover:text-fg'}`}>{label === 'Album' ? 'As an album' : 'As a single'}</button>))}
            </div>
            {!asSingle && <Field label="Album title"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>}
            {asSingle && <p className="text-xs text-muted">Each chosen track becomes a single of its own with this cover{pv.releaseDate ? ` and the release date ${pv.releaseDate}` : ''}.</p>}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              {!ownCover && pv.thumbnail && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={useCover} onChange={(e) => setUseCover(e.target.checked)} />Use the cover from the link</label>}
              <button type="button" className="btn !py-1 text-sm" onClick={() => picker.current?.click()}><ImagePlus size={14} />{ownCover ? 'Choose another' : 'Upload a cover'}</button>
              {ownCover && <button type="button" className="btn btn-ghost !py-1 text-sm" onClick={() => setOwnCover(null)}>Use the link’s cover</button>}
              <input ref={picker} type="file" accept="image/*" hidden onChange={async (e) => {
                const f = e.target.files?.[0]; e.target.value = '';
                if (!f) return;
                try { setOwnCover(await saveImage(f)); setError(null); } catch { setError('Could not read that image.'); }
              }} />
            </div></div>
        </div>
        <Field label="Lead artist (becomes the first credit)" hint={!artistId && newArtist ? `Nothing in your library matches, so “${newArtist}” will be created. Search to pick a different artist instead.` : asSingle ? 'Added as a “Lead artist” credit on the single.' : 'Added as a “Lead artist” credit on the album and every track.'}>
          <Select value={artistId || (newArtist ? NEW : '')} placeholder="Search artists…" searchable
            onChange={(v) => { if (v === NEW) { setArtistId(''); return; } setArtistId(v); setNewArtist(null); }}
            options={[...(newArtist ? [{ value: NEW, label: `Create artist: “${newArtist}”` }] : []),
              ...[...lib.artists].sort((x, y) => x.name.localeCompare(y.name)).map((x) => ({ value: x.id, label: x.name, hint: x.aliases?.length ? `aka ${x.aliases.slice(0, 2).join(', ')}` : undefined }))]}
            creatable={{ label: (n) => `Create artist: “${n}”`, create: (n) => put('artists', { name: n, image: null } satisfies ArtistData) }} />
        </Field>
        <Field label="Genres"><TagInput value={genres} onChange={setGenres} suggestions={lib.genres.map((g) => g.name)} /></Field>
        <div className="space-y-1"><div className="text-sm text-muted">Tracks ({count} of {rows.length})</div>
          {rows.map((r, i) => (
            <div key={r.id} className="flex items-center gap-2"><input type="checkbox" aria-label={`Include track ${i + 1}`} checked={r.on} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)))} />
              <span className="w-6 text-right text-xs text-muted">{i + 1}</span>
              <input className="input !py-1" value={r.title} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
              <input className="input !w-40 shrink-0 !py-1 max-sm:!w-28" aria-label={`Featured artists on track ${i + 1}`} placeholder="Featured…" title="Featured artists (comma separated): added as credits, not kept in the title" value={r.feat.join(', ')}
                onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, feat: e.target.value.split(',').map((n) => n.trim()).filter(Boolean) } : x)))} /></div>))}</div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={download} onChange={(e) => setDownload(e.target.checked)} />Download the audio now (needs yt-dlp and ffmpeg on the server)</label>
      </>)}
      {done && <div role="alert" className="rounded-theme bg-warn/15 p-3 text-sm text-warn">{done.what} was imported, but its cover could not be fetched: {done.coverError} Add one from its Edit button, or use Library health → “Try YouTube thumbnails”.</div>}
      {busy && <div className="text-sm text-muted">{busy}</div>}
      {error && <div className="rounded-theme bg-bad/15 p-3 text-sm text-bad">{error}</div>}
    </Modal>
  );
}
