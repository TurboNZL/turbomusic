import { withLink } from '../lib/spotifyLinks.ts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileUp, Link2, ListMusic, Loader2, User } from 'lucide-react';
import type { ArtistData } from '@turbomusic/core';
import { leadCredit, newAlbumData, newTrackData } from '../lib/defaults.ts';
import type { SpotifyImportTrack, SpotifyList } from '../lib/api.ts';
import { useLibraryLive } from '../lib/derive.ts';
import { logJournal } from '../lib/journal.ts';
import { api, useStore } from '../lib/store.ts';
import { createFromPlan } from '../lib/spotifyCreate.ts';
import { parseAccountData, parseTextList, planImport, type ImportPlan } from '../lib/spotifyImport.ts';
import { readZip } from '../lib/zipRead.ts';
import { cn } from '../lib/cn.ts';
import { Field, Modal } from './forms.tsx';
import { SpotifyAccountPanel } from './SpotifyAccountPanel.tsx';

type Source = 'link' | 'account' | 'file' | 'text';
const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * Import Spotify playlists. Four ways in, because Spotify keeps closing doors: a public playlist link, your own account (sign-in), the
 * "Account data" file from Spotify's privacy page, or a typed list. Whatever the way, the result is the same review screen: the playlist,
 * and an album for each new track that you complete later with a YouTube album link (Library health).
 */
function PlaylistPicker({ onPick, busy }: { onPick: (id: string) => void; busy: boolean }) {
  const [mine, setMine] = useState<{ id: string; name: string; tracks: number | null; owner: string; mine: boolean }[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api().spotifyPlaylists().then((r) => setMine(r.playlists)).catch((e: Error) => setErr(e.message)); }, []);
  return (
    <div className="space-y-1">
      <div className="max-h-72 space-y-1 overflow-y-auto">{mine?.map((p) => <button key={p.id} className="flex w-full items-center gap-2 rounded-theme px-2 py-1.5 text-left hover:bg-raised" disabled={busy} onClick={() => onPick(p.id)}>
        <ListMusic size={14} className="shrink-0 text-muted" /><span className="min-w-0 flex-1 truncate">{p.name}</span><span className="text-xs text-muted">{p.tracks ?? '?'} tracks{!p.mine ? ` · ${p.owner}` : ''}</span></button>)}
        {mine && !mine.length && <div className="text-muted">No playlists found.</div>}{!mine && !err && <div className="text-muted">Loading…</div>}</div>
      {err && <div className="text-bad">{err}</div>}
      <p className="text-xs text-muted">Spotify only lets this app read playlists you own or collaborate on; others fail with a clear message (use the link tab for those).</p>
    </div>
  );
}

