import { CandidateArt } from './CandidateArt.tsx';
import { ThemedSelect } from './ThemedSelect.tsx';
import { useEffect, useRef, useState } from 'react';
import { Download, ExternalLink, Loader2, Search } from 'lucide-react';
import { newTrackData, inheritFromAlbum } from '../lib/defaults.ts';
import { fetchCoverFromLinks } from '../lib/cover.ts';
import { mergeAllTracksOrder, matchEntries, type MergeRow } from '../lib/albumMerge.ts';
import type { ImportPreview, MatchCandidate } from '../lib/api.ts';
import { cacheMatches, cachedMatches, forgetMatches } from '../lib/matchCache.ts';
import { useLibrary } from '../lib/derive.ts';
import { logJournal } from '../lib/journal.ts';
import { api, useStore } from '../lib/store.ts';
import { getLibrary } from '../lib/derive.ts';
import { convertToSingleNow } from './entityMenus.tsx';
import { useNavigate } from 'react-router-dom';
import { leaveRemoved } from '../lib/leave.ts';
import { statsPath } from '../lib/entityStats.ts';
import { Field, Modal } from './forms.tsx';
import { Select } from './Select.tsx';
import { foldIntoRelease, siblingDate } from '../lib/releaseOps.ts';

/**
 * Import a YouTube album into an album you already have: a deluxe edition that adds a few songs (and maybe reorders them), or the real
 * tracklist of an album a Spotify import only started. Songs the album already has are recognised and NOT added again; new songs are
 * added to the album; the link becomes a release with its own order, so the original tracklist is untouched.
 */
