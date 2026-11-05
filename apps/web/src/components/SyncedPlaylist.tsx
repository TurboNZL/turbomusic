import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ExternalLink, GitMerge, ListMusic, Loader2, RefreshCw, Unlink } from 'lucide-react';
import { useLibraryLive } from '../lib/derive.ts';
import { api, useStore } from '../lib/store.ts';
import { createOnSpotify, linkToSpotify, mergePlaylists, syncPlaylist, unlinkFromSpotify, type SyncResult } from '../lib/playlistSyncRun.ts';
import type { SyncMode } from '../lib/playlistSync.ts';
import { cn, plural } from '../lib/cn.ts';
import { Field, Modal } from './forms.tsx';

const MODES: { id: SyncMode; label: string; hint: string }[] = [
  { id: 'both', label: 'Both ways', hint: 'Additions and removals on either side reach the other.' },
  { id: 'from-spotify', label: 'Spotify → TurboMusic only', hint: 'TurboMusic follows Spotify and never changes it.' },
  { id: 'to-spotify', label: 'TurboMusic → Spotify only', hint: 'Spotify follows TurboMusic.' },
];

/** One line saying what a sync did. */
export function describeSync(r: SyncResult): string {
  if (r.upToDate) return 'Already in step.';
  const parts = [
    r.addedHere ? `${plural(r.addedHere, 'track')} added here` : '', r.removedHere ? `${r.removedHere} removed here` : '',
    r.addedThere ? `${plural(r.addedThere, 'track')} added on Spotify` : '', r.removedThere ? `${r.removedThere} removed on Spotify` : '',
    r.created ? `${plural(r.created, 'new track')} made in ${plural(r.albumsMade, 'new album')} (give them a YouTube album link in Library health to download them)` : '',
  ].filter(Boolean);
  return `${parts.join(', ') || 'Synced'}.${r.unsynced ? ` ${plural(r.unsynced, 'track')} without a Spotify link stay only here.` : ''}`;
}

type MyList = { id: string; name: string; tracks: number | null; owner: string; mine: boolean };

/**
 * "Create synced playlist": tie a playlist here to one on your Spotify account. Either pick a Spotify playlist (the one you made in
 * Spotify), or make a new Spotify playlist from one of yours here. Existing TurboMusic playlists can be merged in at the same time.
 */