export function SpotifyImportDialog({ onClose }: { onClose: () => void }) {
  const lib = useLibraryLive();
  const { put, patch } = useStore();
  const configured = useStore((s) => !!s.settings.token);
  const nav = useNavigate();
  const [source, setSource] = useState<Source>('link');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [list, setList] = useState<SpotifyList | null>(null);
  const [choices, setChoices] = useState<SpotifyList[] | null>(null);
  const [name, setName] = useState('');
  const [makePlaylist, setMakePlaylist] = useState(true);
  const [makeAlbums, setMakeAlbums] = useState(true);
  const [covers, setCovers] = useState(false);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<{ playlistId: string | null; albums: number; tracks: number; reused: number; coverFails: number } | null>(null);

  // ---- sources ----
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const guard = async (what: string, f: () => Promise<void>) => {
    setBusy(what); setError(null);
    try { await f(); } catch (e) { setError((e as Error).message === 'Failed to fetch' ? 'Cannot reach the server.' : (e as Error).message); } finally { setBusy(null); }
  };
  const open = (l: SpotifyList) => { setList(l); setName(l.name); setSkipped(new Set()); setChoices(null); };


  async function readFiles(files: FileList | null) {
    if (!files?.length) return;
    await guard('Reading…', async () => {
      const lists: SpotifyList[] = [];
      for (const f of [...files]) {
        if (/\.zip$/i.test(f.name)) { for (const e of await readZip(await f.arrayBuffer(), (n) => /(Playlist\d*|YourLibrary)\.json$/i.test(n))) lists.push(...parseAccountData(JSON.parse(await e.text()))); }
        else lists.push(...parseAccountData(JSON.parse(await f.text())));
      }
      if (!lists.length) throw new Error('No playlists found in those files. Use Playlist1.json (or YourLibrary.json) from the "Account data" download, or the zip itself.');
      if (lists.length === 1) open(lists[0]); else setChoices(lists);
    });
    if (fileInput.current) fileInput.current.value = '';
  }

  const plan: ImportPlan | null = useMemo(() => (list ? planImport(lib, { ...list, name }) : null), [lib, list, name]);

  async function run() {
    if (!plan || !list) return;
    setBusy('Importing…'); setError(null);
    try {
      let coverFails = 0;
      const { trackIdOf, albumsMade, tracksMade, newAlbumIds } = createFromPlan(lib, plan, { put, patch }, { makeAlbums, skipped });
      let playlistId: string | null = null;
      if (makePlaylist) {
        const ids = plan.tracks.map((t) => trackIdOf.get(t.src.uri)).filter((x): x is string => !!x);
        playlistId = put('playlists', { name: name.trim() || list.name, description: list.description, cover: null, createdAt: Date.now(), trackIds: ids });
      }
      logJournal('add', `Imported from Spotify: ${name.trim() || list.name}`, `${tracksMade} new tracks, ${albumsMade} albums, ${plan.reused} already in the library`);
      // covers last: they need the network and one slow link must not lose the import
      if (covers && configured) {
        for (const [i, a] of newAlbumIds.entries()) {
          if (!a.coverFrom || a.coverFrom.startsWith('text:')) continue;
          setBusy(`Fetching covers… ${i + 1}/${newAlbumIds.length}`);
          try {
            const r = await api().spotifyCover(a.coverFrom);
            const raw = useStore.getState().rows.albums.get(a.id)?.data as { covers?: string[] } | undefined;
            patch('albums', a.id, { covers: [...(raw?.covers ?? []), r.hash] });
            if (a.releaseId) patch('releases', a.releaseId, { cover: r.hash });
          } catch { coverFails++; }
        }
      }
      setResult({ playlistId, albums: albumsMade, tracks: tracksMade, reused: plan.reused, coverFails });
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  }

  const tabs: { id: Source; label: string; icon: typeof Link2 }[] = [{ id: 'link', label: 'Playlist link', icon: Link2 }, { id: 'account', label: 'My account', icon: User }, { id: 'file', label: 'Account data file', icon: FileUp }, { id: 'text', label: 'Typed list', icon: ListMusic }];
  const newAlbums = plan?.albums.filter((a) => !skipped.has(a.key)) ?? [];
  const footer = result ? <div className="ml-auto flex gap-2">{result.playlistId && <button className="btn" onClick={() => { onClose(); nav(`/playlists/${result.playlistId}`); }}>Open the playlist</button>}<button className="btn btn-accent" onClick={() => { onClose(); nav('/health'); }}>Complete the albums in Health</button></div>
    : list ? <div className="ml-auto flex gap-2"><button className="btn btn-ghost" disabled={!!busy} onClick={() => setList(null)}>Back</button>
      <button className="btn btn-accent" disabled={!!busy || !plan || (!makePlaylist && !makeAlbums)} onClick={() => void run()}>{busy ? <Loader2 size={15} className="animate-spin" /> : null}Import</button></div>
    : <button className="btn ml-auto" onClick={onClose}>Cancel</button>;

  return (
    <Modal title="Import from Spotify" onClose={onClose} wide footer={footer}>
      {result ? (
        <div className="space-y-2 rounded-theme bg-good/10 p-4 text-sm" role="status">
          <div className="font-medium text-good">Imported.</div>
          <div>{result.tracks} new tracks in {result.albums} new albums{result.reused ? `, ${result.reused} tracks you already had were reused` : ''}{result.playlistId ? ', and the playlist' : ''}.</div>
          {result.coverFails > 0 && <div className="text-warn">{result.coverFails} covers could not be fetched.</div>}
          <div className="text-muted">The new albums only hold the songs you picked and have no YouTube link yet. Library health lists them: paste a YouTube Music album link for each and it fills in the rest of the album, the covers and the audio.</div>
        </div>
      ) : !list ? (<>
        {!configured && <div className="rounded-theme bg-warn/15 p-3 text-sm text-warn">Link, account and YouTube lookups run on your server. Connect one in Settings first (reading a file or typing a list works without).</div>}
        <div role="tablist" className="flex flex-wrap gap-1 border-b border-line pb-px">
          {tabs.map((t) => <button key={t.id} role="tab" aria-selected={source === t.id} onClick={() => { setSource(t.id); setError(null); }} className={cn('-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium', source === t.id ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg')}><t.icon size={14} />{t.label}</button>)}
        </div>

        {source === 'link' && <div className="space-y-2">
          <Field label="Spotify playlist link" hint="Any public playlist. Spotify's public page lists the tracks but not their albums, so the albums are made from your Spotify history when it knows them, otherwise from the track titles. For your own playlists, “My account” gives full details."><input autoFocus className="input" placeholder="https://open.spotify.com/playlist/…" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && url.trim() && !busy && configured && void guard('Reading the playlist…', async () => open(await api().spotifyResolve(url.trim())))} /></Field>
          <button className="btn btn-accent" disabled={!url.trim() || !!busy || !configured} onClick={() => void guard('Reading the playlist…', async () => open(await api().spotifyResolve(url.trim())))}>Look up</button>
        </div>}

        {source === 'account' && <SpotifyAccountPanel>{() => <PlaylistPicker busy={!!busy} onPick={(id) => void guard('Reading the playlist…', async () => open(await api().spotifyPlaylist(id)))} />}</SpotifyAccountPanel>}

        {source === 'file' && <div className="space-y-2 text-sm"><p className="text-muted">The most reliable way: on spotify.com/account/privacy request <b>Account data</b> (arrives in a day or so), then choose the .zip, or <code>Playlist1.json</code> / <code>YourLibrary.json</code> from it. No server needed.</p>
          <button className="btn btn-accent" disabled={!!busy} onClick={() => fileInput.current?.click()}><FileUp size={15} />Choose file…</button>
          <input ref={fileInput} type="file" multiple hidden accept=".zip,.json" onChange={(e) => void readFiles(e.target.files)} /></div>}

        {source === 'text' && <div className="space-y-2"><Field label="One song per line: Artist - Title" hint="Lines starting with # are ignored."><textarea className="input font-mono" rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder={'Drake - Get It Together\nSOB X RBE - Paramedic!'} /></Field>
          <button className="btn btn-accent" disabled={!parseTextList(text).length} onClick={() => open({ kind: 'playlist', name: 'My list', description: null, cover: null, owner: null, source: 'file', tracks: parseTextList(text) })}>Continue with {parseTextList(text).length} songs</button></div>}

        {choices && <div className="space-y-1 rounded-theme bg-raised p-2"><div className="px-1 text-xs text-muted">Which playlist?</div>{choices.map((c, i) => <button key={i} className="flex w-full items-center gap-2 rounded-theme px-2 py-1.5 text-left text-sm hover:bg-hover" onClick={() => open(c)}><ListMusic size={14} className="text-muted" /><span className="flex-1 truncate">{c.name}</span><span className="text-xs text-muted">{c.tracks.length} tracks</span></button>)}</div>}
      </>) : (<>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Playlist name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <div className="space-y-1.5 pt-5 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={makePlaylist} onChange={(e) => setMakePlaylist(e.target.checked)} />Create the playlist ({list.tracks.length} tracks)</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={makeAlbums} onChange={(e) => setMakeAlbums(e.target.checked)} />Add tracks I do not have, each in its album</label>
            <label className="flex items-start gap-2" title="One request to Spotify per album: slower, optional"><input type="checkbox" className="mt-0.5" checked={covers} disabled={!configured} onChange={(e) => setCovers(e.target.checked)} />Fetch the album covers from Spotify <span className="text-muted">(a YouTube album link later brings better ones)</span></label>
          </div>
        </div>
        {list.note && <p className="text-xs text-muted">{list.note}</p>}
        <div className="text-sm text-muted"><b className="text-fg">{plan?.reused ?? 0}</b> of {list.tracks.length} tracks are already in your library and are reused, never duplicated. {makeAlbums ? <><b className="text-fg">{newAlbums.reduce((n, a) => n + a.tracks.length, 0)}</b> new tracks in {newAlbums.filter((a) => !a.existingAlbumId).length} new albums{newAlbums.some((a) => a.existingAlbumId) ? ` (and ${newAlbums.filter((a) => a.existingAlbumId).length} you already have)` : ''}.</> : null}</div>
        {makeAlbums && <div className="max-h-72 space-y-0.5 overflow-y-auto rounded-theme border border-line p-1">
          {plan?.albums.map((a) => (
            <label key={a.key} className="flex items-start gap-2 rounded-theme px-2 py-1 text-sm hover:bg-raised/60">
              <input type="checkbox" className="mt-1" checked={!skipped.has(a.key)} onChange={(e) => setSkipped((s) => { const n = new Set(s); if (e.target.checked) n.delete(a.key); else n.add(a.key); return n; })} />
              <span className="min-w-0 flex-1"><span className="block truncate font-medium">{a.title}{a.existingAlbumId && <span className="ml-2 text-xs font-normal text-good">already in your library</span>}</span>
                <span className="block truncate text-xs text-muted">{a.artist} · {a.tracks.map((t) => t.src.title).join(', ')}{a.nameFrom === 'title' ? ' · album unknown: named after the track' : a.nameFrom === 'history' ? ' · album from your Spotify history' : ''}</span></span></label>))}
          {!plan?.albums.length && <div className="p-3 text-sm text-muted">Every track is already in your library.</div>}
        </div>}
      </>)}
      {busy && <div className="text-sm text-muted" role="status">{busy}</div>}
      {error && <div className="flex items-start gap-2 rounded-theme bg-bad/15 p-3 text-sm text-bad"><span className="flex-1">{error}</span></div>}
    </Modal>
  );
}
