import { useMemo, useState } from 'react';
import { Check, Link2, Loader2 } from 'lucide-react';
import { Modal, Field } from './forms.tsx';
import { Select } from './Select.tsx';
import { applyListedCredits } from './PasteCredits.tsx';
import { useLibrary } from '../lib/derive.ts';
import { api, useStore } from '../lib/store.ts';
import type { ImportPreview } from '../lib/api.ts';
import { matchEntries } from '../lib/albumMerge.ts';
import { splitFeaturing } from '../lib/autofill.ts';

/**
 * Album ⋯ > "Re-read credits from YouTube Music": opens the YouTube Music page a release was imported from (the link kept on the release),
 * matches its songs to the album's, and gives each song the artists YouTube names for it, with "(feat. …)" moved into Featured artist
 * credits. A release with no link can be tied to one here. Nothing is written until Apply.
 */
export function ReparseCreditsDialog({ albumId, onClose }: { albumId: string; onClose: () => void }) {
  const lib = useLibrary();
  const { put, patch } = useStore();
  const album = lib.albumById.get(albumId);
  const releases = lib.releases.filter((r) => r.albumId === albumId);
  const first = releases.find((r) => r.id === album?.defaultReleaseId && r.youtubeMusicUrl) ?? releases.find((r) => r.youtubeMusicUrl) ?? releases.find((r) => r.id === album?.defaultReleaseId) ?? releases[0];
  const [releaseId, setReleaseId] = useState(first?.id ?? '');
  const release = releases.find((r) => r.id === releaseId);
  const [typed, setTyped] = useState('');
  const link = (release?.youtubeMusicUrl ?? typed).trim();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pv, setPv] = useState<ImportPreview | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const have = useMemo(() => (album?.trackIds ?? []).flatMap((id) => lib.trackById.get(id) ?? []), [album, lib]);

  const rows = useMemo(() => {
    if (!pv) return [];
    const matched = matchEntries(have.map((t) => ({ id: t.id, title: t.title, youtubeMusicUrl: t.youtubeMusicUrl })), pv.entries.map((e) => ({ id: e.id, title: e.title, url: e.url, duration: e.duration })));
    return matched.map((m) => {
      const e = pv.entries.find((x) => x.id === m.entry.id)!;
      const track = m.trackId ? lib.trackById.get(m.trackId) : undefined;
      const sp = splitFeaturing(e.title);
      return { e, track, leads: [...new Set(e.artists ?? [])], featured: sp.featured };
    });
  }, [pv, have, lib]);
  const usable = rows.filter((r) => r.track && r.leads.length);

  async function read() {
    setBusy(true); setError(null); setPv(null);
    try { setPv(await api().importPreview(link)); }
    catch (e) { setError((e as Error).message === 'Failed to fetch' ? 'Cannot reach the server.' : (e as Error).message); }
    finally { setBusy(false); }
  }
  function apply() {
    // the songs keep their own titles (only a "(feat. …)" is taken out of them); the link is kept on the release for next time
    const n = applyListedCredits(lib, put, patch, usable.flatMap((r) => (r.track ? [{ l: { title: splitFeaturing(r.track.title).title, leads: r.leads, featured: [...new Set([...splitFeaturing(r.track.title).featured, ...r.featured])] }, track: r.track }] : [])));
    if (release && !release.youtubeMusicUrl && link) patch('releases', release.id, { youtubeMusicUrl: link });
    setDone(n);
  }
  if (!album) return null;
  return (
    <Modal title={`Re-read credits: ${album.title}`} onClose={onClose} wide
      footer={done !== null ? <button className="btn btn-accent ml-auto" onClick={onClose}>Done</button> : <><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-accent ml-auto" disabled={!usable.length} onClick={apply}><Check size={15} />Apply to {usable.length} songs</button></>}>
      <p className="text-sm text-muted">Reads the YouTube Music page this release came from again and gives each song the artists YouTube lists for it (“(feat. …)” becomes Featured artists). The songs stop following the album’s credits.</p>
      {releases.length > 1 && <Field label="Release"><Select value={releaseId} onChange={setReleaseId} options={releases.map((r) => ({ value: r.id, label: `${r.title}${r.releaseDate ? ` · ${r.releaseDate}` : ''}`, hint: r.youtubeMusicUrl ? 'has a link' : 'no link yet' }))} /></Field>}
      {release?.youtubeMusicUrl
        ? <div className="flex items-center gap-2 text-sm"><Link2 size={14} className="shrink-0 text-muted" /><span className="min-w-0 flex-1 truncate text-muted">{release.youtubeMusicUrl}</span></div>
        : <Field label="YouTube Music link" hint="This release has no link yet. Paste the album’s YouTube Music page; it is kept on the release (and can be edited in the release’s editor)."><input className="input" placeholder="https://music.youtube.com/playlist?list=…" value={typed} onChange={(e) => setTyped(e.target.value)} /></Field>}
      <button className="btn" disabled={busy || !/^https?:\/\/\S+$/i.test(link)} onClick={read}>{busy ? <Loader2 size={15} className="animate-spin" /> : null}{pv ? 'Read it again' : 'Read the page'}</button>
      {error && <p className="text-sm text-bad" role="alert">{error}</p>}
      {done !== null && <div className="rounded-theme bg-good/10 p-3 text-sm text-good" role="status">Updated {done} songs.</div>}
      {pv && done === null && <>
        {!rows.some((r) => r.leads.length) && <p className="text-sm text-warn">YouTube Music names no artist for the individual songs on this page (it only lists the album’s artist), so there is nothing to update. “Fix artists from a pasted list” takes a copied track list instead.</p>}
        <div className="max-h-72 divide-y divide-line/60 overflow-y-auto rounded-theme border border-line text-sm">
          {rows.map((r) => (
            <div key={r.e.id} className="px-3 py-1.5">
              <div className={r.track ? 'font-medium' : 'font-medium text-warn'}>{r.track?.title ?? r.e.title}{!r.track && ' · no song of the album matches'}</div>
              <div className="text-xs text-muted">{r.track && <>now: {r.track.leads.map((a) => a.name).join(', ') || '—'} → </>}{r.leads.join(', ') || 'no artist listed: left alone'}{r.featured.length ? ` · feat. ${r.featured.join(', ')}` : ''}</div>
            </div>))}
        </div>
      </>}
    </Modal>
  );
}