export function SyncedPlaylistDialog({ onClose }: { onClose: () => void }) {
  const lib = useLibraryLive();
  const nav = useNavigate();
  const { put, remove } = useStore();
  const [tab, setTab] = useState<'from' | 'to'>('from');
  const [mine, setMine] = useState<MyList[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [chosen, setChosen] = useState<MyList | null>(null);
  const [localId, setLocalId] = useState('');
  const [mode, setMode] = useState<SyncMode>('both');
  const [merge, setMerge] = useState<string[]>([]);
  const [deleteMerged, setDeleteMerged] = useState(false);
  const [canWrite, setCanWrite] = useState(false);
  const [conn, setConn] = useState<'loading' | 'no' | 'ok'>('loading');
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<{ id: string; text: string } | null>(null);
  const trackLists = lib.playlists.filter((p) => p.kind !== 'albums' && !p.spotify);
  const effective: SyncMode = canWrite ? mode : 'from-spotify';
  useEffect(() => {
    api().spotifyStatus().then((st) => { setCanWrite(!!st.canWrite); setConn(st.signedIn ? 'ok' : 'no'); if (st.signedIn) void load(); }).catch((e: Error) => { setErr(e.message); setConn('no'); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const load = () => api().spotifyPlaylists().then((r) => setMine(r.playlists)).catch((e: Error) => setErr(e.message));

  const guard = async (what: string, f: () => Promise<void>) => { setBusy(what); setErr(null); try { await f(); } catch (e) { setErr((e as Error).message); } finally { setBusy(null); } };

  const createFrom = () => guard('Syncing…', async () => {
    if (!chosen) return;
    const id = put('playlists', { name: chosen.name, description: null, cover: null, createdAt: Date.now(), trackIds: [] });
    let r = await linkToSpotify(id, chosen.id, effective);
    let text = describeSync(r);
    if (merge.length) {
      const m = mergePlaylists(id, merge, deleteMerged);
      if (m.added) { r = await syncPlaylist(id); text += ` ${plural(m.added, 'track')} merged in from your other playlists. ${describeSync(r)}`; }
    }
    setDone({ id, text });
  });
  const createTo = () => guard('Making it on Spotify…', async () => {
    const pl = lib.playlists.find((p) => p.id === localId);
    if (!pl) return;
    const r = await createOnSpotify(pl.id, effective);
    setDone({ id: pl.id, text: `Made “${pl.name}” on your Spotify account.${r.skipped ? ` ${plural(r.skipped, 'track')} without a Spotify link stay only here.` : ''}` });
  });

  const footer = done
    ? <div className="ml-auto flex gap-2"><button className="btn" onClick={() => { onClose(); nav(`/playlists/${done.id}`); }}>Open the playlist</button><button className="btn btn-accent" onClick={onClose}>Done</button></div>
    : <div className="ml-auto flex gap-2"><button className="btn btn-ghost" onClick={onClose}>Cancel</button>
      {tab === 'from'
        ? <button className="btn btn-accent" disabled={!chosen || !!busy} onClick={() => void createFrom()}>{busy ? <Loader2 size={15} className="animate-spin" /> : null}Create synced playlist</button>
        : <button className="btn btn-accent" disabled={!localId || !canWrite || !!busy} onClick={() => void createTo()}>{busy ? <Loader2 size={15} className="animate-spin" /> : null}Make it on Spotify</button>}</div>;

  return (
    <Modal title="Synced playlist" onClose={onClose} wide footer={footer}>
      {done ? <div className="rounded-theme bg-good/10 p-4 text-sm" role="status"><div className="font-medium text-good">Done.</div><div>{done.text}</div></div> : (
        conn === 'loading' ? <div className="text-sm text-muted">Checking your Spotify connection…</div>
        : conn === 'no' ? <div className="space-y-2 rounded-theme bg-raised p-4 text-sm"><p>TurboMusic is not connected to Spotify yet. Connect it once under <b>Settings › Spotify</b> and it is available here.</p><Link to="/settings?tab=spotify" onClick={onClose} className="btn btn-accent w-fit">Open Spotify settings</Link></div>
        : (<>
          {(() => (<>
            <div role="tablist" className="flex flex-wrap gap-1 border-b border-line pb-px">
              {([['from', 'Use a Spotify playlist'], ['to', 'Make one on Spotify']] as const).map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={cn('-mb-px border-b-2 px-3 py-2 text-sm font-medium', tab === id ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-fg')}>{label}</button>)}
            </div>
            {tab === 'from' ? (<>
              <p className="text-sm text-muted">Pick a playlist you made in Spotify. It appears here as a playlist that stays in step with it. Songs you have not got yet are added to your library (each in an album you can complete later), so you can listen to a new album on Spotify and put it into rotation without downloading anything first.</p>
              <div className="max-h-56 space-y-1 overflow-y-auto rounded-theme border border-line p-1">
                {mine?.map((p) => <button key={p.id} disabled={!p.mine || !!busy} onClick={() => setChosen(p)} className={cn('flex w-full items-center gap-2 rounded-theme px-2 py-1.5 text-left text-sm hover:bg-raised disabled:opacity-50', chosen?.id === p.id && 'bg-raised ring-1 ring-accent')}>
                  <ListMusic size={14} className="shrink-0 text-muted" /><span className="min-w-0 flex-1 truncate">{p.name}</span><span className="text-xs text-muted">{p.tracks ?? '?'} tracks{!p.mine ? ` · ${p.owner} (not yours)` : ''}</span></button>)}
                {mine && !mine.length && <div className="p-2 text-sm text-muted">No playlists found.</div>}{!mine && !err && <div className="p-2 text-sm text-muted">Loading…</div>}
              </div>
              {trackLists.length > 0 && <fieldset className="space-y-1.5"><legend className="text-sm font-medium">Merge existing TurboMusic playlists into it (optional)</legend>
                <div className="max-h-36 space-y-0.5 overflow-y-auto rounded-theme border border-line p-1">{trackLists.map((p) => <label key={p.id} className="flex items-center gap-2 rounded-theme px-2 py-1 text-sm hover:bg-raised/60"><input type="checkbox" checked={merge.includes(p.id)} onChange={(e) => setMerge(e.target.checked ? [...merge, p.id] : merge.filter((x) => x !== p.id))} /><span className="min-w-0 flex-1 truncate">{p.name}</span><span className="text-xs text-muted">{plural(p.trackIds.length, 'track')}</span></label>)}</div>
                {merge.length > 0 && <label className="flex items-center gap-2 text-xs text-muted"><input type="checkbox" checked={deleteMerged} onChange={(e) => setDeleteMerged(e.target.checked)} />Delete those playlists afterwards (their songs live in the synced one)</label>}</fieldset>}
            </>) : (<>
              <p className="text-sm text-muted">Turn a playlist you made here into a Spotify playlist (private). Songs with no Spotify link stay only here.</p>
              <Field label="Playlist"><select className="input" value={localId} onChange={(e) => setLocalId(e.target.value)}><option value="">Choose…</option>{trackLists.map((p) => <option key={p.id} value={p.id}>{p.name} ({plural(p.trackIds.length, 'track')})</option>)}</select></Field>
              {!canWrite && <p className="text-sm text-warn">Changing Spotify playlists needs the “Allow changing my playlists” permission: <Link to="/settings?tab=spotify" onClick={onClose} className="underline">Settings › Spotify</Link>.</p>}
            </>)}
            <Field label="Direction" hint={MODES.find((m) => m.id === effective)?.hint}>
              <select className="input" value={effective} disabled={!canWrite} onChange={(e) => setMode(e.target.value as SyncMode)}>{MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></Field>
            {!canWrite && tab === 'from' && <p className="text-xs text-muted">Without that permission (<Link to="/settings?tab=spotify" onClick={onClose} className="underline">Settings › Spotify</Link>), changes can only come from Spotify to here.</p>}
          </>))()}
        </>))}
      {busy && <div className="text-sm text-muted" role="status">{busy}</div>}
      {err && <div className="rounded-theme bg-bad/15 p-3 text-sm text-bad">{err}</div>}
    </Modal>
  );
}

/**
 * Merge playlists. `into:<id>`: pick playlists whose tracks are added to this one. `from:<id>`: pick the playlist this one is added to
 * (shows the synced ones first). Optionally deletes the merged-in playlists; a synced target is synced right after.
 */
export function MergePlaylistDialog({ spec, onClose }: { spec: string; onClose: () => void }) {
  const lib = useLibraryLive();
  const [dir, rawId] = spec.split(':') as ['into' | 'from', string];
  const self = lib.playlists.find((p) => p.id === rawId);
  const [picked, setPicked] = useState<string[]>([]);
  const [del, setDel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const others = lib.playlists.filter((p) => p.id !== rawId && p.kind !== 'albums').sort((a, b) => Number(!!b.spotify) - Number(!!a.spotify) || a.name.localeCompare(b.name));
  useEffect(() => { if (dir === 'from' && !picked.length) setPicked([]); }, [dir]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!self) return null;
  const targetId = dir === 'into' ? self.id : picked[0];
  const sourceIds = dir === 'into' ? picked : [self.id];
  const target = lib.playlists.find((p) => p.id === targetId);

  const run = async () => {
    if (!target) return;
    setBusy(true); setErr(null);
    try {
      const m = mergePlaylists(target.id, sourceIds, del);
      let text = `${plural(m.added, 'track')} added to “${target.name}”.`;
      if (target.spotify && m.added) text += ` ${describeSync(await syncPlaylist(target.id))}`;
      setMsg(text);
    } catch (e) { setErr(`${(e as Error).message} The tracks were merged here; press Sync now on the playlist to send them.`); }
    finally { setBusy(false); }
  };
  return (
    <Modal title={dir === 'into' ? `Merge playlists into “${self.name}”` : `Merge “${self.name}” into…`} onClose={onClose}
      footer={msg ? <button className="btn btn-accent ml-auto" onClick={onClose}>Done</button> : <div className="ml-auto flex gap-2"><button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-accent" disabled={busy || !target || !sourceIds.length} onClick={() => void run()}>{busy ? <Loader2 size={15} className="animate-spin" /> : <GitMerge size={15} />}Merge</button></div>}>
      {msg ? <div className="rounded-theme bg-good/10 p-4 text-sm" role="status">{msg}</div> : (<>
        <p className="text-sm text-muted">{dir === 'into' ? 'The tracks of the playlists you pick are added to the end of this one (a track already in it is not added twice).' : 'Pick the playlist these tracks are added to. A synced playlist is synced with Spotify straight away.'}</p>
        <div className="max-h-64 space-y-0.5 overflow-y-auto rounded-theme border border-line p-1">
          {others.map((p) => <label key={p.id} className="flex items-center gap-2 rounded-theme px-2 py-1 text-sm hover:bg-raised/60">
            <input type={dir === 'into' ? 'checkbox' : 'radio'} name="merge" checked={picked.includes(p.id)} onChange={(e) => setPicked(dir === 'into' ? (e.target.checked ? [...picked, p.id] : picked.filter((x) => x !== p.id)) : [p.id])} />
            <span className="min-w-0 flex-1 truncate">{p.name}</span>{p.spotify && <span className="chip">Synced</span>}<span className="text-xs text-muted">{plural(p.trackIds.length, 'track')}</span></label>)}
          {!others.length && <div className="p-2 text-sm text-muted">No other playlists.</div>}
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={del} onChange={(e) => setDel(e.target.checked)} />Delete {dir === 'into' ? 'the merged playlists' : `“${self.name}”`} afterwards</label>
      </>)}
      {err && <div className="rounded-theme bg-bad/15 p-3 text-sm text-bad">{err}</div>}
    </Modal>
  );
}

/** The strip on a synced playlist's page: state, Sync now, direction, merge, open in Spotify, unlink. */
export function SyncBar({ playlistId }: { playlistId: string }) {
  const lib = useLibraryLive();
  const pl = lib.playlists.find((p) => p.id === playlistId);
  const patch = useStore((s) => s.patch);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [canWrite, setCanWrite] = useState<boolean | null>(null);
  useEffect(() => { api().spotifyStatus().then((s) => setCanWrite(!!s.canWrite)).catch(() => setCanWrite(null)); }, []);
  const link = pl?.spotify;
  if (!pl || !link) return null;
  const mode = link.mode ?? 'both';
  const go = async () => {
    setBusy(true); setMsg(null);
    try { setMsg({ text: describeSync(await syncPlaylist(pl.id)) }); } catch (e) { setMsg({ text: (e as Error).message, bad: true }); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-2 rounded-theme border border-line bg-raised/40 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="chip"><RefreshCw size={12} />Synced with Spotify</span>
        <span className="text-xs text-muted">{link.syncedAt ? `Last synced ${new Date(link.syncedAt).toLocaleString()}` : 'Not synced yet'}</span>
        <button className="btn btn-accent !py-1" disabled={busy} onClick={() => void go()}>{busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}Sync now</button>
        <select className="input !w-auto !py-1 text-xs" aria-label="Direction" value={mode} onChange={(e) => patch('playlists', pl.id, { spotify: { ...link, mode: e.target.value as SyncMode } })}>{MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select>
        <a className="btn btn-ghost !py-1" href={`https://open.spotify.com/playlist/${link.id}`} target="_blank" rel="noreferrer"><ExternalLink size={14} />Open in Spotify</a>
        <button className="btn btn-ghost !py-1" title="Stop syncing; both playlists stay as they are" onClick={() => { if (confirm('Stop syncing? Both playlists stay as they are.')) unlinkFromSpotify(pl.id); }}><Unlink size={14} />Unlink</button>
      </div>
      {canWrite === false && mode !== 'from-spotify' && <p className="text-xs text-warn">TurboMusic may not change your Spotify playlists yet, so sending will fail. Settings › Spotify › “Allow changing my playlists”, or set the direction to Spotify → TurboMusic only.</p>}
      {msg && <p className={cn('text-xs', msg.bad ? 'text-bad' : 'text-muted')} role="status">{msg.text}</p>}
    </div>
  );
}