export function ImportIntoAlbumDialog({ albumId, initialUrl, onClose }: { albumId: string; initialUrl?: string; onClose: () => void }) {
  const lib = useLibrary();
  const { put, patch, syncNow } = useStore();
  const album = lib.albumById.get(albumId);
  const rawAlbum = useStore((s) => s.rows.albums.get(albumId)?.data) as { needsSource?: boolean; covers?: string[] } | undefined;
  const [url, setUrl] = useState(initialUrl ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pv, setPv] = useState<ImportPreview | null>(null);
  const configured = useStore((s) => !!s.settings.token);
  /** YouTube Music search results: the album's own search first (cached), or whatever was typed */
  const [hits, setHits] = useState<MatchCandidate[] | null>(null);
  const [rows, setRows] = useState<MergeRow[]>([]);
  const [releaseTitle, setReleaseTitle] = useState('');
  /** '' = make a new release; otherwise the id of the existing release the imported tracks are folded into */
  const [into, setInto] = useState('');
  const [toSingle, setToSingle] = useState(false);
  const nav = useNavigate();
  const [makeDefault, setMakeDefault] = useState(false);
  const [useCover, setUseCover] = useState(true);
  const [rename, setRename] = useState(false);
  const [download, setDownload] = useState(true);
  const [done, setDone] = useState<string | null>(null);
  const have = (album?.trackIds ?? []).map((id) => lib.trackById.get(id)).filter((t): t is NonNullable<typeof t> => !!t);

  async function lookUp(u = url) {
    setBusy('Looking it up…'); setError(null);
    try {
      const p = await api().importPreview(u.trim());
      setPv(p); setReleaseTitle(''); // the name is left blank (= the album's name) until the user picks or types one
      setRows(matchEntries(have.map((t) => ({ id: t.id, title: t.title, youtubeMusicUrl: t.youtubeMusicUrl })), p.entries.map((e) => ({ id: e.id, title: e.title, url: e.url, duration: e.duration }))));
      setRename(!!rawAlbum?.needsSource && p.title.toLowerCase() !== album?.title.toLowerCase());
      setMakeDefault(!!rawAlbum?.needsSource);
      // the first import to bring a cover into an album with a single release belongs in that release (change it if not)
      const mine = lib.releases.filter((r) => r.albumId === albumId);
      setInto(!album?.coverPool.length && mine.length === 1 ? mine[0].id : '');
      // a one-song album stays one song: offer to turn it into a single afterwards
      setToSingle(have.length === 1 && p.entries.length === 1);
    } catch (e) { setError((e as Error).message === 'Failed to fetch' ? 'Cannot reach the server.' : (e as Error).message); }
    finally { setBusy(null); }
  }
  const isLink = (v: string) => /^https?:\/\/\S+$/i.test(v.trim());
  /** no text = search for this album ("artist album"); text = search for that; a link goes straight to the preview */
  const searching = useRef(false);
  async function search(text = '', fresh = false) {
    if (!album || searching.current) return;
    searching.current = true;
    setError(null);
    if (!text && !fresh) { const hit = cachedMatches(albumId); if (hit) { setHits(hit); searching.current = false; return; } }
    if (!text && fresh) forgetMatches(albumId);
    setBusy('Searching YouTube Music…'); setHits(null);
    try {
      const { results } = await api().matchAlbums([{ id: albumId, title: text || album.title, artist: text ? '' : album.leads[0]?.name ?? album.artistName, trackCount: text ? 0 : album.trackIds.length }]);
      const r = results[0];
      if (r?.error) setError(r.error);
      if (!text && r && !r.error && r.candidates.length) cacheMatches(albumId, r.candidates);
      setHits(r?.candidates ?? []);
    } catch (e) { setError((e as Error).message === 'Failed to fetch' ? 'Cannot reach the server.' : (e as Error).message); }
    finally { setBusy(null); searching.current = false; }
  }
  const go = () => { const v = url.trim(); if (!v) return; if (isLink(v)) void lookUp(v); else void search(v); };
  useEffect(() => { if (initialUrl) void lookUp(initialUrl); else if (configured) void search(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!album) return <Modal title="Import into album" onClose={onClose}><p className="text-sm text-muted">That album no longer exists.</p></Modal>;

  async function run() {
    if (!pv || !album) return;
    setBusy('Importing…'); setError(null);
    try {
      const included = rows.filter((r) => r.include && (r.trackId || r.title.trim()));
      const newIds = new Map<number, string>();
      included.forEach((r, i) => { if (!r.trackId) newIds.set(i, put('tracks', newTrackData({ title: r.title.trim(), credits: album.credits, ...inheritFromAlbum(album, album.credits), youtubeMusicUrl: r.entry.url, albums: [{ albumId: album.id, order: album.trackIds.length + newIds.size }] }))); });
      // the existing songs the link has: give them the link when they have none
      const needDownload: string[] = [...newIds.values()];
      for (const r of included) {
        if (!r.trackId) continue;
        const t = lib.trackById.get(r.trackId);
        if (t && !t.youtubeMusicUrl) patch('tracks', t.id, { youtubeMusicUrl: r.entry.url });
        if (t && !t.file) needDownload.push(t.id);
      }
      const order = included.map((r, i) => r.trackId ?? newIds.get(i)!);
      let cover: string | null = null, coverNote = '';
      if (useCover) {
        const links = pv.thumbnails?.length ? pv.thumbnails : pv.thumbnail ? [pv.thumbnail] : [];
        if (links.length) { try { cover = await fetchCoverFromLinks(links); } catch (e) { coverNote = (e as Error).message; } }
      }
      const name = releaseTitle.trim();
      if (!into && name && !lib.releaseNames.some((n) => n.name.toLowerCase() === name.toLowerCase())) put('releaseNames', { name });
      const target = into ? lib.releases.find((r) => r.id === into && r.albumId === album.id) : undefined;
      const dates = lib.releases.filter((r) => r.albumId === album.id);
      let releaseId: string;
      if (target) {
        // folded into an existing release: it keeps its name and date, gains the tracks it lacked (in the edition's order) and a cover if it had none
        releaseId = target.id;
        patch('releases', target.id, { trackIds: foldIntoRelease(target.trackIds, included.map((r, i) => ({ trackId: r.trackId, newId: newIds.get(i) }))), ...(!target.cover && cover ? { cover } : {}), ...(!target.releaseDate ? { releaseDate: siblingDate(dates, album.defaultReleaseId, target.id) ?? pv.releaseDate ?? null } : {}) });
      } else {
        // a new release starts with the date the album's other releases have (a Spotify import brings the real one)
        releaseId = put('releases', { albumId: album.id, title: name, cover, releaseDate: siblingDate(dates, album.defaultReleaseId) ?? pv.releaseDate ?? null, trackIds: order });
      }
      const albumPatch: Record<string, unknown> = {
        trackOrder: mergeAllTracksOrder(album.trackIds, included.map((r, i) => ({ trackId: r.trackId, newId: newIds.get(i), include: true }))),
        ...(cover ? { covers: [...(rawAlbum?.covers ?? []), cover] } : {}),
        ...(makeDefault ? { defaultReleaseId: releaseId } : {}),
        ...(rawAlbum?.needsSource ? { needsSource: false } : {}),
        ...(rename && pv.title.trim() ? { title: pv.title.trim() } : {}),
      };
      patch('albums', album.id, albumPatch);
      logJournal('add', `Imported a release into ${album.title}`, `${target ? `into “${target.title}”` : name || album.title}: ${newIds.size} new tracks, ${included.length - newIds.size} already in the album`, album.id);
      let single: string | null = null;
      if (toSingle && canConvert) {
        // the album now holds the one song in every release: make it a single (read the library again, it has changed)
        const fresh = getLibrary(), a = fresh.albumById.get(album.id);
        single = a ? convertToSingleNow(fresh, a) : null;
      }
      if (download && needDownload.length) { await syncNow(); await api().acquire(needDownload).catch(() => undefined); }
      if (single && !coverNote) { onClose(); leaveRemoved(nav, 'album', album.id, { to: statsPath('track', single), fallback: '/singles' }); return; }
      if (coverNote) { setDone(`Imported, but the cover could not be fetched: ${coverNote}`); setBusy(null); return; }
      onClose();
    } catch (e) { setError((e as Error).message); setBusy(null); }
  }

  const included = rows.filter((r) => r.include);
  const fresh = included.filter((r) => !r.trackId).length;
  // after this import the album holds only the one song it had: it can become a single
  const canConvert = have.length === 1 && included.length === 1 && fresh === 0;
  const taken = new Set(rows.filter((r) => r.trackId).map((r) => r.trackId));
  const footer = done ? <button className="btn btn-accent ml-auto" onClick={onClose}>Close</button>
    : pv ? <div className="ml-auto flex gap-2"><button className="btn btn-ghost" onClick={() => setPv(null)} disabled={!!busy}>Back</button>
      <button className="btn btn-accent" disabled={!!busy || !included.length} onClick={() => void run()}>{busy ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}Import {included.length} tracks ({fresh} new)</button></div>
    : <div className="ml-auto flex gap-2"><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-accent" disabled={!url.trim() || !!busy} onClick={go}>{busy ? <Loader2 size={15} className="animate-spin" /> : null}{isLink(url) || !url.trim() ? 'Look up' : 'Search'}</button></div>;

  return (
    <Modal title={`Import a release into “${album.title}” from YouTube Music`} onClose={onClose} wide footer={footer}>
      {done ? <div role="alert" className="rounded-theme bg-warn/15 p-3 text-sm text-warn">{done}</div> : !pv ? (
        <div className="space-y-3">
          <Field label="Search YouTube Music, or paste a link" hint="Songs the album already has are recognised and not added again. The link becomes a release with its own track order. Searching starts with this album's own name.">
            <div className="flex gap-2"><input autoFocus className="input" placeholder={`${album.leads[0]?.name ?? album.artistName} ${album.title}  ·  or  https://music.youtube.com/playlist?list=…`} value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !busy && go()} />
              <button className="btn shrink-0" disabled={!!busy || !configured} title="Search again for this album" onClick={() => { setUrl(''); void search('', true); }}><Search size={15} />Search again</button></div></Field>
          {!configured && <div className="rounded-theme bg-warn/15 p-3 text-sm text-warn">Searching runs on your server (it needs yt-dlp). Connect one in Settings, or paste a link.</div>}
          {busy && <div className="flex items-center gap-2 text-sm text-muted"><Loader2 size={15} className="animate-spin" />{busy}</div>}
          {hits && !hits.length && <div className="rounded-theme bg-warn/15 p-3 text-sm text-warn">No album found. Try other words, or paste its link.</div>}
          {hits && hits.length > 0 && <div className="space-y-1.5" aria-label="Search results">{hits.map((x) => (
            <div key={x.url} className="card flex items-center gap-2 px-3 py-2 text-sm">
              <button className="flex min-w-0 flex-1 items-center gap-3 text-left" disabled={!!busy} onClick={() => void lookUp(x.url)}>
                {x.thumbnail || x.coverHash ? <CandidateArt c={x} className="h-12 w-12 shrink-0 rounded-theme bg-raised object-cover" /> : <span className="h-12 w-12 shrink-0 rounded-theme bg-raised" aria-hidden />}
                <span className="min-w-0 flex-1"><span className="block truncate font-medium">{x.title || 'Album'}{x.edition && <span className="chip ml-2 !text-[10px]">{x.edition}</span>}</span>
                  <span className="block truncate text-xs text-muted">{[x.owner, x.channel && x.channel !== x.owner ? x.channel : '', x.count ? `${x.count} tracks` : ''].filter(Boolean).join(' · ')} · {Math.round(Math.min(1, x.score) * 100)}% match</span></span>
                <span className="btn btn-accent !py-1 text-xs">Import…</span>
              </button>
              <a className="p-1 text-muted hover:text-fg" href={x.url} target="_blank" rel="noreferrer" aria-label="Open on YouTube Music"><ExternalLink size={14} /></a>
            </div>))}</div>}
        </div>
      ) : (<>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-3">
            <Field label="Put it in" hint="Merge it into a release you already have (the one a Spotify import made, say) instead of adding a second one."><Select value={into} onChange={setInto}
              options={[{ value: '', label: 'A new release' }, ...lib.releases.filter((r) => r.albumId === album.id).map((r) => ({ value: r.id, label: `Merge into: ${r.title}${r.releaseDate ? ` · ${r.releaseDate}` : ''}`, hint: `${r.trackIds.length} tracks` }))]} /></Field>
            {!into && <Field label="Release name" hint="Pick a name you have used or type a new one. Blank = the album's name.">
              <Select value={releaseTitle} onChange={setReleaseTitle} searchable placeholder={`Same as the album (${album.title})`}
                options={[{ value: '', label: `Same as the album (${album.title})` }, ...[...lib.releaseNames].sort((a, b) => a.name.localeCompare(b.name)).map((n) => ({ value: n.name, label: n.name }))]}
                creatable={{ label: (n) => `Create name: “${n}”`, create: (n) => n }} /></Field>}
          </div>
          <div className="space-y-1.5 pt-5 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={makeDefault} onChange={(e) => setMakeDefault(e.target.checked)} />Make this the album's default release</label>
            {pv.thumbnail && <label className="flex items-center gap-2"><input type="checkbox" checked={useCover} onChange={(e) => setUseCover(e.target.checked)} />Add its cover to the album</label>}
            {canConvert && <label className="flex items-center gap-2"><input type="checkbox" checked={toSingle} onChange={(e) => setToSingle(e.target.checked)} />Then turn it into a single <span className="text-muted">(it only has this one song)</span></label>}
            {rawAlbum?.needsSource && pv.title.trim().toLowerCase() !== album.title.trim().toLowerCase() && <label className="flex items-center gap-2"><input type="checkbox" checked={rename} onChange={(e) => setRename(e.target.checked)} />Rename the album to “{pv.title}”</label>}
          </div>
        </div>
        <div className="space-y-1">
          <div className="text-sm text-muted">{included.length} of {rows.length} in this release · <b className="text-fg">{fresh} new</b> to the album · {included.length - fresh} already in it. Untick a song to leave it out completely.</div>
          {rows.map((r, i) => {
            const set = (patchRow: Partial<MergeRow>) => setRows(rows.map((x, j) => (j === i ? { ...x, ...patchRow } : x)));
            const t = r.trackId ? lib.trackById.get(r.trackId) : null;
            return (
              <div key={r.entry.id + i} className="flex flex-wrap items-center gap-2 rounded-theme px-1 py-0.5 hover:bg-raised/50">
                <input type="checkbox" aria-label={`Include track ${i + 1}`} checked={r.include} onChange={(e) => set({ include: e.target.checked })} />
                <span className="w-6 text-right text-xs text-muted">{i + 1}</span>
                <div className="min-w-0 flex-1 basis-48">{t ? <div className="truncate text-sm">{r.entry.title}{t.title !== r.entry.title && <span className="text-muted"> = {t.title}</span>}</div>
                  : <input className="input !py-1" value={r.title} onChange={(e) => set({ title: e.target.value })} aria-label="New track title" />}</div>
                <ThemedSelect className="input !w-auto !py-1 text-xs" value={r.trackId ?? ''} aria-label="Which track of the album this is" onChange={(e) => set({ trackId: e.target.value || null })}>
                  <option value="">New track</option>
                  {have.filter((h) => h.id === r.trackId || !taken.has(h.id)).map((h) => <option key={h.id} value={h.id}>In album: {h.title}</option>)}
                </ThemedSelect>
              </div>);
          })}
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={download} onChange={(e) => setDownload(e.target.checked)} />Download the audio of new tracks (and album tracks that have none) now</label>
      </>)}
      {busy && <div className="text-sm text-muted">{busy}</div>}
      {error && <div className="rounded-theme bg-bad/15 p-3 text-sm text-bad">{error}</div>}
    </Modal>
  );
}
